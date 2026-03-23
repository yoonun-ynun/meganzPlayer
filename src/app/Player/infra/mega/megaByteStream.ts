import { openFile } from './megaLinkSession';

export async function createByteStream(url: string) {
    const session = await openFile(url);
    const size = session.size;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let offset = 0;
    let opened = false;
    let generation = 0;

    function open(start: number, end?: number) {
        close();
        if (start > size) return null;
        const stream = session.file.download({
            start: start,
            end: end,
            initialChunkSize: 2 * 1024 * 1024,
            maxChunkSize: 15 * 1024 * 1024,
            maxConnections: 6,
            chunkSizeIncrement: 2 * 1024 * 1024,
        });
        iterator = stream[Symbol.asyncIterator]();
        offset = start;
        opened = true;
        generation += 1;
    }
    async function next() {
        if (!iterator || !opened) return null;
        const { done, value } = await iterator.next();
        if (done || !value) {
            opened = false;
            return null;
        }
        offset += value.byteLength;
        return value;
    }
    function close() {
        iterator = undefined;
        offset = 0;
        opened = false;
    }
    function getOffset() {
        return offset;
    }
    function isOpen() {
        return opened;
    }

    async function readHead(maxBytes: number) {
        const chunks: Uint8Array[] = [];
        const stream = session.file.download({
            start: 0,
            end: maxBytes - 1,
        });
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return concatUint8Array(chunks);
    }
    function concatUint8Array(arrays: Uint8Array[]) {
        const totalLength = arrays.reduce((acc, value) => acc + value.length, 0);

        const result = new Uint8Array(totalLength);

        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }

    return {
        open,
        next,
        close,
        getOffset,
        isOpen,
        readHead,
    };
}
