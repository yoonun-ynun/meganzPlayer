'use server';
import Player from '@/app/Player/Player';

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string }>;
}) {
    const params = await searchParams;
    const link = params['link'].startsWith('https://')
        ? params['link']
        : 'https://' + params['link'];
    const key = params['key'];
    return (
        <div>
            <Player url={`${link}#${key}`} />
        </div>
    );
}
