'use client';

import { createMediaSourceController } from '@/app/Player/infra/mse/MediaSourceController';
import { checkMime } from '@/app/Player/infra/mse/MimeSupport';
import { useEffect } from 'react';
import { createByteStream } from '@/app/Player/infra/mega/megaByteStream';

export default function Page() {
    useEffect(() => {
        (async () => {
            const player = document.getElementById('player') as HTMLVideoElement | null;
            if (player === null) {
                throw new Error('player not found');
            }
            testPlayback(
                player,
                await createByteStream(
                    'https://mega.nz/file/2gpDWYKI#EvTVjwzMKg74kau6QWr3H65GDjG2qnJtC05aF3nfMQw',
                ),
            );
        })();
    }, []);
    return (
        <div>
            <video id={'player'}></video>
        </div>
    );
}

async function testPlayback(
    video: HTMLVideoElement,
    megaByteStream: Awaited<ReturnType<typeof createByteStream>>,
) {
    console.log('testPlayback start');
    // 1) head 읽고 mime 판별
    const head = await megaByteStream.readHead(16 * 1024 * 1024);
    const mimeCodec = await checkMime(head);

    if (!mimeCodec) {
        throw new Error('Not enough metadata to resolve mimeCodec');
    }

    console.log('mimeCodec:', mimeCodec);

    // 2) MediaSource 연결
    const mse = createMediaSourceController(video);
    await mse.attach();
    mse.createBuffer(mimeCodec);

    // 3) 스트림 열기
    megaByteStream.open(0);
    video.click = () => {
        video.play();
    };

    // 4) 청크 계속 append
    const MAX_FORWARD_BUFFER = 20;

    while (true) {
        const forwardBuffered = getForwardBufferedSeconds(video);

        if (forwardBuffered > MAX_FORWARD_BUFFER) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
        }

        const chunk = await megaByteStream.next();
        if (!chunk) break;

        mse.append(chunk);
    }

    // 5) 재생 시도
    await video.play();

    return mse;
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
