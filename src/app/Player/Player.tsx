'use client';

import { useEffect } from 'react';
import { playbackOrchestra } from '@/app/Player/orchestrators/playback';

export default function Player({ url }: { url: string }) {
    useEffect(() => {
        let control;
        (async () => {
            const player = document.getElementById('player') as HTMLVideoElement | null;
            if (player === null || url === undefined) {
                throw new Error('player not found');
            }
            control = await playbackOrchestra(url, player);
            await control.setting();
            control.run();
        })();
    }, [url]);
    return (
        <div>
            <video id={'player'} style={{ width: '90%' }}></video>
        </div>
    );
}
