import { createFile, DataStream, ISOFile, Movie, MP4BoxBuffer } from 'mp4box';
import { createSourceBufferQueue } from '@/app/Player/infra/mse/SourceBufferQueue';

export function mp4boxController() {
    let bufferQueues: {
        video: ReturnType<typeof createSourceBufferQueue>;
        audio: ReturnType<typeof createSourceBufferQueue>;
    };
    let trackIds: { video: number; audio: number };
    let offset = 0;
    const mp4BoxFile = createFile();
    let videoInfo: null | Movie = null;
    let headerFile = new Uint8Array();
    mp4BoxFile.onReady = (info) => {
        console.log('onReady');

        videoInfo = info;
    };
    mp4BoxFile.onSegment = (
        id: number,
        user: unknown,
        buffer: ArrayBuffer,
        nextSample: number,
        last: boolean,
    ) => {
        if (id === trackIds.video) {
            bufferQueues.video.enqueue(buffer);
        } else if (id === trackIds.audio) {
            bufferQueues.audio.enqueue(buffer);
        }
        mp4BoxFile.releaseUsedSamples(id, nextSample);
    };
    let setSourced: boolean = false;
    function setSource(
        source: {
            video: ReturnType<typeof createSourceBufferQueue>;
            audio: ReturnType<typeof createSourceBufferQueue>;
        },
        Ids: { video: number; audio: number },
    ) {
        console.log('setting source');
        bufferQueues = source;
        trackIds = Ids;
        mp4BoxFile.setSegmentOptions(Ids.video, source.video, {
            nbSamples: 30,
            nbSamplesPerFragment: 1,
        });
        mp4BoxFile.setSegmentOptions(Ids.audio, source.audio, {
            nbSamples: 30,
            nbSamplesPerFragment: 30,
        });
        const initSegment = mp4BoxFile.initializeSegmentation();
        source.video.enqueue(initSegment.buffer);
        mp4BoxFile.start();
        // setSource 안에서
        setSourced = true;
    }
    function getMime(chunk: Uint8Array):
        | {
              mime: string;
              videoId: number;
              audioId: number;
              duration: number;
          }
        | false {
        if (videoInfo) {
            let VideoCodec: null | string = null;
            let videoId: null | number = null;
            let AudioCodec: null | string = null;
            let audioId: null | number = null;
            console.log(videoInfo.tracks);
            console.log(videoInfo);
            videoInfo.tracks.forEach((v) => {
                if (v.video && !VideoCodec) {
                    VideoCodec = v.codec;
                    videoId = v.id;
                }
                if (v.audio && !AudioCodec) {
                    AudioCodec = v.codec;
                    audioId = v.id;
                }
            });
            if (!(VideoCodec && AudioCodec && videoId && audioId)) {
                throw new Error("Can't read codec");
            }
            offset = 0;
            const duration = videoInfo.duration / videoInfo.timescale;
            return {
                mime: `video/mp4; codecs="${VideoCodec}, ${AudioCodec}"`,
                videoId: videoId,
                audioId: audioId,
                duration: duration,
            };
        } else {
            const buffer = toMP4BoxBuffer(chunk, offset);
            headerFile = concatUint8Array([headerFile, chunk]);
            offset += chunk.byteLength;
            mp4BoxFile.appendBuffer(buffer);
            return false;
        }
    }
    function append(chunk: Uint8Array) {
        if (!setSourced) {
            throw new Error('not settings source');
        }
        const buffer = toMP4BoxBuffer(chunk, offset);
        offset = mp4BoxFile.appendBuffer(buffer);
        console.log('mp4box next_offset', offset);
        return offset;
    }

    function seekByte(time: number) {
        console.log('seek time', time);
        mp4BoxFile.stop();
        const seekInfo = mp4BoxFile.seek(time, true);
        syncSegmentationStateAfterSeek(mp4BoxFile);
        for (const frag of mp4BoxFile.fragmentedTracks ?? []) {
            console.log('frag reset check after resetMp4boxAfterSeek', {
                id: frag.id,
                nextSample: frag.trak.nextSample,
                lastFragmentSampleNumber: frag.state.lastFragmentSampleNumber,
                lastSegmentSampleNumber: frag.state.lastSegmentSampleNumber,
            });
        }
        mp4BoxFile.start();
        return seekInfo;
    }

    return {
        getMime,
        setSource,
        append,
        seekByte,
    };
}
function toMP4BoxBuffer(bytes: Uint8Array, fileStart: number): MP4BoxBuffer {
    if (!(bytes.buffer instanceof ArrayBuffer)) {
        throw new Error('SharedArrayBuffer is not supported');
    }

    let buffer: MP4BoxBuffer;

    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        buffer = bytes.buffer as MP4BoxBuffer;
    } else {
        buffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as MP4BoxBuffer;
    }

    buffer.fileStart = fileStart;
    return buffer;
}

function syncSegmentationStateAfterSeek(mp4boxfile: ISOFile) {
    for (const frag of mp4boxfile.fragmentedTracks || []) {
        const n = frag.trak.nextSample;
        frag.state.lastFragmentSampleNumber = n;
        frag.state.lastSegmentSampleNumber = n;
        frag.state.accumulatedSize = 0;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        frag.segmentStream = undefined;
    }

    for (const ext of mp4boxfile.extractedTracks || []) {
        ext.samples = [];
    }
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
