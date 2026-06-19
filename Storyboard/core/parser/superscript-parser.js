/**
 * Superscript Format Parser
 * Parses .superscript format into the same ScriptAST as the mangaplay parser.
 *
 * Key differences from mangaplay:
 * - PAGE N (no ## prefix, auto-caps)
 * - Panel N / PANEL N (no indent)
 * - SPEAKER: text (colon-terminated dialogue)
 * - SPEAKER: (THOUGHT) for delivery type
 * - : repeats last speaker, :: repeats previous
 * - 2-space or tab indented dialogue text
 * - key: value front matter (plain, no bold markdown)
 * - Auto-numbering with period suffix lock
 * - SFX: SOUND (same as mangaplay)
 *
 * @module superscript-parser
 */

/** @typedef {import('../types.js').ScriptAST} ScriptAST */
/** @typedef {import('../types.js').ScriptMetadata} ScriptMetadata */
/** @typedef {import('../types.js').Page} Page */
/** @typedef {import('../types.js').Panel} Panel */
/** @typedef {import('../types.js').Dialogue} Dialogue */
/** @typedef {import('../types.js').Location} Location */
/** @typedef {import('../types.js').PanelType} PanelType */
/** @typedef {import('../types.js').ReadingDirection} ReadingDirection */
/** @typedef {import('../types.js').DialogueType} DialogueType */

import { extractTags, classifyTags } from './tag-classifier.js';

/**
 * @typedef {Object} ParseError
 * @property {number} line - 0-based line number
 * @property {number} [column] - 0-based column (optional)
 * @property {number} [length] - Length of the offending text (optional)
 * @property {string} message - Human-readable error message
 * @property {'error' | 'warning' | 'info'} severity
 */

// Panel-tag validation moved into `tag-classifier.js` — see
// TODO/PANEL_GRID_REFACTOR.md Section 2 for the new public surface.

// Known front matter keys (case-insensitive)
const KNOWN_FRONT_MATTER_KEYS = new Set([
    'title', 'writer', 'by', 'series', 'issue', 'volume',
    'draft', 'copyright', 'characters', 'vocabulary',
    'email', 'phone', 'address', 'author', 'genre', 'format',
    'pages', 'status'
]);

// =============================================================================
// REGEX PATTERNS
// =============================================================================

const PATTERNS = {
    // Page header: PAGE N or PAGE N. (period locks number)
    // Optional location: PAGE N INT. PLACE - TIME
    // Period after INT/EXT is optional — parser auto-corrects and warns if missing.
    pageHeader: /^PAGE\s+(\d+)(\.)?(?:\s+(INT|EXT)(\.?)\s+(.+?)(?:\s*-\s*(DAY|NIGHT|DAWN|DUSK))?)?$/i,

    // Panel header: Panel N [TYPE] or PANEL N [TYPE] (no indent, multi-tag)
    panel: /^(?:Panel|PANEL)\s+(\d+(?:-\d+)?)(\.)?(?:\s*((?:\s*\[[A-Z][A-Z0-9\s\-\/]*\])+))?$/,

    // Dialogue with colon: SPEAKER: text or SPEAKER: (DELIVERY) text
    dialogueLine: /^([A-Z][A-Z\s']*?)(?:\s+\(O\.P\.\))?:\s*(.*)$/,

    // : shortcut (repeat last speaker)
    lastSpeaker: /^:\s+(.+)$/,

    // :: shortcut (repeat previous speaker)
    prevSpeaker: /^::\s+(.+)$/,

    // Dialogue continuation: 2-space or tab indented text
    dialogueCont: /^(?:\s{2}|\t)(.+)$/,

    // SFX — colon optional; space-form `SFX BOOM` accepted
    sfx: /^SFX(?:\s*:)?\s+(.+)$/i,

    // Front matter: key: value (plain, at top of file before first PAGE)
    frontMatter: /^([a-zA-Z][a-zA-Z\s]*):\s+(.+)$/,

    // Title heading (optional, first # line)
    title: /^#\s+(.+)$/m
};

// =============================================================================
// PARSER
// =============================================================================

/**
 * Derive reading direction from format metadata
 * @param {string} [format]
 * @returns {ReadingDirection}
 */
function deriveReadingDirection(format)
{
    if (format === 'Manga') return 'RTL';
    return 'LTR';
}

/**
 * Parse front matter (key: value pairs at the top of the file)
 * @param {string[]} lines
 * @param {ParseError[]} errors
 * @returns {{ metadata: ScriptMetadata, contentStart: number }}
 */
function parseFrontMatter(lines, errors)
{
    /** @type {ScriptMetadata} */
    const metadata = {
        title: 'Untitled'
    };

    let contentStart = 0;

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];

        // Stop at first PAGE header
        if (/^PAGE\s+\d/i.test(line))
        {
            contentStart = i;
            break;
        }

        // Title heading
        const titleMatch = line.match(PATTERNS.title);
        if (titleMatch)
        {
            metadata.title = titleMatch[1].trim();
            contentStart = i + 1;
            continue;
        }

        // Empty line
        if (line.trim() === '')
        {
            contentStart = i + 1;
            continue;
        }

        // Front matter key: value
        const fmMatch = line.match(PATTERNS.frontMatter);
        if (fmMatch)
        {
            const key = fmMatch[1].trim().toLowerCase();
            const value = fmMatch[2].trim();

            if (!KNOWN_FRONT_MATTER_KEYS.has(key))
            {
                errors.push({
                    line: i,
                    column: 0,
                    length: fmMatch[1].trim().length,
                    message: `Unknown front matter key: "${fmMatch[1].trim()}"`,
                    severity: 'warning'
                });
            }

            switch (key)
            {
                case 'title':
                    metadata.title = value;
                    break;
                case 'writer':
                case 'by':
                case 'author':
                    metadata.author = value;
                    break;
                case 'genre':
                    metadata.genre = value;
                    break;
                case 'format':
                    metadata.format = /** @type {import('../types.js').Format} */ (value);
                    break;
                case 'pages':
                    metadata.totalPages = parseInt(value, 10);
                    break;
                case 'status':
                    metadata.status = /** @type {import('../types.js').Status} */ (value);
                    break;
                case 'characters':
                {
                    const parts = value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                    if (parts.length > 0)
                    {
                        metadata.characters = metadata.characters
                            ? metadata.characters.concat(parts)
                            : parts;
                    }
                    break;
                }
                case 'vocabulary':
                {
                    const parts = value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                    if (parts.length > 0)
                    {
                        metadata.vocabulary = metadata.vocabulary
                            ? metadata.vocabulary.concat(parts)
                            : parts;
                    }
                    break;
                }
                // Other keys stored but not mapped to standard metadata
                default:
                    break;
            }

            contentStart = i + 1;
            continue;
        }

        // Non-matching line before first page — stop scanning front matter
        contentStart = i;
        break;
    }

    return { metadata, contentStart };
}

/**
 * Parse .superscript format text into ScriptAST.
 * @param {string} text - Raw .superscript content
 * @returns {ScriptAST & { readingDirection: ReadingDirection, errors: ParseError[], format: 'superscript' }}
 */
export function parseSuperscript(text)
{
    /** @type {ParseError[]} */
    const errors = [];

    const lines = text.split('\n');

    const { metadata, contentStart } = parseFrontMatter(lines, errors);
    const pages = parsePages(lines, contentStart, errors);
    const readingDirection = deriveReadingDirection(metadata.format);

    // Auto-count pages if not specified
    if (metadata.totalPages === undefined && pages.length > 0)
    {
        metadata.totalPages = pages.length;
    }

    return { metadata, pages, readingDirection, errors, format: 'superscript' };
}

/**
 * Parse a page ID, handling period-locked numbers
 * @param {string} pageId
 * @returns {{ baseNumber: number, suffix?: string }}
 */
function parsePageId(pageId)
{
    if (pageId.includes('-'))
    {
        const [base, suffix] = pageId.split('-');
        return { baseNumber: parseInt(base, 10), suffix };
    }
    return { baseNumber: parseInt(pageId, 10) };
}

/**
 * Parse all pages from .superscript content
 * @param {string[]} lines
 * @param {number} startLine - Line index to start parsing from
 * @param {ParseError[]} errors
 * @returns {Page[]}
 */
function parsePages(lines, startLine, errors)
{
    /** @type {Page[]} */
    const pages = [];
    /** @type {Page|null} */
    let currentPage = null;
    /** @type {Panel|null} */
    let currentPanel = null;
    /** @type {Dialogue|null} */
    let currentDialogue = null;
    /** @type {string|null} */
    let lastSpeaker = null;
    /** @type {string|null} */
    let prevSpeaker = null;

    let autoPageNum = 1;
    let autoPanelNum = 1;
    let panelIndex = 0;

    for (let i = startLine; i < lines.length; i++)
    {
        const line = lines[i];

        // Skip blank lines (but finalize pending dialogue first)
        if (line.trim() === '')
        {
            if (currentDialogue && currentDialogue.text)
            {
                if (currentPanel) currentPanel.dialogue.push(currentDialogue);
                currentDialogue = null;
            }
            continue;
        }

        // Check for PAGE header
        const pageMatch = line.match(PATTERNS.pageHeader);
        if (pageMatch)
        {
            // Finalize pending dialogue
            if (currentDialogue && currentDialogue.text)
            {
                if (currentPanel) currentPanel.dialogue.push(currentDialogue);
                currentDialogue = null;
            }

            // Finalize previous panel
            if (currentPanel && currentPage)
            {
                currentPanel.lineNumberEnd = findLastContentLine(lines, currentPanel.lineNumber ?? 0, i - 1);
                currentPage.panels.push(currentPanel);
            }

            // Finalize previous page
            if (currentPage)
            {
                pages.push(currentPage);
            }

            const rawNum = parseInt(pageMatch[1], 10);
            const locked = !!pageMatch[2]; // period suffix

            // If locked, use that number; otherwise auto-number
            const pageNum = locked ? rawNum : autoPageNum;
            autoPageNum = pageNum + 1;

            const pageId = String(pageNum);
            const { baseNumber, suffix } = parsePageId(pageId);

            currentPage = {
                id: pageId,
                baseNumber,
                suffix,
                lineNumber: i,
                panels: []
            };

            // Parse location if present
            if (pageMatch[3])
            {
                if (!pageMatch[4])
                {
                    errors.push({
                        line: i,
                        column: line.search(/INT|EXT/i) + pageMatch[3].length,
                        length: 1,
                        message: `Missing period after ${pageMatch[3].toUpperCase()} — expected "${pageMatch[3].toUpperCase()}."`,
                        severity: 'warning'
                    });
                }
                currentPage.location = {
                    type: /** @type {import('../types.js').LocationType} */ (pageMatch[3].toUpperCase()),
                    place: pageMatch[5] ? pageMatch[5].trim() : '',
                    time: pageMatch[6] ? /** @type {import('../types.js').TimeOfDay} */ (pageMatch[6].toUpperCase()) : undefined
                };
            }

            currentPanel = null;
            currentDialogue = null;
            panelIndex = 0;
            autoPanelNum = 1;
            continue;
        }

        if (!currentPage) continue;

        // Check for PANEL header
        const panelMatch = line.match(PATTERNS.panel);
        if (panelMatch)
        {
            // Finalize pending dialogue
            if (currentDialogue && currentDialogue.text)
            {
                if (currentPanel) currentPanel.dialogue.push(currentDialogue);
                currentDialogue = null;
            }

            // Finalize previous panel
            if (currentPanel)
            {
                currentPanel.lineNumberEnd = findLastContentLine(lines, currentPanel.lineNumber ?? 0, i - 1);
                currentPage.panels.push(currentPanel);
            }

            const rawNum = parseInt(panelMatch[1], 10);
            const locked = !!panelMatch[2];
            const displayNumber = locked ? rawNum : autoPanelNum;
            autoPanelNum = displayNumber + 1;

            const rawTagStr = panelMatch[3] ? panelMatch[3].trim() : undefined;
            const individualTags = extractTags(rawTagStr);
            const classified = classifyTags(individualTags, panelIndex);

            for (const w of classified.warnings)
            {
                const col = w.offendingTag
                    ? (() =>
                    {
                        const at = line.indexOf(`[${w.offendingTag}]`);
                        return at >= 0 ? at + 1 : 0;
                    })()
                    : 0;
                errors.push({
                    line: i,
                    column: col,
                    length: w.offendingTag ? w.offendingTag.length : 0,
                    message: w.message,
                    severity: 'warning',
                    code: w.code,
                    offendingTag: w.offendingTag,
                    suggestion: w.suggestion
                });
            }

            currentPanel = {
                index: panelIndex,
                displayNumber,
                type: classified.type ?? /** @type {PanelType} */ (panelIndex === 0 ? 'H' : 'A'),
                modifiers: classified.modifiers,
                description: '',
                dialogue: [],
                sfx: [],
                titleCards: [],
                lineNumber: i,
                lineNumberEnd: i
            };

            panelIndex++;
            currentDialogue = null;
            continue;
        }

        if (!currentPanel) continue;

        // Check for SFX
        const sfxMatch = line.match(PATTERNS.sfx);
        if (sfxMatch)
        {
            // Finalize pending dialogue
            if (currentDialogue && currentDialogue.text)
            {
                currentPanel.dialogue.push(currentDialogue);
                currentDialogue = null;
            }
            currentPanel.sfx.push(sfxMatch[1].trim());
            continue;
        }

        // Check for :: shortcut (previous speaker) — must check before :
        const prevMatch = line.match(PATTERNS.prevSpeaker);
        if (prevMatch && prevSpeaker)
        {
            // Finalize pending dialogue
            if (currentDialogue && currentDialogue.text)
            {
                currentPanel.dialogue.push(currentDialogue);
            }

            const text = prevMatch[1].trim();
            currentDialogue = {
                character: prevSpeaker,
                type: 'speech',
                text,
                offPanel: false
            };
            // Don't swap speakers for :: — it references the one before last
            continue;
        }

        // Check for : shortcut (last speaker)
        const lastMatch = line.match(PATTERNS.lastSpeaker);
        if (lastMatch && lastSpeaker)
        {
            // Finalize pending dialogue
            if (currentDialogue && currentDialogue.text)
            {
                currentPanel.dialogue.push(currentDialogue);
            }

            const text = lastMatch[1].trim();
            currentDialogue = {
                character: lastSpeaker,
                type: 'speech',
                text,
                offPanel: false
            };
            continue;
        }

        // Check for SPEAKER: dialogue
        const dialogueMatch = line.match(PATTERNS.dialogueLine);
        if (dialogueMatch)
        {
            // Finalize pending dialogue
            if (currentDialogue && currentDialogue.text)
            {
                currentPanel.dialogue.push(currentDialogue);
            }

            const speaker = dialogueMatch[1].trim();
            const rest = dialogueMatch[2].trim();
            const offPanel = line.includes('(O.P.)');

            // Track speaker history
            if (lastSpeaker && lastSpeaker !== speaker)
            {
                prevSpeaker = lastSpeaker;
            }
            lastSpeaker = speaker;

            // Check for inline delivery type: (THOUGHT), (WHISPER), (CAPTION)
            /** @type {DialogueType} */
            let dialogueType = 'speech';
            let dialogueText = rest;

            const deliveryMatch = rest.match(/^\((\w+)\)\s*(.*)$/);
            if (deliveryMatch)
            {
                const delivery = deliveryMatch[1].toLowerCase();
                if (['thought', 'whisper', 'caption'].includes(delivery))
                {
                    dialogueType = /** @type {DialogueType} */ (delivery);
                    dialogueText = deliveryMatch[2].trim();
                }
            }

            currentDialogue = {
                character: speaker,
                type: dialogueType,
                text: dialogueText,
                offPanel
            };

            // If text is empty, wait for continuation lines
            if (!dialogueText)
            {
                currentDialogue.text = '';
            }
            continue;
        }

        // Check for dialogue continuation (2-space or tab indented)
        const contMatch = line.match(PATTERNS.dialogueCont);
        if (contMatch && currentDialogue)
        {
            const text = contMatch[1].trim();
            if (currentDialogue.text)
            {
                currentDialogue.text += ' ' + text;
            }
            else
            {
                currentDialogue.text = text;
            }
            continue;
        }

        // Action/description text (anything else after panel header)
        const desc = line.trim();
        if (desc)
        {
            // Finalize pending dialogue first
            if (currentDialogue && currentDialogue.text)
            {
                currentPanel.dialogue.push(currentDialogue);
                currentDialogue = null;
            }

            if (currentPanel.description)
            {
                currentPanel.description += ' ' + desc;
            }
            else
            {
                currentPanel.description = desc;
            }
        }
    }

    // Finalize final dialogue, panel, page
    if (currentDialogue && currentDialogue.text)
    {
        if (currentPanel) currentPanel.dialogue.push(currentDialogue);
    }
    if (currentPanel && currentPage)
    {
        currentPanel.lineNumberEnd = findLastContentLine(lines, currentPanel.lineNumber ?? 0, lines.length - 1);
        currentPage.panels.push(currentPanel);
    }
    if (currentPage)
    {
        pages.push(currentPage);
    }

    // Assign displayNumber (sequential 1-indexed position)
    pages.forEach((page, idx) =>
    {
        page.displayNumber = idx + 1;
    });

    return pages;
}

/**
 * Find the last non-empty line in a range
 * @param {string[]} lines
 * @param {number} start
 * @param {number} end
 * @returns {number}
 */
function findLastContentLine(lines, start, end)
{
    for (let i = end; i >= start; i--)
    {
        if (lines[i] && lines[i].trim() !== '')
        {
            return i;
        }
    }
    return start;
}

export default { parseSuperscript };
