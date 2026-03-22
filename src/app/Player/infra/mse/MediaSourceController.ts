import { createSourceBufferQueue } from '@/app/Player/infra/mse/SourceBufferQueue';
import {
    MediaSourceExistsError,
    MediaSourceNotFoundError,
    SourceBufferQueueExistsError,
    SourceBufferQueueNotFoundError,
} from '@/app/Player/shared/errors';

export function createMediaSourceController(video: HTMLVideoElement) {
    console.log('mse created');
    let mediaSource: MediaSource | null = null;
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
    function createBuffer(mimeCodec: string) {
        if (!mediaSource) {
            throw new MediaSourceNotFoundError();
        }
        if (sourceBufferQueue) {
            throw new SourceBufferQueueExistsError();
        }
        console.log('canPlayType', video.canPlayType(mimeCodec));
        if (checkMediaSource()) {
            console.log('mse supported', MediaSource.isTypeSupported(mimeCodec));
        }
        const buffer = mediaSource.addSourceBuffer(mimeCodec);
        sourceBufferQueue = createSourceBufferQueue(buffer);
    }
    function append(chunk: Uint8Array) {
        if (!sourceBufferQueue) {
            throw new SourceBufferQueueNotFoundError();
        }
        sourceBufferQueue.enqueue(chunk);
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
    return {
        attach,
        createBuffer,
        append,
        reset,
        destroy,
    };
}
