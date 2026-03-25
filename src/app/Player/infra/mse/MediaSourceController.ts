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
        return !!window.MediaSource;
    }
    function attach(duration: number) {
        if (mediaSource) {
            return Promise.reject(new MediaSourceExistsError());
        }
        if (!checkMediaSource()) {
            mediaSource = new ManagedMediaSource();
            video.disableRemotePlayback = true;
            (mediaSource as ManagedMediaSource).onstartstreaming = () => {
                console.log('onstartstreaming called');
                sourceBufferQueue?.video.resume();
                sourceBufferQueue?.audio.resume();
                sourceBufferQueue?.video.flush(video.currentTime);
                sourceBufferQueue?.audio.flush(video.currentTime);
            };
            (mediaSource as ManagedMediaSource).onendstreaming = () => {
                console.log('onendstreaming called');
                sourceBufferQueue?.video.pause();
                sourceBufferQueue?.audio.pause();
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

            video.addEventListener('error', () => {
                console.log('video error', video.error);
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
        if (checkMediaSource()) {
            console.log('mse supported', MediaSource.isTypeSupported(mime.audio));
        }
        console.log('mime: ', mime);
        const videoBuffer = mediaSource.addSourceBuffer(mime.video);
        const audioBuffer = mediaSource.addSourceBuffer(mime.audio);
        if (!checkMediaSource()) {
            videoBuffer.mode = 'sequence';
            audioBuffer.mode = 'sequence';
        }
        const videoBufferQueue = createSourceBufferQueue(videoBuffer);
        const audioBufferQueue = createSourceBufferQueue(audioBuffer);
        sourceBufferQueue = { video: videoBufferQueue, audio: audioBufferQueue };
        mp4box.setSource(sourceBufferQueue, ids);
    }
    function append(chunk: Uint8Array) {
        if (!sourceBufferQueue) {
            throw new SourceBufferQueueNotFoundError();
        }
        mp4box.append(chunk);
    }
    function reset() {
        sourceBufferQueue?.video.clear();
        sourceBufferQueue?.audio.clear();
        sourceBufferQueue?.video.abortSourceBuffer();
        sourceBufferQueue?.audio.abortSourceBuffer();
    }
    function destroy() {
        sourceBufferQueue?.video.destroy();
        sourceBufferQueue?.audio.destroy();
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
        sourceBufferQueue.video.remove(start, end);
        sourceBufferQueue.audio.remove(start, end);
    }
    function getMp4Mime(chunk: Uint8Array) {
        return mp4box.getMime(chunk);
    }
    function pause(select: 'video' | 'audio') {
        if (select === 'video') {
            sourceBufferQueue?.video.pause();
        } else {
            sourceBufferQueue?.audio.pause();
        }
    }
    function resume(select: 'video' | 'audio') {
        if (select === 'video') {
            sourceBufferQueue?.video.resume();
            sourceBufferQueue?.video.flush(video.currentTime);
        } else {
            sourceBufferQueue?.audio.resume();
            sourceBufferQueue?.audio.flush(video.currentTime);
        }
    }
    function size() {
        if (!sourceBufferQueue) {
            return { video: 0, audio: 0 };
        }
        return { video: sourceBufferQueue?.video.size(), audio: sourceBufferQueue?.audio.size() };
    }
    function getSourceBuffered() {
        if (!sourceBufferQueue) {
            return {
                video: { length: 0, start: () => 0, end: () => 0 },
                audio: { length: 0, start: () => 0, end: () => 0 },
            };
        }
        return {
            video: sourceBufferQueue.video.getBuffered(),
            audio: sourceBufferQueue.audio.getBuffered(),
        };
    }

    function sendSourceEnded() {
        if (sourceBufferQueue?.video?.getUpdating() || sourceBufferQueue?.audio?.getUpdating()) {
            return false;
        }
        mediaSource?.endOfStream();
        console.log('end stream');
        return true;
    }

    async function snap(tag: string) {
        const ua =
            'measureUserAgentSpecificMemory' in performance
                ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-expect-error
                  await performance?.measureUserAgentSpecificMemory()
                : null;

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const js = performance.memory?.usedJSHeapSize ?? null;

        if (sourceBufferQueue === null) {
            return;
        }
        console.log(tag, {
            audioQueueBytes: queueBytes(sourceBufferQueue.video.debugItem()),
            videoQueueBytes: queueBytes(sourceBufferQueue.audio.debugItem()),
            jsHeapBytes: js,
            uaBytes: ua?.bytes ?? null,
            sbRanges: dumpRanges(sourceBufferQueue.video.getBuffered()),
            currentTime: video.currentTime,
        });
    }
    function dumpRanges(r: TimeRanges) {
        const out: Array<[number, number]> = [];
        for (let i = 0; i < r.length; i++) out.push([r.start(i), r.end(i)]);
        return out;
    }

    function queueBytes(q: ArrayBuffer[]) {
        return q.reduce((n, x) => n + x.byteLength, 0);
    }
    return {
        attach,
        createBuffer,
        append,
        reset,
        destroy,
        remove,
        getMp4Mime,
        pause,
        resume,
        size,
        getSourceBuffered,
        sendSourceEnded,
        snap,
    };
}
