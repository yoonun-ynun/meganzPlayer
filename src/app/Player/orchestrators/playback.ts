import { createByteStream } from '@/app/Player/infra/streamer/ByteStream';
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
        changeState('seeking');
        console.log('seeking event');
        function seeking() {
            seek(video.currentTime);
        }
        if (seek_timeout !== null) {
            clearTimeout(seek_timeout);
        }
        seek_timeout = setTimeout(seeking, 500);
    });
    video.addEventListener('ended', () => {
        changeState('stopped');
    });
    video.addEventListener('pause', () => {
        changeState('paused');
    });
    let stream = await createByteStream(url);
    const mse = createMediaSourceController(video);

    type states =
        | 'before'
        | 'setting'
        | 'playing'
        | 'paused'
        | 'seeking'
        | 'stopped'
        | 'seekingBox';
    let states: states = 'before';
    let MAX_FORWARD_BUFFER = 10;
    let MAX_BUFFER_QUEUE = 50;
    let seek_timeout: NodeJS.Timeout | null = null;
    let startPromise: Promise<void> | null = null;

    function getState() {
        return states;
    }

    function changeState(state: states) {
        states = state;
    }

    async function setting(maxForwardBuffer?: number, maxBufferQueue?: number) {
        changeState('setting');
        if (maxForwardBuffer) {
            MAX_FORWARD_BUFFER = maxForwardBuffer;
        }
        if (maxBufferQueue) {
            MAX_BUFFER_QUEUE = maxBufferQueue;
        }

        stream.open(0);

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
            mimeCodec = mse.getter.getMp4Mime(chunk, offset);
        }
        if (!mimeCodec) {
            throw new Error('Not enough metadata to resolve mimeCodec');
        }

        console.log('mimeCodec:', mimeCodec);

        await mse.setup.attach(mimeCodec.duration);
        mse.setup.createBuffer(mimeCodec.mime, {
            video: mimeCodec.videoId,
            audio: mimeCodec.audioId,
        });
        video.controls = true;
        stream.close();
    }

    function run() {
        startPromise = start(0);
        changeState('playing');
    }

    async function start(startByte?: number) {
        if (getState() === 'before') {
            throw new Error('setting function is not called');
        }

        if (startByte !== undefined) {
            stream = await createByteStream(url);
            stream.open(startByte);
        }
        while (true) {
            if (getState() === 'seeking') {
                return;
            }

            appendBuffer();

            if (video.currentTime > 10) {
                mse.control.remove(0, video.currentTime - 10);
                //mse.snap('remove');
            }

            if (getMaxQueue()) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                continue;
            }

            jumpGap();

            const offset = stream.getOffset();
            const chunk = await stream.next();
            if (!chunk) {
                console.log('null chunk');
                await new Promise((resolve) => setTimeout(resolve, 1000));
                if (mse.getter.size().video === 0 && mse.getter.size().audio === 0) {
                    const result = mse.control.sendSourceEnded();
                    if (result) return;
                    else console.log('sourceEnded returned false');
                }
                continue;
            }

            // IMPORTANT:
            // mp4box appendBuffer() returned next offset was unreliable in our playback flow.
            // Using it caused parser/decode errors.
            // We only use mp4box offset for initial seek byte calculation, then advance offsets linearly.
            const chunk_result = mse.queueing.append(chunk, offset);
            if (getState() === 'seekingBox' && stream.getOffset() !== chunk_result) {
                console.log('restream');
                stream.open(chunk_result);
            }
        }
    }

    function appendBuffer() {
        const SourceBuffered = mse.getter.getSourceBuffered();

        const videoBuffered = getBufferedTime(SourceBuffered.video, video);
        const audioBuffered = getBufferedTime(SourceBuffered.audio, video);

        setTrackFlow('video', videoBuffered > MAX_FORWARD_BUFFER);
        setTrackFlow('audio', audioBuffered > MAX_FORWARD_BUFFER);

        if (getState() === 'seekingBox' && videoBuffered > 0 && audioBuffered > 0) {
            changeState('playing');
        }
    }

    function jumpGap() {
        if (video.buffered.length > 0 && getState() !== 'seeking') {
            const playable = firstPlayableStart(
                mse.getter.getSourceBuffered().video,
                mse.getter.getSourceBuffered().audio,
            );
            // 0.5초는 오차 허용 범위
            if (playable && video.currentTime < playable.start - 0.5) {
                console.warn(`${video.currentTime}초에서 ${playable.start}초로 점프`);
                video.currentTime = playable.start + 0.1;
            }
        }
    }

    function getMaxQueue() {
        const queue_max =
            mse.getter.size().video > MAX_BUFFER_QUEUE || mse.getter.size().audio > 20;
        const empty_queue = mse.getter.size().video !== 0 && mse.getter.size().audio !== 0;
        return queue_max && empty_queue;
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
        console.log('seek function');
        await startPromise;
        while (mse.getter.size().audio > 0 || mse.getter.size().video > 0) {
            mse.control.resume('video');
            mse.control.resume('audio');
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (
            video.buffered.length > 0 &&
            video.buffered.end(video.buffered.length - 1) > time &&
            time > mse.getter.getSourceBuffered().video.start(0)
        ) {
            changeState('playing');
            startPromise = start();
            return;
        }
        mse.queueing.reset();
        const video_length = mse.getter.getSourceBuffered().video.length;
        const audio_length = mse.getter.getSourceBuffered().audio.length;
        if (video_length || audio_length) {
            const video_end =
                video_length > 0 ? mse.getter.getSourceBuffered().video.end(video_length - 1) : 1;
            const audio_end =
                audio_length > 0 ? mse.getter.getSourceBuffered().audio.end(audio_length - 1) : 1;
            mse.control.remove(0, video_end > audio_end ? video_end : audio_end);
        }
        stream.close();
        const startByte = mse.getter.getSeekByte(time);
        console.log('startByte:', startByte);
        changeState('seekingBox');
        console.log('seeked');
        startPromise = start(startByte.offset);
    }

    function setTrackFlow(track: 'video' | 'audio', shouldPause: boolean) {
        if (shouldPause) {
            mse.control.pause(track);
        } else {
            mse.control.resume(track);
        }
    }

    return {
        setting,
        run,
        seek,
        getState,
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
