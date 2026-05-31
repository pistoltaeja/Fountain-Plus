/**
 * Screenplay Statistics — Analyzer Utilities
 *
 * Ingestion pipeline: every supported format is parsed into a Screenplay
 * object, then flattened to a token array before reaching computeStatistics().
 *
 *   Format        Parser                          Intermediate        Output
 *   ──────────    ─────────────────────────────    ──────────────      ──────────
 *   .fountain     parseFountain(text)              —                   Screenplay
 *   .mangaplay    parseScript(text) → AST          → Fountain text     Screenplay
 *                   astToScreenplay(ast)              (mangaplayToFountain → parseFountain)
 *   .fdx          parseFdx(xml)                    —                   Screenplay
 *   .fadein       parseFadein(zip)                 —                   Screenplay
 *   .txt          parseTxt(text)                   —                   Screenplay
 *   .pdf          parsePdf(buf, getDocument)       —                   Screenplay
 *
 *   Screenplay → screenplayToTokens() → [{type, text, line}, ...]
 *                                          ↓
 *                                   computeStatistics(tokens)
 *
 * Only .mangaplay passes through Fountain text as an intermediate step.
 * All other formats parse directly into a Screenplay object.
 *
 * The token array is the common contract consumed by:
 *   - computeStatistics()   (fountain-statistics/index.js)
 *   - runHeuristics()       (checker-heuristics.js)
 *   - classifyWarnings()    (checker-critical.js)
 *
 * Character detection: characters are registered only from 'character' type
 * tokens (dialogue cues), never from action text. A character with a
 * 'character' token but zero subsequent 'dialogue' tokens will have
 * speakingParts: 0.
 */

/**
 * @param {string} text
 * @returns {number}
 */
export function countWords(text)
{
    return (text.match(/\S+/g) || []).length;
}

/**
 * @param {string} word
 * @returns {number}
 */
export function countSyllables(word)
{
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
    if (cleaned.length <= 3)
    {
        return 1;
    }
    let vowelGroups = (cleaned.match(/[aeiouy]+/g) || []).length;
    if (/e$/.test(cleaned) && vowelGroups > 1)
    {
        vowelGroups -= 1;
    }
    if (/[^aeiouy]le$/.test(cleaned))
    {
        vowelGroups += 1;
    }
    return Math.max(1, vowelGroups);
}

/**
 * @param {string} text
 * @returns {number}
 */
export function countSentences(text)
{
    return Math.max(1, (text.match(/[.!?]+/g) || []).length);
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripInlineNotes(text)
{
    return text.replace(/\[\[[\s\S]*?\]\]/g, '');
}

/**
 * @param {string} text
 * @returns {number}
 */
export function estimateDialogueDuration(text)
{
    const words = text.split(/\s+/).filter(w => w.length > 0);
    let totalSyllables = 0;
    for (const word of words)
    {
        totalSyllables += countSyllables(word);
    }
    const baseDuration = totalSyllables * 0.195;
    const periods = (text.match(/[.!?:]\s/g) || []).length;
    const commas = (text.match(/,\s/g) || []).length;
    const pauses = (periods * 0.75) + (commas * 0.3);
    return baseDuration + pauses;
}

/**
 * @param {string} text
 * @returns {number}
 */
export function estimateActionDuration(text)
{
    return stripInlineNotes(text).length / 20;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function slugify(text)
{
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeTime(text)
{
    return text
        .toLowerCase()
        .replace(/\.$/, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^(?:(?:the|next|following|early|late)\s+)+/i, '')
        .trim();
}

/**
 * @param {string} text
 * @returns {{ location: string, intExt: string, timeOfDay: string }}
 */
export function parseSceneHeading(text)
{
    if (text.length > 200)
    {
        return { location: text.slice(0, 80), intExt: 'other', timeOfDay: '' };
    }

    const regex = /^(?:\.(?!\.)|(?:int\.?\/?ext|ext\.?\/?int|i\.?\/?e|e\.?\/?i|int|ext|est)[. ])(.+?)(?:\s*#[-.0-9a-z]+#)?$/i;
    const match = text.match(regex);

    if (!match)
    {
        return { location: text.trim(), intExt: 'other', timeOfDay: '' };
    }

    const prefix = text.toLowerCase();
    let intExt = 'other';

    const hasInt = /^(?:int|i[. /])/.test(prefix);
    const hasExt = /^(?:ext|e[. /])/.test(prefix);
    const hasBoth = /^(?:int\.?\/?ext|ext\.?\/?int|i\.?\/?e|e\.?\/?i)[. ]/i.test(prefix);

    if (hasBoth)
    {
        intExt = 'mixed';
    }
    else if (hasInt)
    {
        intExt = 'int';
    }
    else if (hasExt)
    {
        intExt = 'ext';
    }

    // Split at the LAST space-dash-space separator (hyphen, en-dash, or em-dash)
    const body = match[1].trim();
    const separatorRe = /\s+[-–—]\s+/g;
    let lastSepStart = -1;
    let lastSepEnd = -1;
    let sepMatch;
    while ((sepMatch = separatorRe.exec(body)) !== null)
    {
        lastSepStart = sepMatch.index;
        lastSepEnd = sepMatch.index + sepMatch[0].length;
    }

    let location, timeOfDay;
    if (lastSepStart > 0)
    {
        location = body.slice(0, lastSepStart).trim();
        timeOfDay = body.slice(lastSepEnd).trim();
    }
    else
    {
        location = body;
        timeOfDay = '';
    }

    return { location, intExt, timeOfDay };
}

/**
 * @param {Set<string>} set
 * @returns {string}
 */
export function resolveIntExt(set)
{
    if (set.has('int') && set.has('ext'))
    {
        return 'mixed';
    }
    if (set.has('int'))
    {
        return 'int';
    }
    if (set.has('ext'))
    {
        return 'ext';
    }
    return 'other';
}

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeCharacterFallback(text)
{
    return text
        .replace(/\s*\^\s*$/, '')
        .replace(/\s*(?:\([^)]+\)\s*)+$/, '')
        .trim()
        .toUpperCase();
}
