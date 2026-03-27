'use client';

import { useEffect } from 'react';
import { playbackOrchestra } from '@/app/Player/orchestrators/playback';

export default function Page() {
    useEffect(() => {
        let control;
        (async () => {
            const player = document.getElementById('player') as HTMLVideoElement | null;
            if (player === null) {
                throw new Error('player not found');
            }
            control = await playbackOrchestra('https://mega.nz/file/', player);
            await control.setting();
            control.run();
        })();
    }, []);
    return (
        <div>
            <video id={'player'} style={{ width: '99%' }}></video>
        </div>
    );
}
