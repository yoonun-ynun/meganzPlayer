import { createByteStream } from '@/app/Player/infra/mega/megaByteStream';
import { createMediaSourceController } from '@/app/Player/infra/mse/MediaSourceController';

export async function playbackOrchestra(url: string, video: HTMLVideoElement) {
    video.addEventListener('error', () => {
        const err = video.error;
        if (err) {
            console.error('video error:', err.code);
            switch (err.code) {
                case 1:
                    console.error('MEDIA_ERR_ABORTED: 사용자가 멈춤');
                    break;
                case 2:
                    console.error('MEDIA_ERR_NETWORK: 네트워크 끊김 (이 구간 다운 실패)');
                    break;
                case 3:
                    console.error('MEDIA_ERR_DECODE: 디코딩/파싱 실패');
                    break;
                case 4:
                    console.error('MEDIA_ERR_SRC_NOT_SUPPORTED: 지원 안 하는 코덱/포맷');
                    break;
            }
            console.error('상세 메시지:', err.message);
        }
    });
    video.addEventListener('seeking', () => {
        states = 'seeking';
        console.log('seeking event');
        function seeking() {
            seek(video.currentTime);
        }
        if (seek_timeout !== null) {
            clearTimeout(seek_timeout);
        }
        seek_timeout = setTimeout(seeking, 500);
    });
    let stream = await createByteStream(url);
    const mse = createMediaSourceController(video);
    let states: 'before' | 'setting' | 'playing' | 'paused' | 'seeking' | 'stopped' | 'seekingBox' =
        'before';
    let MAX_FORWARD_BUFFER = 10;
    let MAX_BUFFER_QUEUE = 50;
    let seek_timeout: NodeJS.Timeout | null = null;
    let startPromise: Promise<void> | null = null;
    let meta = new Uint8Array();

    async function setting(maxForwardBuffer?: number, maxBufferQueue?: number) {
        states = 'setting';
        if (maxForwardBuffer) {
            MAX_FORWARD_BUFFER = maxForwardBuffer;
        }
        if (maxBufferQueue) {
            MAX_BUFFER_QUEUE = maxBufferQueue;
        }

        stream.open(0);

        // 1) head 읽고 mime 판별
        let mimeCodec:
            | {
                  mime: { video: string; audio: string };
                  videoId: number;
                  audioId: number;
                  duration: number;
              }
            | false = false;
        while (!mimeCodec) {
            const offset = stream.getOffset();
            const chunk = await stream.next();
            if (!chunk) {
                break;
            }
            meta = concatUint8Array([meta, chunk]);
            mimeCodec = mse.getMp4Mime(chunk, offset);
        }
        if (!mimeCodec) {
            throw new Error('Not enough metadata to resolve mimeCodec');
        }

        console.log('mimeCodec:', mimeCodec);

        // 2) MediaSource 연결
        await mse.attach(mimeCodec.duration);
        mse.createBuffer(mimeCodec.mime, { video: mimeCodec.videoId, audio: mimeCodec.audioId });
        video.controls = true;
        stream.close();
    }

    function run() {
        startPromise = start(0);
        states = 'playing';
    }

    async function start(startByte: number) {
        if (states === 'before') {
            throw new Error('setting function is not called');
        }
        console.log('startByte', startByte);
        stream = await createByteStream(url);
        stream.open(startByte);
        while (true) {
            if (states === 'seeking') {
                return;
            }
            const SourceBuffered = mse.getSourceBuffered();

            const videoBuffered = getBufferedTime(SourceBuffered.video, video);
            const audioBuffered = getBufferedTime(SourceBuffered.audio, video);

            setTrackFlow('video', videoBuffered > MAX_FORWARD_BUFFER);
            setTrackFlow('audio', audioBuffered > MAX_FORWARD_BUFFER);

            if (states === 'seekingBox' && videoBuffered > 0 && audioBuffered > 0) {
                states = 'playing';
            }

            if (video.currentTime > 10) {
                mse.remove(0, video.currentTime - 10);
                //mse.snap('remove');
            }

            if (
                (mse.size().video > MAX_BUFFER_QUEUE || mse.size().audio > 20) &&
                mse.size().video !== 0 &&
                mse.size().audio !== 0
            ) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                continue;
            }

            const offset = stream.getOffset();
            const chunk = await stream.next();
            if (!chunk) {
                console.log('null chunk');
                await new Promise((resolve) => setTimeout(resolve, 1000));
                if (mse.size().video === 0 && mse.size().audio === 0) {
                    const result = mse.sendSourceEnded();
                    if (result) return;
                    else console.log('sourceEnded returned false');
                }
                continue;
            }
            if (video.buffered.length > 0) {
                const playable = firstPlayableStart(
                    mse.getSourceBuffered().video,
                    mse.getSourceBuffered().audio,
                );
                // 0.5초는 오차 허용 범위
                if (playable && video.currentTime < playable.start - 0.5) {
                    console.warn(`${video.currentTime}초에서 ${playable.start}초로 점프`);
                    video.currentTime = playable.start + 0.1;
                    continue;
                }
            }

            // IMPORTANT:
            // mp4box appendBuffer() returned next offset was unreliable in our playback flow.
            // Using it caused parser/decode errors.
            // We only use mp4box offset for initial seek byte calculation, then advance offsets linearly.
            const chunk_result = mse.append(chunk, offset);
            if (states === 'seekingBox' && stream.getOffset() !== chunk_result) {
                console.log('restream');
                stream.open(chunk_result);
            }
        }
    }
    function getBufferedTime(time: TimeRanges, video: HTMLVideoElement) {
        const current = video.currentTime;

        let forwardBuffered = 0;
        for (let i = 0; i < time.length; i++) {
            if (time.start(i) <= current && current <= time.end(i)) {
                forwardBuffered = time.end(i) - current;
                break;
            }
        }
        return forwardBuffered;
    }
    async function seek(time: number) {
        if (
            video.buffered.length > 0 &&
            video.buffered.end(video.buffered.length - 1) > time &&
            time > mse.getSourceBuffered().video.start(0)
        ) {
            return;
        }
        console.log('seek function');
        await startPromise;
        mse.reset();
        const video_length = mse.getSourceBuffered().video.length;
        const audio_length = mse.getSourceBuffered().audio.length;
        if (video_length || audio_length) {
            const video_end =
                video_length > 0 ? mse.getSourceBuffered().video.end(video_length - 1) : 1;
            const audio_end =
                audio_length > 0 ? mse.getSourceBuffered().audio.end(audio_length - 1) : 1;
            mse.remove(0, video_end > audio_end ? video_end : audio_end);
        }
        stream.close();
        const startByte = mse.getSeekByte(time);
        console.log('startByte:', startByte);
        states = 'seekingBox';
        console.log('seeked');
        startPromise = start(startByte.offset);
    }

    function setTrackFlow(track: 'video' | 'audio', shouldPause: boolean) {
        if (shouldPause) {
            mse.pause(track);
        } else {
            mse.resume(track);
        }
    }

    return {
        setting,
        run,
        seek,
    };
}

function firstPlayableStart(videoSb?: TimeRanges, audioSb?: TimeRanges) {
    if (!videoSb || !audioSb) return null;
    if (videoSb.length === 0 || audioSb.length === 0) return null;

    const start = Math.max(videoSb.start(0), audioSb.start(0));
    const end = Math.min(videoSb.end(0), audioSb.end(0));

    if (start >= end) return null;
    return { start, end };
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
