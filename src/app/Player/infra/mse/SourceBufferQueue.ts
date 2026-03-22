import { SharedArrayBufferError } from '@/app/Player/shared/errors';

export function createSourceBufferQueue(source: SourceBuffer) {
    console.log('mse createBuffer');
    const bufferQueue: Uint8Array[] = [];
    let destroyed = false;
    function enqueue(chunk: Uint8Array) {
        if (destroyed) return;
        bufferQueue.push(chunk);
        flush();
    }
    function flush() {
        if (destroyed) return;
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
        assertArrayBufferView(chunk);
        source.appendBuffer(chunk);
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
        source.removeEventListener('updateend', flush);
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
    source.addEventListener('updateend', flush);

    return {
        enqueue,
        flush,
        clear,
        size,
        destroy,
        abortSourceBuffer,
    };
}
