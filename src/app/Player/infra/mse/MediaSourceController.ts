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
    let sourceBufferQueue: ReturnType<typeof createSourceBufferQueue> | null = null;
    let objectURL: string | null = null;
    function checkMediaSource() {
        return !!window.MediaSource;
    }
    function attach() {
        if (mediaSource) {
            return Promise.reject(new MediaSourceExistsError());
        }
        if (!checkMediaSource()) {
            mediaSource = new ManagedMediaSource();
            video.disableRemotePlayback = true;
            (mediaSource as ManagedMediaSource).onstartstreaming = () => {
                console.log('onstartstreaming called');
                sourceBufferQueue?.resume();
                sourceBufferQueue?.flush();
            };
            (mediaSource as ManagedMediaSource).onendstreaming = () => {
                console.log('onendstreaming called');
                sourceBufferQueue?.pause();
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
                    resolve();
                },
                { once: true },
            );
        });
    }
    function createBuffer(mime: string, ids: { video: number; audio: number }) {
        if (!mediaSource) {
            throw new MediaSourceNotFoundError();
        }
        if (sourceBufferQueue) {
            throw new SourceBufferQueueExistsError();
        }
        console.log('canPlayType', video.canPlayType(mime));
        if (checkMediaSource()) {
            console.log('mse supported', MediaSource.isTypeSupported(mime));
        }
        console.log('mime: ', mime);
        const muxedBuffer = mediaSource.addSourceBuffer(mime);
        if (!checkMediaSource()) {
            muxedBuffer.mode = 'sequence';
        }
        const muxedBufferQueue = createSourceBufferQueue(muxedBuffer);
        sourceBufferQueue = muxedBufferQueue;
        mp4box.setSource(muxedBufferQueue, ids);
    }
    function append(chunk: Uint8Array) {
        if (!sourceBufferQueue) {
            throw new SourceBufferQueueNotFoundError();
        }
        mp4box.append(chunk);
    }
    function reset() {
        sourceBufferQueue?.clear();
        sourceBufferQueue?.abortSourceBuffer();
    }
    function destroy() {
        sourceBufferQueue?.destroy();
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
        sourceBufferQueue.remove(start, end);
    }
    function getMp4Mime(chunk: Uint8Array) {
        return mp4box.getMime(chunk);
    }
    function pause() {
        sourceBufferQueue?.pause();
    }
    function resume() {
        sourceBufferQueue?.resume();
        sourceBufferQueue?.flush();
    }
    function size() {
        if (!sourceBufferQueue?.size()) {
            return 0;
        }
        return sourceBufferQueue?.size();
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
    };
}
