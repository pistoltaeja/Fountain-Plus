/**
 * Plain Text Screenplay Parser
 *
 * Reads plain text screenplay files and returns a Screenplay object
 * using heuristic detection of screenplay formatting conventions.
 *
 * @module core/import/txt-reader
 */

/**
 * @typedef {'scene_heading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'page_break' | 'synopsis' | 'section' | 'note'} ScreenplayElementType
 */

/**
 * @typedef {Object} ScreenplayElement
 * @property {ScreenplayElementType} type
 * @property {string} content
 * @property {Object} [meta]
 * @property {string} [meta.modifier]
 * @property {number} [sourceLineStart]
 * @property {number} [sourceLineEnd]
 */

/**
 * @typedef {Object} ScreenplayScene
 * @property {string} heading
 * @property {number} sceneNumber
 * @property {ScreenplayElement[]} elements
 * @property {string} [pageId]
 */

/**
 * @typedef {Object} Screenplay
 * @property {string} title
 * @property {string} [author]
 * @property {string} [credit]
 * @property {string} [source]
 * @property {string} [draftDate]
 * @property {string} [contact]
 * @property {string} [copyright]
 * @property {string} [notes]
 * @property {ScreenplayScene[]} scenes
 */

// =============================================================================
// REGEXES
// =============================================================================

const SCENE_HEADING_RE = /^(INT|EXT|EST|INT\.\/EXT\.|INT\/EXT|I\/E)[\.\s\/]/i;
const CHARACTER_CUE_RE = /^[A-Z][A-Z0-9\s'&,\-]+$/;
const CHARACTER_EXT_RE = /^(.+?)\s*\(([^)]+)\)\s*$/;
const TRANSITION_RE = /^[A-Z][A-Z\s]+TO:$/;
const FADE_RE = /^(FADE OUT\.|FADE IN:)$/;
const PAGE_BREAK_RE = /^={3,}$/;
const TITLE_KEY_RE = /^(Title|Author|Written by|Credit|Source|Draft date|Contact|Copyright|Notes)\s*:\s*(.+)$/i;

// =============================================================================
// TITLE PAGE DETECTION
// =============================================================================

/**
 * Try to extract a title page from the first lines of text.
 * Title page is Key: Value lines at the top, terminated by a blank line.
 *
 * @param {string[]} lines
 * @returns {{ meta: Partial<Screenplay>, consumed: number }}
 */
function extractTitlePage(lines)
{
    /** @type {Partial<Screenplay>} */
    const meta = {};
    let consumed = 0;
    let foundAny = false;

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];

        if (line.trim() === '')
        {
            if (foundAny)
            {
                consumed = i + 1;
            }
            break;
        }

        const match = line.match(TITLE_KEY_RE);
        if (!match)
        {
            break;
        }

        foundAny = true;
        const key = match[1].toLowerCase();
        const value = match[2].trim();

        if (key === 'title') meta.title = value;
        else if (key === 'author' || key === 'written by') meta.author = value;
        else if (key === 'credit') meta.credit = value;
        else if (key === 'source') meta.source = value;
        else if (key === 'draft date') meta.draftDate = value;
        else if (key === 'contact') meta.contact = value;
        else if (key === 'copyright') meta.copyright = value;
        else if (key === 'notes') meta.notes = value;
    }

    return { meta, consumed };
}

// =============================================================================
// LINE CLASSIFICATION
// =============================================================================

/**
 * @param {string} line
 * @returns {boolean}
 */
function isSceneHeading(line)
{
    return SCENE_HEADING_RE.test(line.trim());
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isTransition(line)
{
    const trimmed = line.trim();
    return TRANSITION_RE.test(trimmed) || FADE_RE.test(trimmed);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isPageBreak(line)
{
    return PAGE_BREAK_RE.test(line.trim()) || line.includes('\f');
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isParenthetical(line)
{
    const trimmed = line.trim();
    return trimmed.startsWith('(') && trimmed.endsWith(')');
}

/**
 * Test whether a line looks like a character cue.
 * Must be ALL CAPS, < 40 chars, match the cue regex, and not be a scene heading,
 * transition, or page break.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isCharacterCue(line)
{
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length >= 40) return false;

    const withoutExt = trimmed.replace(/\s*\([^)]+\)\s*$/, '');
    if (!CHARACTER_CUE_RE.test(withoutExt)) return false;

    if (isSceneHeading(trimmed)) return false;
    if (isTransition(trimmed)) return false;
    if (isPageBreak(trimmed)) return false;

    return true;
}

// =============================================================================
// ELEMENT BUILDING
// =============================================================================

/**
 * Build a ScreenplayElement from a classified line.
 * @param {ScreenplayElementType} type
 * @param {string} content
 * @param {number} lineNum
 * @returns {ScreenplayElement}
 */
function makeElement(type, content, lineNum)
{
    return {
        type,
        content,
        sourceLineStart: lineNum,
        sourceLineEnd: lineNum,
    };
}

/**
 * Parse a character cue line, extracting any extension (V.O., O.S., etc).
 * @param {string} line
 * @param {number} lineNum
 * @returns {ScreenplayElement}
 */
function makeCharacterElement(line, lineNum)
{
    const trimmed = line.trim();
    const match = trimmed.match(CHARACTER_EXT_RE);
    if (match)
    {
        return {
            type: 'character',
            content: match[1].trim(),
            meta: { modifier: match[2].trim() },
            sourceLineStart: lineNum,
            sourceLineEnd: lineNum,
        };
    }
    return makeElement('character', trimmed, lineNum);
}

// =============================================================================
// CONTENT PARSING (STATE MACHINE)
// =============================================================================

/**
 * Parse lines into a flat array of ScreenplayElements using heuristic detection.
 * @param {string[]} lines
 * @param {number} startLine - 1-based line number offset (for sourceLineStart)
 * @returns {ScreenplayElement[]}
 */
function parseLines(lines, startLine)
{
    /** @type {ScreenplayElement[]} */
    const elements = [];

    /** @type {'neutral' | 'dialogue'} */
    let state = 'neutral';
    let prevBlank = true;

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];
        const trimmed = line.trim();
        const lineNum = startLine + i;

        if (trimmed === '')
        {
            prevBlank = true;
            state = 'neutral';
            continue;
        }

        if (isPageBreak(line))
        {
            elements.push(makeElement('page_break', '', lineNum));
            prevBlank = true;
            state = 'neutral';
            continue;
        }

        if (isSceneHeading(trimmed))
        {
            elements.push(makeElement('scene_heading', trimmed, lineNum));
            prevBlank = false;
            state = 'neutral';
            continue;
        }

        if (state === 'neutral' && isTransition(trimmed))
        {
            elements.push(makeElement('transition', trimmed, lineNum));
            prevBlank = false;
            continue;
        }

        if (state === 'neutral' && prevBlank && isCharacterCue(trimmed))
        {
            elements.push(makeCharacterElement(trimmed, lineNum));
            prevBlank = false;
            state = 'dialogue';
            continue;
        }

        if (state === 'dialogue')
        {
            if (isParenthetical(trimmed))
            {
                elements.push(makeElement('parenthetical', trimmed, lineNum));
                prevBlank = false;
                continue;
            }

            elements.push(makeElement('dialogue', trimmed, lineNum));
            prevBlank = false;
            continue;
        }

        elements.push(makeElement('action', trimmed, lineNum));
        prevBlank = false;
    }

    return elements;
}

// =============================================================================
// SCENE GROUPING
// =============================================================================

/**
 * Group flat elements into scenes by scene_heading boundaries.
 * @param {ScreenplayElement[]} elements
 * @returns {ScreenplayScene[]}
 */
function groupIntoScenes(elements)
{
    /** @type {ScreenplayScene[]} */
    const scenes = [];
    let currentScene = { heading: '', sceneNumber: 0, elements: [] };
    let sceneCounter = 0;

    for (const el of elements)
    {
        if (el.type === 'scene_heading')
        {
            if (currentScene.elements.length > 0 || currentScene.heading)
            {
                scenes.push(currentScene);
            }
            sceneCounter++;
            currentScene = {
                heading: el.content,
                sceneNumber: sceneCounter,
                elements: [],
            };
            continue;
        }

        currentScene.elements.push(el);
    }

    scenes.push(currentScene);
    return scenes;
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Parse plain text into a Screenplay object using heuristic detection.
 *
 * @param {string} text - Raw plain text content
 * @returns {Screenplay}
 */
export function parseTxt(text)
{
    if (!text || text.trim() === '')
    {
        return { title: '', scenes: [] };
    }

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    /** @type {Screenplay} */
    const screenplay = { title: '', scenes: [] };

    const { meta, consumed } = extractTitlePage(lines);
    if (meta.title) screenplay.title = meta.title;
    if (meta.author) screenplay.author = meta.author;
    if (meta.credit) screenplay.credit = meta.credit;
    if (meta.source) screenplay.source = meta.source;
    if (meta.draftDate) screenplay.draftDate = meta.draftDate;
    if (meta.contact) screenplay.contact = meta.contact;
    if (meta.copyright) screenplay.copyright = meta.copyright;
    if (meta.notes) screenplay.notes = meta.notes;

    const contentLines = lines.slice(consumed);
    const elements = parseLines(contentLines, consumed + 1);
    screenplay.scenes = groupIntoScenes(elements);

    return screenplay;
}
