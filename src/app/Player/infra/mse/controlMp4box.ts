import { createFile, Movie, MP4BoxBuffer } from 'mp4box';
import { createSourceBufferQueue } from '@/app/Player/infra/mse/SourceBufferQueue';

export function mp4boxController() {
    let bufferQueues: ReturnType<typeof createSourceBufferQueue>;
    let trackIds: { video: number; audio: number };
    let offset = 0;
    const mp4BoxFileForHeader = createFile();
    const mp4BoxFile = createFile(true);
    let videoInfo: null | Movie = null;
    mp4BoxFileForHeader.onReady = (info) => {
        videoInfo = info;
    };
    mp4BoxFile.onReady = (info) => {
        console.log('onReady');
        const videoTrack = info.videoTracks[0];

        // 1. mp4box가 파싱한 전체 프레임(샘플) 정보 가져오기
        const samples = mp4BoxFile.getTrackSamplesInfo(videoTrack.id);

        // 2. '진짜 키프레임(is_sync)'들만 필터링
        const syncSamples = samples.filter((s) => s.is_sync);

        // 3. 이 영상의 고유한 키프레임 간격(GOP 사이즈) 계산
        let exactGopSize = 60; // 기본값 (보통 1초~2초 분량)

        if (syncSamples.length >= 2) {
            // 두 번째 키프레임 번호 - 첫 번째 키프레임 번호 = 정확한 프레임 간격
            exactGopSize = syncSamples[1].number - syncSamples[0].number;
        }

        console.log(`🎥 이 영상의 분석된 키프레임 주기: ${exactGopSize} 프레임마다 자릅니다.`);

        mp4BoxFile.setSegmentOptions(trackIds.video, bufferQueues, {
            sizePerSegment: 3000,
        });
        mp4BoxFile.setSegmentOptions(trackIds.audio, bufferQueues, {
            sizePerSegment: 3000,
        });
        const init = mp4BoxFile.initializeSegmentation();

        init.tracks.forEach((seg) => {
            //mp4BoxFile.setExtractionOptions(videoTrack.id, seg.user, {
            //    nbSamples: exactGopSize, // 랜덤 칼질 방지, 무조건 키프레임 단위로 패킹됨
            //});
            let queue: ReturnType<typeof createSourceBufferQueue> | null = null;
            if (seg.user) {
                queue = seg.user as ReturnType<typeof createSourceBufferQueue>;
            } else {
                throw new Error('Queue is undefined');
            }
            queue.enqueue(init.buffer);
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
    };
    let setSourced: boolean = false;
    function setSource(
        source: ReturnType<typeof createSourceBufferQueue>,
        Ids: { video: number; audio: number },
    ) {
        console.log('setting source');
        bufferQueues = source;
        trackIds = Ids;
        // setSource 안에서
        setSourced = true;
    }
    function getMime(
        chunk: Uint8Array,
    ): { mime: string; videoId: number; audioId: number } | false {
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
                    AudioCodec = v.codec;
                    audioId = v.id;
                }
            });
            if (!(VideoCodec && AudioCodec && videoId && audioId)) {
                throw new Error("Can't read codec");
            }
            offset = 0;
            return {
                mime: `video/mp4; codecs="${VideoCodec},${AudioCodec}"`,
                videoId: videoId,
                audioId: audioId,
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

    const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as MP4BoxBuffer;

    buffer.fileStart = fileStart;
    return buffer;
}
