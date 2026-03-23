'use client';

import { createMediaSourceController } from '@/app/Player/infra/mse/MediaSourceController';
import { useEffect } from 'react';
import { createByteStream } from '@/app/Player/infra/mega/megaByteStream';

export default function Page() {
    useEffect(() => {
        (async () => {
            const player = document.getElementById('player') as HTMLVideoElement | null;
            if (player === null) {
                throw new Error('player not found');
            }
            testPlayback(player, await createByteStream(''));
        })();
    }, []);
    return (
        <div>
            <video id={'player'} style={{ width: '99%' }}></video>
        </div>
    );
}

async function testPlayback(
    video: HTMLVideoElement,
    megaByteStream: Awaited<ReturnType<typeof createByteStream>>,
) {
    console.log('testPlayback start');
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

    const mse = createMediaSourceController(video);

    // 3) 스트림 열기
    megaByteStream.open(0);

    // 1) head 읽고 mime 판별
    let mimeCodec: { mime: string; videoId: number; audioId: number } | false = false;
    while (!mimeCodec) {
        const chunk = await megaByteStream.next();
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
    await mse.attach();
    mse.createBuffer(mimeCodec.mime, { video: mimeCodec.videoId, audio: mimeCodec.audioId });
    video.controls = true;
    video.onclick = () => {
        video.play();
    };

    megaByteStream.open(0);
    // 4) 청크 계속 append
    const MAX_FORWARD_BUFFER = 10;
    const MAX_BUFFER_QUEUE = 200;

    while (true) {
        const forwardBuffered = getForwardBufferedSeconds(video);
        console.log('forwardBuffered:', forwardBuffered);
        console.log('bufferQueue', mse.size());

        if (forwardBuffered > MAX_FORWARD_BUFFER) {
            mse.pause();
        } else {
            mse.resume();
        }

        if (mse.size() > MAX_BUFFER_QUEUE) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
        }

        const chunk = await megaByteStream.next();
        if (!chunk) {
            mse.resume();
            return;
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
        if (video.currentTime > 10) {
            mse.remove(0, video.currentTime - 10);
        }
    }
}
function getForwardBufferedSeconds(video: HTMLVideoElement): number {
    const { buffered, currentTime } = video;

    for (let i = 0; i < buffered.length; i++) {
        const start = buffered.start(i);
        const end = buffered.end(i);

        if (currentTime >= start && currentTime <= end) {
            return end - currentTime;
        }
    }

    return 0;
}

function checkMediaSource() {
    return !!window.MediaSource;
}

function concat(arrays: Uint8Array[]) {
    const totalLength = arrays.reduce((acc, value) => acc + value.length, 0);

    const result = new Uint8Array(totalLength);

    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
