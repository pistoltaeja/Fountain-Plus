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
import { formatPageHeading } from '../export/export-styles.js';

const STANDARD_HEADING_RE = /^(INT|EXT|EST|INT\.\/EXT\.|INT\/EXT|EXT\.\/INT\.|EXT\/INT|I\/E|E\/I)\.?\s/i;
const ACTION_NEEDS_FORCE_RE = /^[A-Z][A-Z0-9\s'&,.\-:]+$/;
// Matches the cue-body shape that fountain-parser's character regex accepts
// (parser regex at fountain-parser.js:38). Cues that fail this need to be
// emitted with a leading `@` force-cue marker so round-trip parsing works.
const NATURAL_CUE_RE = /^[A-Z][A-Z0-9\s'&,.\-]+$/;

// =============================================================================
// MAIN EXPORTS
// =============================================================================

/**
 * Convert a Screenplay object to Fountain text format.
 * Used for non-mangaplay inputs (FDX, Fade In, TXT, PDF) that parse directly to Screenplay.
 *
 * @param {import('./screenplay-parser.js').Screenplay} screenplay
 * @param {Object} [options]
 * @param {import('../export/export-styles.js').PageHeadingStyleValue} [options.pageHeadingStyle] - Optional page heading style; emitted as a synopsis line when set so it survives Fountain re-parse.
 * @param {import('../export/export-styles.js').PanelHeadingStyleValue} [options.panelHeadingStyle] - Optional panel heading style; reserved for future use.
 * @param {string} [options.locale='en'] - Locale tag for longhand page headings.
 * @returns {string}
 */
export function screenplayToFountain(screenplay, options = {})
{
    const lines = [];
    const pageHeadingStyle = options.pageHeadingStyle;
    const locale = options.locale || 'en';
    const pageHeadingText = pageHeadingStyle ? formatPageHeading(1, pageHeadingStyle, locale) : null;
    void pageHeadingText;

    // Title page — multi-line values use tab-indented continuation lines
    const titleFields = [
        ['Title', screenplay.title],
        ['Author', screenplay.author],
        ['Credit', screenplay.credit],
        ['Source', screenplay.source],
        ['Draft date', screenplay.draftDate],
        ['Contact', screenplay.contact],
        ['Copyright', screenplay.copyright],
        ['Notes', screenplay.notes],
    ];
    for (const [key, value] of titleFields)
    {
        if (!value) continue;
        const fieldLines = value.split('\n');
        lines.push(`${key}: ${fieldLines[0]}`);
        for (let i = 1; i < fieldLines.length; i++)
        {
            lines.push(`\t${fieldLines[i]}`);
        }
    }

    // Extra centered title-page metadata (episode subtitle, draft label, studio,
    // production co., producer credits) that pdf-reader captures but the schema
    // doesn't have dedicated slots for. Emit as a single multi-line `Notes:`
    // field so the round-trip preserves them.
    if (!screenplay.notes && Array.isArray(screenplay.titlePageExtra) && screenplay.titlePageExtra.length > 0)
    {
        const extras = screenplay.titlePageExtra.filter(s => typeof s === 'string' && s.trim());
        if (extras.length > 0)
        {
            lines.push(`Notes: ${extras[0]}`);
            for (let i = 1; i < extras.length; i++)
            {
                lines.push(`\t${extras[i]}`);
            }
        }
    }

    if (lines.length > 0) lines.push('');

    for (const scene of screenplay.scenes)
    {
        if (scene.heading)
        {
            lines.push('');
            const needsForce = !STANDARD_HEADING_RE.test(scene.heading);
            let headingLine = needsForce ? `.${scene.heading}` : scene.heading;
            if (scene.sceneLabel)
            {
                headingLine += ` #${scene.sceneLabel}#`;
            }
            lines.push(headingLine);
        }

        for (const el of scene.elements)
        {
            switch (el.type)
            {
                case 'scene_heading':
                {
                    lines.push('');
                    const needsForce = !STANDARD_HEADING_RE.test(el.content);
                    lines.push(needsForce ? `.${el.content}` : el.content);
                    break;
                }
                case 'action':
                    lines.push('');
                    if (el.meta?.centered)
                    {
                        lines.push(`> ${el.content.trim()} <`);
                    }
                    else if (el.meta?.lyrics)
                    {
                        lines.push(`~${el.content}`);
                    }
                    else
                    {
                        const firstLine = el.content.split('\n')[0];
                        if (ACTION_NEEDS_FORCE_RE.test(firstLine))
                        {
                            lines.push('!' + el.content);
                        }
                        else
                        {
                            lines.push(el.content);
                        }
                    }
                    break;
                case 'character':
                {
                    lines.push('');
                    // Strip Fountain emphasis markers — the character-cue regex
                    // requires plain ALL-CAPS and rejects asterisks/underscores,
                    // so a cue like "**MILDRED**" would re-parse as action and
                    // drag the following dialogue into action with it.
                    const plain = el.content
                        .replace(/\*{1,3}/g, '')
                        .replace(/_/g, '');
                    let charLine = plain.toUpperCase();
                    if (el.meta?.modifier)
                    {
                        charLine += ` (${el.meta.modifier.toUpperCase()})`;
                    }
                    if (el.meta?.dualDialogue)
                    {
                        charLine += ' ^';
                    }
                    // Force-cue prefix `@` for cues whose body fountain-parser's
                    // character regex won't accept (e.g. `S/1 CAPTION` — slash
                    // not allowed; `V/O CAPTION` likewise). The `@` is stripped
                    // by parseFountain on re-parse so the resulting cue content
                    // is unchanged.
                    if (!NATURAL_CUE_RE.test(plain.toUpperCase()))
                    {
                        charLine = '@' + charLine;
                    }
                    lines.push(charLine);
                    break;
                }
                case 'parenthetical':
                {
                    const text = el.content;
                    if (text.startsWith('(') && text.endsWith(')'))
                    {
                        lines.push(text);
                    }
                    else
                    {
                        lines.push(`(${text})`);
                    }
                    break;
                }
                case 'dialogue':
                {
                    // Dialogue emphasis-marker safety: the pattern "/**" (slash
                    // immediately before bold markers) confuses the fountain
                    // parser into treating the markers as an opening run, which
                    // swallows the following slug. Pad with a space so the
                    // parser sees the marker cleanly. Other emphasis preserved.
                    let dialogueContent = el.content;
                    dialogueContent = dialogueContent.replace(/\/(\*{1,3})/g, '/ $1');
                    lines.push(dialogueContent);
                    break;
                }
                case 'transition':
                {
                    lines.push('');
                    const t = el.content;
                    if (t.endsWith('TO:') || t === 'FADE OUT.' || t === 'FADE IN:')
                    {
                        lines.push(t);
                    }
                    else
                    {
                        lines.push(`> ${t}`);
                    }
                    break;
                }
                case 'page_break':
                    lines.push('');
                    lines.push('===');
                    break;
                case 'synopsis':
                    lines.push('');
                    lines.push(`= ${el.content}`);
                    break;
                case 'section':
                    lines.push('');
                    lines.push(`# ${el.content}`);
                    break;
                case 'note':
                    lines.push('');
                    lines.push(`[[${el.content}]]`);
                    break;
                case 'title_card':
                {
                    lines.push('');
                    if (el.meta?.segments && el.meta.segments.length > 0)
                    {
                        const segText = el.meta.segments.map(s => s.text).join(' | ');
                        lines.push(`[[TITLE_CARD: ${segText}]]`);
                    }
                    else
                    {
                        lines.push(`[[TITLE_CARD: ${el.content}]]`);
                    }
                    break;
                }
                case 'sfx':
                    lines.push('');
                    lines.push(`[[SFX: ${el.content}]]`);
                    break;
                case 'soundtrack':
                    lines.push('');
                    lines.push(`[[SOUNDTRACK: ${el.content}]]`);
                    break;
            }
        }
    }

    return lines.join('\n');
}

/**
 * Convert a Mangaplay AST to Fountain text format.
 *
 * @param {ScriptAST} ast - Parsed Mangaplay AST
 * @param {{ includeSourceMap?: boolean, preserveMangaplay?: boolean }} [options] - Options
 * @returns {string} Fountain-formatted text
 */
export function mangaplayToFountain(ast, options = {})
{
    const preserveMangaplay = options.preserveMangaplay !== false;
    const includeSourceMap = preserveMangaplay && options.includeSourceMap === true;
    const lines = [];

    // Title page
    lines.push(...buildTitlePage(ast.metadata, preserveMangaplay));

    // Pages -> scenes
    for (const page of ast.pages)
    {
        lines.push(...buildPageFountain(page, includeSourceMap, preserveMangaplay));
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
 * @param {boolean} [preserveMangaplay=true]
 * @returns {string[]}
 */
function buildTitlePage(metadata, preserveMangaplay = true)
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

    if (metadata.credit)
    {
        lines.push(`Credit: ${metadata.credit}`);
    }

    if (metadata.source)
    {
        lines.push(`Source: ${metadata.source}`);
    }

    if (metadata.draftDate)
    {
        lines.push(`Draft date: ${metadata.draftDate}`);
    }

    if (metadata.contact)
    {
        lines.push(`Contact: ${metadata.contact}`);
    }

    if (metadata.copyright)
    {
        lines.push(`Copyright: ${metadata.copyright}`);
    }

    if (metadata.notes)
    {
        lines.push(`Notes: ${metadata.notes}`);
    }

    if (preserveMangaplay)
    {
        if (metadata.format)
        {
            lines.push(`Format: ${metadata.format}`);
        }

        if (metadata.status)
        {
            lines.push(`Status: ${metadata.status}`);
        }
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
 * @param {boolean} includeSourceMap
 * @param {boolean} preserveMangaplay
 * @returns {string[]}
 */
function buildPageFountain(page, includeSourceMap, preserveMangaplay)
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
        if (includeSourceMap && page.lineNumber !== undefined)
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
        lines.push(...buildPanelFountain(panel, includeSourceMap, preserveMangaplay));
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
 * @param {boolean} includeSourceMap
 * @param {boolean} preserveMangaplay
 * @returns {string[]}
 */
function buildPanelFountain(panel, includeSourceMap, preserveMangaplay)
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
            if (preserveMangaplay)
            {
                lines.push(buildTitleCardNote(tc));
            }
            else
            {
                const name = tc.name || tc.info || '';
                lines.push(`>${name}<`);
            }
            if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Description and dialogue — interleaved by original source order.
    // Dialogue items carry _afterDescPara indicating which description
    // paragraph they follow. When absent, all dialogue comes after all
    // description (legacy behaviour).
    const descForFountain = panel.rawDescription || panel.description;
    const dialogueItems = panel.dialogue && panel.dialogue.length > 0 ? panel.dialogue : [];
    const hasOrdering = dialogueItems.length > 0 && dialogueItems[0]._afterDescPara != null;

    if (hasOrdering)
    {
        const descParas = descForFountain ? descForFountain.split('\n\n') : [];
        let dIdx = 0;
        while (dIdx < dialogueItems.length && dialogueItems[dIdx]._afterDescPara === 0)
        {
            lines.push('');
            lines.push(...buildDialogueFountain(dialogueItems[dIdx], lineStart, lineEnd, includeSourceMap));
            dIdx++;
        }
        for (let pIdx = 0; pIdx < descParas.length; pIdx++)
        {
            const para = descParas[pIdx];
            const titleMatch = para.match(/^TITLE(?::)?\s+(.+)$/im);
            if (titleMatch)
            {
                const titleCard = parseTitleCard(titleMatch[1]);
                if (titleCard)
                {
                    lines.push('');
                    if (preserveMangaplay)
                    {
                        lines.push(buildTitleCardNoteFromParsed(titleCard));
                    }
                    else
                    {
                        lines.push(`>${titleCard.content || ''}<`);
                    }
                    if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
                }
                const remaining = para.replace(/\n?TITLE(?::)?\s+.+$/im, '').trim();
                if (remaining)
                {
                    lines.push('');
                    lines.push(remaining);
                    if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
                }
            }
            else
            {
                lines.push('');
                lines.push(para);
                if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
            }

            while (dIdx < dialogueItems.length && dialogueItems[dIdx]._afterDescPara === pIdx + 1)
            {
                lines.push('');
                lines.push(...buildDialogueFountain(dialogueItems[dIdx], lineStart, lineEnd, includeSourceMap));
                dIdx++;
            }
        }
        while (dIdx < dialogueItems.length)
        {
            lines.push('');
            lines.push(...buildDialogueFountain(dialogueItems[dIdx], lineStart, lineEnd, includeSourceMap));
            dIdx++;
        }
    }
    else
    {
        if (descForFountain)
        {
            const titleMatch = descForFountain.match(/^TITLE(?::)?\s+(.+)$/im);
            if (titleMatch)
            {
                const titleCard = parseTitleCard(titleMatch[1]);
                if (titleCard)
                {
                    lines.push('');
                    if (preserveMangaplay)
                    {
                        lines.push(buildTitleCardNoteFromParsed(titleCard));
                    }
                    else
                    {
                        lines.push(`>${titleCard.content || ''}<`);
                    }
                    if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
                }
                const remaining = descForFountain.replace(/\n?TITLE(?::)?\s+.+$/im, '').trim();
                if (remaining)
                {
                    lines.push('');
                    lines.push(remaining);
                    if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
                }
            }
            else
            {
                lines.push('');
                lines.push(descForFountain);
                if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
            }
        }
        for (const d of dialogueItems)
        {
            lines.push('');
            lines.push(...buildDialogueFountain(d, lineStart, lineEnd, includeSourceMap));
        }
    }

    // SFX
    if (panel.sfx && panel.sfx.length > 0)
    {
        for (const sfx of panel.sfx)
        {
            lines.push('');
            if (preserveMangaplay)
            {
                lines.push(`[[SFX: ${sfx}]]`);
            }
            else
            {
                lines.push(`SFX: ${sfx}`);
            }
            if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Transitions
    if (panel.transitions && panel.transitions.length > 0)
    {
        for (const t of panel.transitions)
        {
            lines.push('');
            lines.push(t.endsWith('TO:') ? t : `>${t}`);
            if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Centered text
    if (panel.centered && panel.centered.length > 0)
    {
        for (const c of panel.centered)
        {
            lines.push('');
            lines.push(`>${c}<`);
            if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Lyrics
    if (panel.lyrics && panel.lyrics.length > 0)
    {
        for (const l of panel.lyrics)
        {
            lines.push('');
            lines.push(`~${l}`);
            if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Notes
    if (panel.notes && panel.notes.length > 0)
    {
        for (const n of panel.notes)
        {
            lines.push('');
            lines.push(`[[${n}]]`);
            if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
        }
    }

    // Synopsis
    if (panel.synopsis)
    {
        lines.push('');
        lines.push(`= ${panel.synopsis}`);
        if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
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
function buildDialogueFountain(d, lineStart, lineEnd, includeSourceMap)
{
    const lines = [];

    if (!d.continuation)
    {
        // Character name (ALL CAPS in Fountain)
        let charLine = d.character;

        // Modifiers (extensions) — must come before dual dialogue caret per Fountain spec
        if (d.modifier && Array.isArray(d.modifier))
        {
            for (const ext of d.modifier)
            {
                charLine += ` (${ext})`;
            }
        }
        else if (d.offPanel)
        {
            charLine += ' (O.S.)';
        }
        else if (d.type === 'thought' || d.type === 'caption')
        {
            charLine += ' (V.O.)';
        }

        // Dual dialogue
        if (d.dualDialogue)
        {
            charLine += ' ^';
        }

        lines.push(charLine);
        if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
    }

    // Whisper -> parenthetical
    if (d.type === 'whisper')
    {
        lines.push('(whispering)');
        if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
    }

    // Fountain-style parenthetical (from script parser)
    if (d.parenthetical)
    {
        lines.push(`(${d.parenthetical})`);
        if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);
    }

    // Dialogue text (prefer rawText to preserve emphasis markers for the Fountain pipeline)
    lines.push(d.rawText || d.text);
    if (includeSourceMap) lines.push(`[[_src:${lineStart}-${lineEnd}]]`);

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
