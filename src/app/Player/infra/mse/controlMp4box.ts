import { createFile, MP4BoxBuffer } from 'mp4box';
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
    mp4BoxFileForHeader.onReady = (info) => {
        videoInfo = info;
    };
    mp4BoxFile.onReady = () => {
        console.log('onReady');

        mp4BoxFile.setSegmentOptions(trackIds.video, bufferQueues.video, {
            nbSamples: 70,
            rapAlignement: false,
        });
        mp4BoxFileForHeader.setSegmentOptions(trackIds.video, bufferQueues.video, {});
        mp4BoxFileForHeader.setSegmentOptions(trackIds.audio, bufferQueues.audio, {});
        mp4BoxFile.setSegmentOptions(trackIds.audio, bufferQueues.audio, {
            nbSamples: 70,
            rapAlignement: false,
        });
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
        const buffer = toMP4BoxBuffer(chunk, offset);
        offset += chunk.byteLength;
        mp4BoxFileForHeader.appendBuffer(buffer);
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
                    if (v.language !== 'jpn') {
                        AudioCodec = v.codec;
                        audioId = v.id;
                    }
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
            return false;
        }
    }
    function append(chunk: Uint8Array) {
        if (!setSourced) {
            throw new Error('not settings source');
        }
        const buffer = toMP4BoxBuffer(chunk, offset);
        offset += chunk.byteLength;
        mp4BoxFile.appendBuffer(buffer);
    }

    return {
        getMime,
        setSource,
        append,
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
