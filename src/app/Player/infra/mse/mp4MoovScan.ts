type MoovScanResult =
    | { status: 'not-mp4' }
    | { status: 'no-moov' }
    | { status: 'partial-moov'; moovOffset: number; moovSize: number }
    | { status: 'complete-moov'; moovOffset: number; moovSize: number };

function readUint32BE(bytes: Uint8Array, offset: number): number {
    return (
        ((bytes[offset] << 24) |
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3]) >>>
        0
    );
}

function readType(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    );
}

function isMp4(bytes: Uint8Array): boolean {
    for (let i = 0; i <= Math.min(bytes.length - 8, 64); i++) {
        if (
            bytes[i + 4] === 0x66 && // f
            bytes[i + 5] === 0x74 && // t
            bytes[i + 6] === 0x79 && // y
            bytes[i + 7] === 0x70 // p
        ) {
            return true;
        }
    }
    return false;
}

export function scanMoov(bytes: Uint8Array): MoovScanResult {
    if (!isMp4(bytes)) {
        return { status: 'not-mp4' };
    }

    let offset = 0;

    while (offset + 8 <= bytes.length) {
        let size = readUint32BE(bytes, offset);
        const type = readType(bytes, offset + 4);

        let headerSize = 8;

        if (size === 0) {
            // box extends to EOF
            size = bytes.length - offset;
        } else if (size === 1) {
            // 64-bit largesize
            if (offset + 16 > bytes.length) {
                return { status: 'no-moov' };
            }

            const high = readUint32BE(bytes, offset + 8);
            const low = readUint32BE(bytes, offset + 12);
            const bigSize = high * 2 ** 32 + low;

            if (!Number.isSafeInteger(bigSize) || bigSize < 16) {
                return { status: 'no-moov' };
            }

            size = bigSize;
            headerSize = 16;
        } else if (size < 8) {
            return { status: 'no-moov' };
        }

        const boxEnd = offset + size;

        if (type === 'moov') {
            if (boxEnd <= bytes.length) {
                return { status: 'complete-moov', moovOffset: offset, moovSize: size };
            }
            return { status: 'partial-moov', moovOffset: offset, moovSize: size };
        }

        if (boxEnd <= offset) {
            return { status: 'no-moov' };
        }

        if (boxEnd > bytes.length) {
            // current box itself is cut off
            return { status: 'no-moov' };
        }

        offset = boxEnd;
    }

    return { status: 'no-moov' };
}
