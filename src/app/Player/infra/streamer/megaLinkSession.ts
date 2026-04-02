import { File } from 'megajs';
import { GetFileNetworkError, NoFileError } from '@/app/Player/shared/errors';

export async function openFile(url: string): Promise<{
    name: string;
    size: number;
    file: File;
}> {
    const file = File.fromURL(url);
    let selected: File | null = null;
    try {
        selected = await file.loadAttributes();
    } catch (error: unknown) {
        console.log();
        throw new GetFileNetworkError(error);
    }
    if (selected.directory) {
        throw new NoFileError('Received directory url');
    }
    if (selected.name === null || selected.size === undefined) {
        throw new Error();
    }
    return {
        name: selected.name,
        size: selected.size,
        file: selected,
    };
}
