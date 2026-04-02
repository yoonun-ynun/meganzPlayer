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

    return {
        open,
        next,
        close,
        getOffset,
        isOpen,
    };
}
