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
    const stream = await createByteStream(url);
    const mse = createMediaSourceController(video);
    let is_setting = false;
    let MAX_FORWARD_BUFFER = 10;
    let MAX_BUFFER_QUEUE = 50;

    async function setting(maxForwardBuffer?: number, maxBufferQueue?: number) {
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
            const chunk = await stream.next();
            if (!chunk) {
                break;
            }
            mimeCodec = mse.getMp4Mime(chunk);
        }
        if (!mimeCodec) {
            throw new Error('Not enough metadata to resolve mimeCodec');
        }

        console.log('mimeCodec:', mimeCodec);

        // 2) MediaSource 연결
        await mse.attach(mimeCodec.duration);
        mse.createBuffer(mimeCodec.mime, { video: mimeCodec.videoId, audio: mimeCodec.audioId });
        video.controls = true;
        is_setting = true;
    }

    async function start() {
        if (!is_setting) {
            throw new Error('setting function is not called');
        }
        stream.open(0);
        while (true) {
            const SourceBuffered = mse.getSourceBuffered();
            console.log('videoBuffered:', getBufferedTime(SourceBuffered.video, video));
            console.log('audioBuffered', getBufferedTime(SourceBuffered.audio, video));
            console.log('Buffered', mse.size());

            if (getBufferedTime(SourceBuffered.video, video) > MAX_FORWARD_BUFFER) {
                mse.pause('video');
            } else {
                //mse.snap('resume');
                mse.resume('video');
            }

            if (getBufferedTime(SourceBuffered.audio, video) > MAX_FORWARD_BUFFER) {
                mse.pause('audio');
            } else {
                mse.resume('audio');
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
                const firstStart = video.buffered.start(0);
                // 0.5초는 오차 허용 범위
                if (video.currentTime < firstStart - 0.5) {
                    console.warn(`${video.currentTime}초에서 ${firstStart}초로 점프`);
                    video.currentTime = firstStart + 0.1;
                    continue;
                }
            }

            const step = 2 * 1024 * 1024; // 1MB씩 쪼개기
            for (let offset = 0; offset < chunk.byteLength; offset += step) {
                const subChunk = chunk.slice(offset, offset + step);
                await new Promise((resolve) => setTimeout(resolve, 0));
                mse.append(subChunk);
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

    return {
        setting,
        start,
    };
}
