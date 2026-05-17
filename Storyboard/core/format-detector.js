/**
 * Format Detector — auto-detect script format from content.
 * Uses heuristics to distinguish .mangaplay from .superscript syntax.
 *
 * @module format-detector
 */

/** @typedef {'mangaplay' | 'superscript'} ScriptFormat */

/**
 * Detect whether the given text is .mangaplay or .superscript format.
 *
 * Heuristics (scored):
 * - `# PAGE` heading => mangaplay
 * - `PAGE N` without `##` + colon dialogue => superscript
 * - 8-space indented dialogue => mangaplay
 * - Colon-terminated speaker names => superscript
 * - `**Key:**` bold metadata => mangaplay
 * - `key: value` plain front matter => superscript
 *
 * @param {string} text - Raw script content
 * @returns {ScriptFormat}
 */
export function detectFormat(text)
{
    if (!text || typeof text !== 'string')
    {
        return 'mangaplay';
    }

    let mangaplayScore = 0;
    let superscriptScore = 0;
    let sawMangaplayPageHeader = false;

    const lines = text.split('\n');

    for (const line of lines)
    {
        // # PAGE N => mangaplay (case-insensitive: Page, PAGE, page all valid)
        // A single mangaplay-style header is sufficient to short-circuit the
        // detector. Without this, a Convention B file (panels at column 0)
        // would accumulate superscript score from its panel lines faster than
        // its single `# PAGE` header could counter.
        if (/^#\s+PAGE\s+\d/i.test(line))
        {
            mangaplayScore += 3;
            sawMangaplayPageHeader = true;
            continue;
        }

        // PAGE N (no ##) => superscript candidate
        if (/^PAGE\s+\d/i.test(line))
        {
            superscriptScore += 3;
            continue;
        }

        // PANEL N (no indent) => superscript
        if (/^PANEL\s+\d/i.test(line) || /^Panel\s+\d/.test(line) && !line.startsWith('    '))
        {
            superscriptScore += 2;
            continue;
        }

        // 4-space indented Panel => mangaplay
        if (/^\s{4}Panel\s+\d/.test(line))
        {
            mangaplayScore += 2;
            continue;
        }

        // Fountain-style metadata: Title:/Author:/Genre:/Format:/Status:/Pages: at file start => mangaplay
        if (/^(?:Title|Author|Genre|Format|Status|Pages):\s*.+$/.test(line))
        {
            mangaplayScore += 2;
            continue;
        }

        // 8-space indented ALL-CAPS name (dialogue speaker in mangaplay)
        if (/^\s{8}[A-Z][A-Z\s']+$/.test(line))
        {
            mangaplayScore += 2;
            continue;
        }

        // SPEAKER: text or SPEAKER: (parenthetical) => superscript colon dialogue
        if (/^[A-Z][A-Z\s']+:\s/.test(line) && !/^SFX:/i.test(line) && !/^TITLE:/i.test(line))
        {
            superscriptScore += 2;
            continue;
        }

        // : shortcut (lone colon at line start) => superscript
        if (/^:{1,2}\s/.test(line))
        {
            superscriptScore += 1;
            continue;
        }

        // # Title heading => both formats use this, slight mangaplay lean
        if (/^#\s+[^#]/.test(line))
        {
            mangaplayScore += 0.5;
            continue;
        }

        // Plain front matter: key: value (lowercase key, before first page) => superscript
        if (/^[a-z][a-z\s]*:\s+.+$/.test(line))
        {
            superscriptScore += 1;
        }
    }

    // Any `# PAGE` header is a definitive mangaplay marker. Short-circuit
    // regardless of how many column-0 `Panel` lines scored superscript.
    if (sawMangaplayPageHeader)
    {
        return 'mangaplay';
    }

    return superscriptScore > mangaplayScore ? 'superscript' : 'mangaplay';
}

export default { detectFormat };
