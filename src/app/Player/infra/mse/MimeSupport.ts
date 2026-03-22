import { createFile, Movie, MP4BoxBuffer } from 'mp4box';
import { scanMoov } from '@/app/Player/infra/mse/mp4MoovScan';
import { NotMp4Error } from '@/app/Player/shared/errors';

export async function checkMime(bytes: Uint8Array) {
    const pend = getProbe(bytes);
    if (!pend) {
        return false;
    }
    const Probe = await pend;
    let VideoCodec;
    let AudioCodec;
    Probe.tracks.forEach((v) => {
        if (v.video) {
            VideoCodec = v.codec;
        }
        if (v.audio) {
            AudioCodec = v.codec;
        }
    });
    if (!(VideoCodec && AudioCodec)) {
        throw new Error("Can't read codec");
    }
    return `video/mp4; codecs="${VideoCodec}, ${AudioCodec}"`;
}

function toMP4BoxBuffer(bytes: Uint8Array, fileStart: number): MP4BoxBuffer {
    if (!(bytes.buffer instanceof ArrayBuffer)) {
        throw new Error('SharedArrayBuffer is not supported');
    }

    const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as MP4BoxBuffer;

    buffer.fileStart = fileStart;
    return buffer;
}

function getProbe(bytes: Uint8Array): false | Promise<Movie> {
    const status = scanMoov(bytes).status;
    if (status === 'not-mp4') {
        throw new NotMp4Error();
    } else if (status === 'no-moov' || status === 'partial-moov') {
        console.log(status);
        return false;
    }
    return new Promise((resolve, reject) => {
        const mp4boxFile = createFile();
        mp4boxFile.onReady = (info) => {
            resolve(info);
        };
        mp4boxFile.onError = () => {
            reject();
        };
        const buffer = toMP4BoxBuffer(bytes, 0);
        mp4boxFile.appendBuffer(buffer);
        mp4boxFile.flush();
    });
}
