import { SharedArrayBufferError } from '@/app/Player/shared/errors';

export function createSourceBufferQueue(source: SourceBuffer) {
    console.log('mse createBuffer');
    const bufferQueue: ArrayBuffer[] = [];
    let destroyed = false;
    let setPause = false;
    let quota_append = false;
    function enqueue(chunk: ArrayBuffer) {
        if (destroyed) return;
        bufferQueue.push(chunk);
    }
    function flush(currentTime: number) {
        if (destroyed) return;
        if (setPause) return;
        if (quota_append) return;
        if (source.updating) {
            return;
        }
        if (!bufferQueue.length) {
            return;
        }

        const chunk = bufferQueue.shift();
        if (chunk === undefined) {
            return;
        }
        try {
            source.appendBuffer(chunk);
        } catch (e: unknown) {
            if (!(e instanceof Error)) {
                return;
            }
            if (e.name === 'QuotaExceededError') {
                console.error(
                    `throws QuotaExceededError, now handling video: currentTime: ${currentTime}`,
                );
                console.warn(e);
                bufferQueue.unshift(chunk);
                quota_append = true;
                setTimeout(() => (quota_append = false), 5000);
            }
        }
    }
    function clear() {
        bufferQueue.length = 0;
    }
    function size() {
        return bufferQueue.length;
    }
    function destroy() {
        console.log('mse destroy');
        destroyed = true;
        bufferQueue.length = 0;
        //source.removeEventListener('updateend', flush);
    }
    function assertArrayBufferView(chunk: Uint8Array): asserts chunk is Uint8Array<ArrayBuffer> {
        if (!(chunk.buffer instanceof ArrayBuffer)) {
            throw new SharedArrayBufferError();
        }
    }
    function abortSourceBuffer() {
        if (source.updating) {
            source.abort();
        }
    }

    function remove(start: number, end: number) {
        if (destroyed) return;
        if (source.updating) {
            return;
        }
        source.remove(start, end);
    }

    function pause() {
        setPause = true;
    }

    function resume() {
        setPause = false;
    }
    function getBuffered() {
        return source.buffered;
    }

    function getUpdating() {
        return source.updating;
    }

    source.addEventListener('error', (e) => {
        console.error(`SourceBuffer returned Error`, e);
    });

    source.addEventListener('abort', (e) => {
        console.warn(`SourceBuffer aborted.`, e);
    });

    return {
        enqueue,
        flush,
        clear,
        size,
        destroy,
        abortSourceBuffer,
        remove,
        pause,
        resume,
        getBuffered,
        getUpdating,
    };
}
