/**
 * @typedef {'fountain' | 'mangaplay' | 'fdx' | 'fadein' | 'txt' | 'pdf' | null} SniffedFormat
 */

/**
 * @typedef {Object} SniffResult
 * @property {SniffedFormat} format
 * @property {number}        confidence  — 0-1
 * @property {string}        [reason]
 */

const TEXT_PROBE_LIMIT = 8192;

/**
 * @param {string | ArrayBuffer} content
 * @param {string} [extensionHint]  — e.g. '.fdx'
 * @returns {SniffResult}
 */
export function sniffScriptFormat(content, extensionHint)
{
    // --- Binary probes (ArrayBuffer) ---
    if (content instanceof ArrayBuffer)
    {
        const bytes = new Uint8Array(content, 0, Math.min(content.byteLength, 5));

        // 1. PDF magic bytes: %PDF-
        if (bytes.length >= 5
            && bytes[0] === 0x25   // %
            && bytes[1] === 0x50   // P
            && bytes[2] === 0x44   // D
            && bytes[3] === 0x46   // F
            && bytes[4] === 0x2D)  // -
        {
            return { format: 'pdf', confidence: 1 };
        }

        // 2. ZIP magic bytes: PK\x03\x04
        if (bytes.length >= 4
            && bytes[0] === 0x50   // P
            && bytes[1] === 0x4B   // K
            && bytes[2] === 0x03
            && bytes[3] === 0x04)
        {
            return { format: 'fadein', confidence: 0.9, reason: 'ZIP archive (likely Fade In)' };
        }

        // 3. ArrayBuffer but unrecognised
        return { format: null, confidence: 0 };
    }

    // --- Text probes ---

    // 4. Empty / whitespace-only
    if (!content || !content.trim())
    {
        return { format: null, confidence: 0 };
    }

    const snippet = content.slice(0, TEXT_PROBE_LIMIT);

    // 5. FDX XML check
    const trimmedStart = snippet.trimStart();
    if (trimmedStart.startsWith('<?xml') || trimmedStart.startsWith('<FinalDraft'))
    {
        const firstKB = content.slice(0, 1024);
        if (firstKB.includes('<FinalDraft'))
        {
            return { format: 'fdx', confidence: 1 };
        }
        return { format: null, confidence: 0.1, reason: 'XML but not FinalDraft' };
    }

    // 6. Mangaplay heuristics (before Fountain — mangaplay is a superset)
    const hasPageHeader = /^#\s+(?:Page|PAGE)\s+\S/im.test(snippet);
    const hasPanelLine = /^Panel\s+\d/m.test(snippet);
    const hasSfxLine = /^SFX[:\s]/im.test(snippet);

    if (hasPageHeader)
    {
        return { format: 'mangaplay', confidence: 1.0 };
    }
    if (hasPanelLine)
    {
        return { format: 'mangaplay', confidence: 0.8 };
    }
    if (hasSfxLine)
    {
        const hintIsMangaplay = !extensionHint
            || extensionHint === '.mangaplay'
            || extensionHint === '.mangaplay.md';
        if (hintIsMangaplay)
        {
            return { format: 'mangaplay', confidence: 0.7 };
        }
    }

    // 7. Fountain heuristics
    let score = 0;

    if (/^(?:Title|Author|Writer|Draft|Date|Contact|Copyright|Source|Notes)\s*:/im.test(snippet))
    {
        score += 2;
    }
    if (/^(?:INT\.|EXT\.|EST\.|INT\.\/EXT\.)\s/im.test(snippet))
    {
        score += 3;
    }
    if (/^[A-Z][A-Z ]{1,}\s*$/m.test(snippet))
    {
        score += 2;
    }
    if (/\bTO:\s*$/m.test(snippet))
    {
        score += 1;
    }

    if (score >= 5)
    {
        return { format: 'fountain', confidence: 0.9 };
    }
    if (score >= 3)
    {
        return { format: 'fountain', confidence: 0.7 };
    }
    if (score >= 1)
    {
        return { format: 'fountain', confidence: 0.5 };
    }

    // 8. Plain text fallback
    if (extensionHint === '.txt')
    {
        return { format: 'txt', confidence: 0.5 };
    }
    if (extensionHint === '.fountain')
    {
        return { format: 'fountain', confidence: 0.3 };
    }
    return { format: 'txt', confidence: 0.3 };
}

export default { sniffScriptFormat };
