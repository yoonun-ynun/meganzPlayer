import { createSourceBufferQueue } from '@/app/Player/infra/mse/SourceBufferQueue';
import {
    MediaSourceExistsError,
    MediaSourceNotFoundError,
    SourceBufferQueueExistsError,
    SourceBufferQueueNotFoundError,
} from '@/app/Player/shared/errors';
import { mp4boxController } from '@/app/Player/infra/mse/controlMp4box';

export function createMediaSourceController(video: HTMLVideoElement) {
    console.log('mse created');
    const mp4box = mp4boxController();
    let mediaSource: ManagedMediaSource | MediaSource | null = null;
    let sourceBufferQueue: {
        video: ReturnType<typeof createSourceBufferQueue>;
        audio: ReturnType<typeof createSourceBufferQueue>;
    } | null = null;
    let objectURL: string | null = null;
    function checkMediaSource() {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        return !!window.ManagedMediaSource;
    }
    function attach(duration: number) {
        if (mediaSource) {
            return Promise.reject(new MediaSourceExistsError());
        }
        if (checkMediaSource()) {
            mediaSource = new ManagedMediaSource();
            video.disableRemotePlayback = true;
            (mediaSource as ManagedMediaSource).onstartstreaming = () => {
                console.log('onstartstreaming called');
                sourceBufferQueue?.video.control.resume();
                sourceBufferQueue?.audio.control.resume();
                sourceBufferQueue?.video.control.flush(video.currentTime);
                sourceBufferQueue?.audio.control.flush(video.currentTime);
            };
            (mediaSource as ManagedMediaSource).onendstreaming = () => {
                console.log('onendstreaming called');
                sourceBufferQueue?.video.control.pause();
                sourceBufferQueue?.audio.control.pause();
            };
        } else {
            mediaSource = new MediaSource();
        }
        objectURL = URL.createObjectURL(mediaSource);
        video.src = objectURL;

        return new Promise<void>((resolve, reject) => {
            if (mediaSource === null) {
                reject(new MediaSourceNotFoundError());
                return;
            }

            const timer = window.setTimeout(() => {
                reject(new Error('MediaSource sourceopen timeout'));
            }, 5000);
            mediaSource.addEventListener('sourceclose', () => {
                console.log('mse: sourceclose');
            });

            mediaSource.addEventListener('sourceended', () => {
                console.log('mse: sourceended');
            });

            mediaSource.addEventListener(
                'sourceopen',
                () => {
                    window.clearTimeout(timer);
                    if (mediaSource !== null) {
                        mediaSource.duration = duration;
                    }
                    resolve();
                },
                { once: true },
            );
        });
    }
    function createBuffer(
        mime: { video: string; audio: string },
        ids: { video: number; audio: number },
    ) {
        if (!mediaSource) {
            throw new MediaSourceNotFoundError();
        }
        if (sourceBufferQueue) {
            throw new SourceBufferQueueExistsError();
        }
        console.log('canPlayType', video.canPlayType(mime.audio));
        if (!checkMediaSource()) {
            console.log('mse supported', MediaSource.isTypeSupported(mime.audio));
        }
        console.log('mime: ', mime);
        const videoBuffer = mediaSource.addSourceBuffer(mime.video);
        const audioBuffer = mediaSource.addSourceBuffer(mime.audio);
        const videoBufferQueue = createSourceBufferQueue(videoBuffer);
        const audioBufferQueue = createSourceBufferQueue(audioBuffer);
        sourceBufferQueue = { video: videoBufferQueue, audio: audioBufferQueue };
        mp4box.setSource(sourceBufferQueue, ids);
    }
    function append(chunk: Uint8Array, offset: number) {
        if (!sourceBufferQueue) {
            throw new SourceBufferQueueNotFoundError();
        }
        return mp4box.append(chunk, offset);
    }
    function reset() {
        sourceBufferQueue?.video.queueing.clear();
        sourceBufferQueue?.audio.queueing.clear();
        sourceBufferQueue?.video.control.abortSourceBuffer();
        sourceBufferQueue?.audio.control.abortSourceBuffer();
    }
    function destroy() {
        sourceBufferQueue?.video.control.destroy();
        sourceBufferQueue?.audio.control.destroy();
        sourceBufferQueue = null;
        mediaSource = null;
        if (objectURL) {
            URL.revokeObjectURL(objectURL);
            objectURL = null;
        }
        video.removeAttribute('src');
        video.load();
    }
    function remove(start: number, end: number) {
        if (!sourceBufferQueue) {
            throw new SourceBufferQueueNotFoundError();
        }
        sourceBufferQueue.video.control.remove(start, end);
        sourceBufferQueue.audio.control.remove(start, end);
    }
    function getMp4Mime(chunk: Uint8Array, offset: number) {
        return mp4box.getMime(chunk, offset);
    }
    function pause(select: 'video' | 'audio') {
        if (select === 'video') {
            sourceBufferQueue?.video.control.pause();
        } else {
            sourceBufferQueue?.audio.control.pause();
        }
    }
    function resume(select: 'video' | 'audio') {
        if (select === 'video') {
            sourceBufferQueue?.video.control.resume();
            sourceBufferQueue?.video.control.flush(video.currentTime);
        } else {
            sourceBufferQueue?.audio.control.resume();
            sourceBufferQueue?.audio.control.flush(video.currentTime);
        }
    }
    function size() {
        if (!sourceBufferQueue) {
            return { video: 0, audio: 0 };
        }
        return {
            video: sourceBufferQueue?.video.getter.size(),
            audio: sourceBufferQueue?.audio.getter.size(),
        };
    }
    function getSourceBuffered() {
        if (!sourceBufferQueue) {
            return {
                video: { length: 0, start: () => 0, end: () => 0 },
                audio: { length: 0, start: () => 0, end: () => 0 },
            };
        }
        return {
            video: sourceBufferQueue.video.getter.getBuffered(),
            audio: sourceBufferQueue.audio.getter.getBuffered(),
        };
    }

    function sendSourceEnded() {
        if (
            sourceBufferQueue?.video?.getter.getUpdating() ||
            sourceBufferQueue?.audio?.getter.getUpdating()
        ) {
            return false;
        }
        mediaSource?.endOfStream();
        console.log('end stream');
        return true;
    }

    function getSeekByte(time: number) {
        return mp4box.seekByte(time);
    }
    return {
        setup: {
            attach,
            createBuffer,
        },
        queueing: {
            append,
            reset,
        },
        control: {
            destroy,
            remove,
            pause,
            resume,
            sendSourceEnded,
        },
        getter: {
            getMp4Mime,
            size,
            getSourceBuffered,
            getSeekByte,
        },
    };
}
