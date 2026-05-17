/**
 * Mangaplay Fountain Writer
 * Converts Mangaplay AST to Fountain text format
 *
 * The Fountain format is an intermediate representation that enables:
 * - Standard screenplay export
 * - Compatibility with other screenwriting tools
 * - Single conversion pipeline (AST -> Fountain -> Screenplay)
 *
 * Mangaplay extensions use Fountain notes:
 * - [[TITLE_CARD: epithet | subheader | NAME | age]]
 * - [[SFX: content]]
 * - [[_src:lineStart-lineEnd]] for source mapping
 *
 * @module core/parser/fountain-writer
 */

/** @typedef {import('../types.js').ScriptAST} ScriptAST */
/** @typedef {import('../types.js').Page} Page */
/** @typedef {import('../types.js').Panel} Panel */
/** @typedef {import('../types.js').Dialogue} Dialogue */
/** @typedef {import('../types.js').TitleCard} TitleCard */

import { parseTitleCard } from './screenplay-parser.js';

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Convert a Mangaplay AST to Fountain text format.
 *
 * @param {ScriptAST} ast - Parsed Mangaplay AST
 * @returns {string} Fountain-formatted text
 */
export function mangaplayToFountain(ast)
{
    const lines = [];

    // Title page
    lines.push(...buildTitlePage(ast.metadata));

    // Pages -> scenes
    for (const page of ast.pages)
    {
        lines.push(...buildPageFountain(page));
    }

    return lines.join('\n');
}

// =============================================================================
// TITLE PAGE
// =============================================================================

/**
 * Build Fountain title page block from metadata.
 * Fountain title pages use "Key: Value" at the start of the document,
 * separated from content by a blank line.
 *
 * @param {import('../types.js').ScriptMetadata} metadata
 * @returns {string[]}
 */
function buildTitlePage(metadata)
{
    const lines = [];

    if (metadata.title)
    {
        lines.push(`Title: ${metadata.title}`);
    }

    if (metadata.author)
    {
        lines.push(`Author: ${metadata.author}`);
    }

    if (metadata.genre)
    {
        lines.push(`Genre: ${metadata.genre}`);
    }

    if (metadata.format)
    {
        lines.push(`Format: ${metadata.format}`);
    }

    if (metadata.status)
    {
        lines.push(`Status: ${metadata.status}`);
    }

    // Blank line to end title page
    if (lines.length > 0)
    {
        lines.push('');
    }

    return lines;
}

// =============================================================================
// PAGE TO FOUNTAIN
// =============================================================================

/**
 * Convert a single page to Fountain lines.
 *
 * @param {Page} page
 * @returns {string[]}
 */
function buildPageFountain(page)
{
    const lines = [];

    // Page-level transitions FIRST (e.g. FADE IN: before scene heading)
    if (page.transitions && page.transitions.length > 0)
    {
        for (const t of page.transitions)
        {
            lines.push('');
            lines.push(t.endsWith('TO:') || t.endsWith('IN:') || t === 'FADE OUT.' ? t : `>${t}`);
        }
    }

    // Scene heading from location
    if (page.location)
    {
        let heading = `${page.location.type}. ${page.location.place}`;
        if (page.location.time)
        {
            heading += ` - ${page.location.time}`;
        }
        // Fountain scene headings need a blank line before them
        lines.push('');
        lines.push(heading);
        // Source annotation for page header
        if (page.lineNumber !== undefined)
        {
            lines.push(`[[_src:${page.lineNumber}-${page.lineNumber}]]`);
        }
    }

    // Page-level scene headings (standalone, not from location)
    if (page.sceneHeadings && page.sceneHeadings.length > 0)
    {
        for (const sh of page.sceneHeadings)
        {
            lines.push('');
            lines.push(sh);
        }
    }

    // Process panels
    for (const panel of page.panels)
    {
        lines.push(...buildPanelFountain(panel));
    }

    return lines;
}

// =============================================================================
// PANEL TO FOUNTAIN
// =============================================================================

/**
 * Convert a single panel to Fountain lines.
 *
 * @param {Panel} panel
 * @returns {string[]}
 */
function buildPanelFountain(panel)
{
    const lines = [];
    const lineStart = panel.lineNumber ?? 0;
    const lineEnd = panel.lineNumberEnd ?? lineStart;

    // Panel-level scene headings (inlined on panel line)
    if (panel.sceneHeadings && panel.sceneHeadings.length > 0)
    {
        for (const sh of panel.sceneHeadings)
        {
            lines.push('');
            lines.push(sh);
        }
    }

    // Title cards first
    if (panel.titleCards && panel.titleCards.length > 0)
    {
        for (const tc of panel.titleCards)
        {
            lines.push('');
            lines.push(buildTitleCardNote(tc));
            lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Description as action with TITLE: extraction
    if (panel.description)
    {
        // Match TITLE keyword with optional colon, any casing, in description.
        const titleMatch = panel.description.match(/^TITLE(?::)?\s+(.+)$/im);
        if (titleMatch)
        {
            // Extract title card from description
            const titleCard = parseTitleCard(titleMatch[1]);
            if (titleCard)
            {
                lines.push('');
                lines.push(buildTitleCardNoteFromParsed(titleCard));
                lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
            }

            // Remaining description as action
            const remaining = panel.description.replace(/\n?TITLE(?::)?\s+.+$/im, '').trim();
            if (remaining)
            {
                lines.push('');
                lines.push(remaining);
                lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
            }
        }
        else
        {
            lines.push('');
            lines.push(panel.description);
            lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Dialogue
    if (panel.dialogue && panel.dialogue.length > 0)
    {
        for (const d of panel.dialogue)
        {
            lines.push('');
            lines.push(...buildDialogueFountain(d, lineStart, lineEnd));
        }
    }

    // SFX
    if (panel.sfx && panel.sfx.length > 0)
    {
        for (const sfx of panel.sfx)
        {
            lines.push('');
            lines.push(`[[SFX: ${sfx}]]`);
            lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Transitions
    if (panel.transitions && panel.transitions.length > 0)
    {
        for (const t of panel.transitions)
        {
            lines.push('');
            lines.push(t.endsWith('TO:') ? t : `>${t}`);
            lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Centered text
    if (panel.centered && panel.centered.length > 0)
    {
        for (const c of panel.centered)
        {
            lines.push('');
            lines.push(`>${c}<`);
            lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Lyrics
    if (panel.lyrics && panel.lyrics.length > 0)
    {
        for (const l of panel.lyrics)
        {
            lines.push('');
            lines.push(`~${l}`);
            lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Notes
    if (panel.notes && panel.notes.length > 0)
    {
        for (const n of panel.notes)
        {
            lines.push('');
            lines.push(`[[${n}]]`);
            lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Synopsis
    if (panel.synopsis)
    {
        lines.push('');
        lines.push(`= ${panel.synopsis}`);
        lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
    }

    return lines;
}

// =============================================================================
// DIALOGUE
// =============================================================================

/**
 * Build Fountain dialogue block.
 * Fountain format:
 *   CHARACTER (MODIFIER)
 *   (parenthetical)
 *   Dialogue text
 *
 * @param {Dialogue} d
 * @param {number} lineStart
 * @param {number} lineEnd
 * @returns {string[]}
 */
function buildDialogueFountain(d, lineStart, lineEnd)
{
    const lines = [];

    // Character name (ALL CAPS in Fountain)
    let charLine = d.character;

    // Dual dialogue
    if (d.dualDialogue)
    {
        charLine += ' ^';
    }

    // Modifiers
    if (d.offPanel)
    {
        charLine += ' (O.S.)';
    }
    else if (d.type === 'thought' || d.type === 'caption')
    {
        charLine += ' (V.O.)';
    }

    lines.push(charLine);
    lines.push(`[[_src:${lineStart}-${lineEnd}]]`);

    // Whisper -> parenthetical
    if (d.type === 'whisper')
    {
        lines.push('(whispering)');
        lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
    }

    // Fountain-style parenthetical (from script parser)
    if (d.parenthetical)
    {
        lines.push(`(${d.parenthetical})`);
        lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
    }

    // Dialogue text
    lines.push(d.text);
    lines.push(`[[_src:${lineStart}-${lineEnd}]]`);

    return lines;
}

// =============================================================================
// TITLE CARD NOTES
// =============================================================================

/**
 * Build a Fountain note for a TitleCard from the AST.
 * Format: [[TITLE_CARD: epithet | subheader | NAME | age]]
 *
 * @param {TitleCard} tc - Raw title card from AST
 * @returns {string}
 */
function buildTitleCardNote(tc)
{
    // If tc has pipe-delimited info, use parseTitleCard to normalize
    if (tc.info && tc.info.includes('|'))
    {
        const parsed = parseTitleCard(`${tc.name} | ${tc.info}`);
        if (parsed)
        {
            return buildTitleCardNoteFromParsed(parsed);
        }
    }

    // Simple title card
    const parts = [];

    // Build prefix (type as subheader if not plain TITLE)
    if (tc.type && tc.type !== 'TITLE')
    {
        parts.push(tc.type);
    }

    parts.push(tc.name);

    if (tc.info)
    {
        parts.push(tc.info);
    }

    return `[[TITLE_CARD: ${parts.join(' | ')}]]`;
}

/**
 * Build a Fountain note from a parsed TitleCardElement.
 * Format: [[TITLE_CARD: epithet | subheader | NAME | age]]
 * Only includes non-empty fields.
 *
 * @param {import('./screenplay-parser.js').TitleCardElement} tc
 * @returns {string}
 */
function buildTitleCardNoteFromParsed(tc)
{
    const parts = [];

    // Build prefix from epithet and subheader
    if (tc.meta?.epithet && tc.meta?.subheader)
    {
        parts.push(`${tc.meta.epithet} : ${tc.meta.subheader}`);
    }
    else if (tc.meta?.subheader)
    {
        parts.push(tc.meta.subheader);
    }
    else if (tc.meta?.epithet)
    {
        parts.push(tc.meta.epithet);
    }

    // Name
    parts.push(tc.content);

    // Age/info
    if (tc.meta?.age)
    {
        parts.push(tc.meta.age);
    }

    return `[[TITLE_CARD: ${parts.join(' | ')}]]`;
}
