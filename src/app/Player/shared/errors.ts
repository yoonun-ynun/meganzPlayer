export class GetFileNetworkError extends Error {
    code: string;
    constructor(cause: unknown) {
        super('Failed to load file', { cause });
        this.name = 'getFileNetworkError';
        this.code = 'GETFILE_FETCH_ERROR';
    }
}

export class NoFileError extends Error {
    code: string;
    constructor(message: string) {
        super(message);
        this.name = 'NoFileError';
        this.code = 'FILE_NOT_FOUND';
    }
}

export class SharedArrayBufferError extends Error {
    code: string;
    constructor() {
        super('chunk is SharedArrayBuffer');
        this.name = 'SharedArrayBufferError';
        this.code = 'SHARED_BUFFER_ERROR';
    }
}

export class NotMp4Error extends Error {
    code: string;
    constructor() {
        super('This file is Not Mp4');
        this.name = 'NotMp4Error';
        this.code = 'NOT_MP4';
    }
}

export class MediaSourceNotFoundError extends Error {
    code: string;
    constructor() {
        super('MediaSource not found, please attach first');
        this.name = 'MediaSourceNotFoundError';
        this.code = 'MISSING_MEDIA_SOURCE';
    }
}

export class SourceBufferQueueNotFoundError extends Error {
    code: string;
    constructor() {
        super('Source buffer queue not found, please createBuffer first');
        this.name = 'SourceBufferQueueNotFoundError';
        this.code = 'MISSING_BUFFER_QUEUE';
    }
}

export class SourceBufferQueueExistsError extends Error {
    code: string;
    constructor() {
        super('Source buffer queue already exists');
        this.name = 'SourceBufferQueueExistsError';
        this.code = 'BUFFER_QUEUE_EXISTS';
    }
}

export class MediaSourceExistsError extends Error {
    code: string;
    constructor() {
        super('Media source already exists');
        this.name = 'MediaSourceExistsError';
        this.code = 'MEDIA_SOURCE_EXISTS';
    }
}
