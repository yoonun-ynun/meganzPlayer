import { createFile, DataStream, ISOFile, MP4BoxBuffer } from 'mp4box';
import * as MP4Boxinit from 'mp4box-initSeg';
import { createSourceBufferQueue } from '@/app/Player/infra/mse/SourceBufferQueue';

export function mp4boxController() {
    let bufferQueues: {
        video: ReturnType<typeof createSourceBufferQueue>;
        audio: ReturnType<typeof createSourceBufferQueue>;
    };
    let trackIds: { video: number; audio: number };
    let offset = 0;
    const mp4BoxFileForHeader = MP4Boxinit.createFile();
    const mp4BoxFile = createFile();
    let videoInfo: null | MP4Boxinit.Movie = null;
    let headerFile = new Uint8Array();
    mp4BoxFileForHeader.onReady = (info) => {
        videoInfo = info;
    };
    mp4BoxFile.onReady = () => {
        console.log('onReady');

        mp4BoxFile.setSegmentOptions(trackIds.video, bufferQueues.video, {});
        mp4BoxFileForHeader.setSegmentOptions(trackIds.video, bufferQueues.video, {});
        mp4BoxFileForHeader.setSegmentOptions(trackIds.audio, bufferQueues.audio, {});
        mp4BoxFile.setSegmentOptions(trackIds.audio, bufferQueues.audio, {});
        mp4BoxFile.initializeSegmentation();
        const tracksInit = mp4BoxFileForHeader.initializeSegmentation();
        tracksInit.forEach((seg) => {
            let queue: ReturnType<typeof createSourceBufferQueue> | null = null;
            if (seg.user) {
                queue = seg.user as ReturnType<typeof createSourceBufferQueue>;
            } else {
                throw new Error('Queue is undefined');
            }
            queue.enqueue(seg.buffer);
        });
        mp4BoxFile.start();
    };
    mp4BoxFile.onSegment = (
        id: number,
        user: unknown,
        buffer: ArrayBuffer,
        nextSample: number,
        last: boolean,
    ) => {
        if (id !== trackIds.video && id !== trackIds.audio) {
            return;
        }
        let queue: ReturnType<typeof createSourceBufferQueue> | null = null;
        if (user) {
            queue = user as ReturnType<typeof createSourceBufferQueue>;
        } else {
            throw new Error('Queue is undefined');
        }
        queue.enqueue(buffer);
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
        // setSource 안에서
        setSourced = true;
    }
    function getMime(chunk: Uint8Array):
        | {
              mime: { video: string; audio: string };
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
                mime: {
                    video: `video/mp4; codecs="${VideoCodec}"`,
                    audio: `audio/mp4; codecs="${AudioCodec}"`,
                },
                videoId: videoId,
                audioId: audioId,
                duration: duration,
            };
        } else {
            const buffer = toMP4BoxBuffer(chunk, offset);
            headerFile = concatUint8Array([headerFile, chunk]);
            offset += chunk.byteLength;
            mp4BoxFileForHeader.appendBuffer(buffer);
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

function resetMp4boxAfterSeek(mp4boxfile: ISOFile) {
    for (const frag of mp4boxfile.fragmentedTracks ?? []) {
        const n = frag.trak.nextSample;

        frag.state.lastFragmentSampleNumber = n;
        frag.state.lastSegmentSampleNumber = n;
        frag.state.accumulatedSize = 0;

        // 타입 패치 안 했으면 undefined 대신 빈 stream으로 초기화
        frag.segmentStream = new DataStream();
    }

    for (const ext of mp4boxfile.extractedTracks ?? []) {
        ext.samples = [];
    }

    // 내부 다음 요청 힌트도 비워두는 게 안전함
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    mp4boxfile.nextSeekPosition = undefined;
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
