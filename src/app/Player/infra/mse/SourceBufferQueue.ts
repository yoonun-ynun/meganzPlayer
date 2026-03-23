import { SharedArrayBufferError } from '@/app/Player/shared/errors';

export function createSourceBufferQueue(source: SourceBuffer) {
    console.log('mse createBuffer');
    const bufferQueue: ArrayBuffer[] = [];
    let destroyed = false;
    let setPause = false;
    function enqueue(chunk: ArrayBuffer) {
        if (destroyed) return;
        bufferQueue.push(chunk);
        flush();
    }
    function flush() {
        if (destroyed) return;
        if (setPause) return;
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

    source.addEventListener('updateend', () => {
        flush();
    });

    // 2. 브라우저가 데이터를 버리거나 에러를 낼 때 감시 (가장 중요 ⭐️)
    source.addEventListener('error', (e) => {
        console.error(`[SourceBuffer 🚨] 브라우저가 데이터를 거부했습니다!`, e);
    });

    source.addEventListener('abort', (e) => {
        console.warn(`[SourceBuffer ⚠️] 데이터 주입이 강제 취소되었습니다.`, e);
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
    };
}
