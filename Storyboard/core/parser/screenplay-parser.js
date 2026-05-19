/**
 * Mangaplay Screenplay Parser
 * Converts Mangaplay script format to screenplay format
 *
 * This parser transforms mangaplay markdown format into a structured screenplay
 * representation that can be rendered with proper screenplay formatting.
 *
 * Key features:
 * - Converts AST to Screenplay via Fountain intermediate format
 * - Extracts title cards with epithet, class, name, and age
 * - Validates screenplay structure
 * - Renders screenplay to HTML and JSON
 *
 * @module core/parser/screenplay-parser
 */

/** @typedef {import('../types.js').ScriptAST} ScriptAST */

import { mangaplayToFountain } from './fountain-writer.js';
import { parseFountain } from './fountain-parser.js';

// =============================================================================
// SCREENPLAY TYPES (JSDoc)
// =============================================================================

/**
 * @typedef {'scene_heading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'title_card' | 'sfx' | 'soundtrack' | 'page_break' | 'synopsis' | 'section' | 'note'} ScreenplayElementType
 */

/**
 * @typedef {Object} ScreenplayElement
 * @property {ScreenplayElementType} type
 * @property {string} content
 * @property {Object} [meta] - Additional metadata
 * @property {string} [meta.modifier] - V.O., O.S., etc.
 * @property {string} [meta.parenthetical] - thought, whisper, etc.
 * @property {number} [sourceLineStart] - Source line start (0-based)
 * @property {number} [sourceLineEnd] - Source line end (0-based)
 */

/**
 * Single ordered segment of a title card. The renderer iterates
 * `meta.segments` in source order and chooses font per segment based on
 * `isName`: the name segment renders in Impact, all others in Courier Prime.
 *
 * @typedef {Object} TitleCardSegment
 * @property {string} text - Raw segment text as authored.
 * @property {boolean} isName - true for the character-name segment.
 */

/**
 * Title card element representing a character introduction card.
 *
 * Generalised pipe-delimited format:
 *   `TITLE: seg1 | seg2 | ... | segN`
 *
 * Exactly one segment is the CHARACTER NAME (detected via ALL CAPS
 * heuristic, with comma/apostrophe/ampersand/digit allowances). All other
 * segments are freeform descriptors (Role Parenthetical, Subtitle
 * Parenthetical, age, etc.) and render in Courier Prime.
 *
 * Legacy fields (`content`, `meta.epithet`, `meta.subheader`, `meta.age`)
 * are preserved so existing renderers and Fountain round-tripping keep
 * working. New renderers should prefer `meta.segments`.
 *
 * @typedef {Object} TitleCardElement
 * @property {'title_card'} type
 * @property {string} content - The character name (rendered in Impact font)
 * @property {Object} meta
 * @property {TitleCardSegment[]} [meta.segments] - Ordered segments preserving source order
 * @property {string} [meta.epithet] - Legacy: first descriptor before class
 * @property {string} [meta.subheader] - Legacy: Role Parenthetical (descriptor near name)
 * @property {string} [meta.age] - Legacy: Subtitle Parenthetical (descriptor after name)
 * @property {number} [sourceLineStart] - Source line start (0-based)
 * @property {number} [sourceLineEnd] - Source line end (0-based)
 */

/**
 * @typedef {Object} ScreenplayScene
 * @property {string} heading - Scene heading (INT./EXT. LOCATION - TIME)
 * @property {number} sceneNumber
 * @property {ScreenplayElement[]} elements
 * @property {string} [pageId] - Source page ID
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
// PATTERNS
// =============================================================================

const PATTERNS = {
    // All caps character name (for title card parsing).
    // Allows letters, spaces, apostrophe, ampersand, comma, and digits
    // (e.g., "AGENT 47", "CHURIN, IV ALASTAIR", "BONNIE & CLYDE").
    allCapsName: /^[A-Z][A-Z0-9\s'&,]+$/,
};

/**
 * Heuristic: does this segment look like a CHARACTER NAME?
 * Strips a single leading/trailing parenthetical wrapper before testing —
 * a name in parentheses (rare) is still a name. Empty / lowercase-leading /
 * "Age ..." / pure-parenthetical role descriptors return false.
 *
 * @param {string} segment
 * @returns {boolean}
 */
function looksLikeName(segment)
{
    const s = segment.trim();
    if (!s) return false;

    // Pure parenthetical (e.g. "(Commissariat : Model Llama)") is a descriptor.
    if (s.startsWith('(') && s.endsWith(')')) return false;

    // "Age 44", "Age XX (appears YY)" — descriptor.
    if (/^Age\s/i.test(s)) return false;

    return PATTERNS.allCapsName.test(s);
}

// =============================================================================
// TITLE CARD PARSER
// =============================================================================

/**
 * Parse a condensed title card line into structured data.
 *
 * Supported formats:
 * 1. "Enemy Of The State : Executive Class | DOROTHY | Age 44"
 *    -> epithet: "Enemy Of The State", subheader: "Executive Class", name: "DOROTHY", age: "Age 44"
 *
 * 2. "Executive Class | DOROTHY | Age 44"
 *    -> subheader: "Executive Class", name: "DOROTHY", age: "Age 44"
 *
 * 3. "DOROTHY | Age 44"
 *    -> name: "DOROTHY", age: "Age 44"
 *
 * 4. "CHURIN, IV ALASTAIR | (Commissariat : Model Llama)"
 *    -> name: "CHURIN, IV ALASTAIR", age: "(Commissariat : Model Llama)"
 *
 * 5. "7th Division Mortal Pacifist : Executive Class | ORACLE | Age XX"
 *    -> epithet: "7th Division Mortal Pacifist", subheader: "Executive Class", name: "ORACLE", age: "Age XX"
 *
 * @param {string} content - The content after "TITLE: "
 * @returns {TitleCardElement | null}
 */
export function parseTitleCard(content)
{
    // Split by pipe delimiter
    const parts = content.split('|').map(p => p.trim());

    if (parts.length < 2)
    {
        return null;
    }

    /** @type {TitleCardElement} */
    const titleCard = {
        type: 'title_card',
        content: '',
        meta: {}
    };

    // -----------------------------------------------------------------------
    // Locate the CHARACTER NAME segment.
    //
    // Preference order, only the FIRST match becomes the name segment:
    //   1. A part that passes the strict ALL CAPS name heuristic.
    //   2. (Two-part legacy fallback) first part if second part is clearly
    //      a descriptor (Age / parenthetical / lowercase-leading).
    //   3. (3+ part legacy fallback) middle part (`parts[1]`).
    //
    // This preserves every previously-passing test while accepting the new
    // formats where the name appears in the middle and the descriptors are
    // freeform (e.g. "Executive Class : Enemy Of The State, | DOROTHY | Age 44").
    // -----------------------------------------------------------------------
    let nameIndex;
    if (parts.length >= 3)
    {
        // 3+ parts: middle part (`parts[1]`) is ALWAYS treated as the name.
        // This matches original parser behavior — the prefix may itself be
        // ALL CAPS-ish (e.g. "Executive Class : Enemy Of The State,") and
        // we still want the middle segment to be the character. Suffix
        // segments are descriptors regardless of capitalisation.
        nameIndex = 1;
    }
    else
    {
        // 2 parts: prefer the strict ALL CAPS name heuristic. If neither
        // segment passes ALL CAPS, fall back to a parenthetical-sibling
        // rule: when EXACTLY ONE segment is wrapped in (...), the OTHER
        // segment is the name (regardless of casing). This catches
        // Title-cased names like "Cincinnati Cid | (19)" or
        // "Minnesota Baddie | (19)". Final fallback: first segment.
        const allCapsIdx = parts.findIndex(p => looksLikeName(p));
        if (allCapsIdx !== -1)
        {
            nameIndex = allCapsIdx;
        }
        else
        {
            const isParen = parts.map(p =>
            {
                const t = p.trim();
                return t.startsWith('(') && t.endsWith(')');
            });
            if (isParen[0] !== isParen[1])
            {
                nameIndex = isParen[0] ? 1 : 0;
            }
            else
            {
                nameIndex = 0;
            }
        }
    }

    // Build ordered segments preserving source order.
    /** @type {TitleCardSegment[]} */
    const segments = parts.map((text, i) => ({
        text,
        isName: i === nameIndex
    }));

    titleCard.meta.segments = segments;
    titleCard.content = parts[nameIndex] || '';

    // -----------------------------------------------------------------------
    // Populate legacy `epithet` / `subheader` / `age` fields for backward
    // compatibility with existing renderers, Fountain round-trip, and tests.
    //
    //   epithet   = first descriptor's pre-colon half (or the whole thing)
    //   subheader = first descriptor's post-colon half (Role Parenthetical)
    //   age       = first descriptor AFTER the name (Subtitle Parenthetical)
    // -----------------------------------------------------------------------
    const beforeName = parts.slice(0, nameIndex);
    const afterName = parts.slice(nameIndex + 1);

    if (beforeName.length > 0)
    {
        const prefix = beforeName.join(' | ');
        if (prefix.includes(':'))
        {
            const colonIndex = prefix.indexOf(':');
            const epithet = prefix.substring(0, colonIndex).trim().replace(/,$/, '').trim();
            const classTitle = prefix.substring(colonIndex + 1).trim().replace(/,$/, '').trim();
            if (epithet) titleCard.meta.epithet = epithet;
            if (classTitle) titleCard.meta.subheader = classTitle;
        }
        else
        {
            titleCard.meta.subheader = prefix;
        }
    }

    if (afterName.length > 0)
    {
        titleCard.meta.age = afterName.join(' | ');
    }

    return titleCard;
}

// =============================================================================
// SCREENPLAY VALIDATION
// =============================================================================

/**
 * @typedef {Object} ScreenplayError
 * @property {number} line - 0-based line number
 * @property {string} message - Human-readable error message
 * @property {'error' | 'warning' | 'info'} severity
 * @property {string} [pageId] - Source page ID
 */

/**
 * Validate screenplay-specific issues from the AST.
 * Returns errors that feed into the error panel system.
 *
 * Checks:
 * - Character speaking with no dialogue text
 * - Page with no panels
 * - Empty panel (no action, no dialogue, no SFX, no title card)
 *
 * @param {ScriptAST} ast
 * @returns {ScreenplayError[]}
 */
export function validateScreenplay(ast)
{
    /** @type {ScreenplayError[]} */
    const errors = [];

    for (const page of ast.pages)
    {
        const pageLine = page.lineNumber ?? 0;

        // Page with no panels
        if (!page.panels || page.panels.length === 0)
        {
            errors.push({
                line: pageLine,
                message: `PAGE ${page.id} has no panels`,
                severity: 'warning',
                pageId: page.id
            });
            continue;
        }

        for (const panel of page.panels)
        {
            const panelLine = panel.lineNumber ?? pageLine;

            // Empty panel check
            const hasContent = (panel.description && panel.description.trim()) ||
                               (panel.dialogue && panel.dialogue.length > 0) ||
                               (panel.sfx && panel.sfx.length > 0) ||
                               (panel.titleCards && panel.titleCards.length > 0);

            if (!hasContent)
            {
                errors.push({
                    line: panelLine,
                    message: `PAGE ${page.id}, Panel ${panel.displayNumber}: empty panel (no action, dialogue, SFX, or title card)`,
                    severity: 'warning',
                    pageId: page.id
                });
            }

            // Character with no dialogue text
            if (panel.dialogue)
            {
                for (const d of panel.dialogue)
                {
                    if (d.character && (!d.text || !d.text.trim()))
                    {
                        errors.push({
                            line: panelLine,
                            message: `PAGE ${page.id}, Panel ${panel.displayNumber}: ${d.character} speaks but has no dialogue text`,
                            severity: 'error',
                            pageId: page.id
                        });
                    }
                }
            }
        }
    }

    return errors;
}

// =============================================================================
// FULL SCRIPT CONVERTER
// =============================================================================

/**
 * Convert a full Mangaplay script AST to screenplay format.
 * Uses the Fountain pipeline: AST -> Fountain text -> Screenplay object.
 * @param {ScriptAST} ast - The parsed Mangaplay AST
 * @returns {Screenplay}
 */
export function astToScreenplay(ast)
{
    const fountain = mangaplayToFountain(ast);
    const screenplay = parseFountain(fountain);

    for (const scene of screenplay.scenes)
    {
        let inMidSpeechParen = false;
        for (let i = 1; i < scene.elements.length; i++)
        {
            const el = scene.elements[i];
            const prev = scene.elements[i - 1];
            if (el.type === 'action'
                && el.content.startsWith('(') && el.content.endsWith(')')
                && (prev.type === 'dialogue' || prev.type === 'parenthetical'))
            {
                el.type = 'parenthetical';
                el.content = el.content.slice(1, -1);
                inMidSpeechParen = true;
            }
            else if (inMidSpeechParen && el.type === 'action')
            {
                el.type = 'dialogue';
                inMidSpeechParen = false;
            }
            else
            {
                inMidSpeechParen = false;
            }
        }
    }

    return screenplay;
}

// =============================================================================
// HTML RENDERING
// =============================================================================

/**
 * Render a screenplay to HTML
 * @param {Screenplay} screenplay
 * @param {Object} [options]
 * @param {boolean} [options.includeTitles=true] - Include title cards
 * @param {string} [options.impactFontPath] - Path to Impact font file (optional)
 * @param {string} [options.courierPrimeFontPath] - Path to Courier Prime Regular font file (optional)
 * @returns {string}
 */
export function renderScreenplayToHtml(screenplay, options = {})
{
    const { includeTitles = true, impactFontPath, courierPrimeFontPath } = options;

    // Build font-face rule for Impact
    const impactFontFace = impactFontPath
        ? `@font-face {
    font-family: 'Impact';
    src: url('${impactFontPath}') format('truetype');
    font-weight: normal;
    font-style: normal;
}`
        : `@font-face {
    font-family: 'Impact';
    src: local('Impact'), local('Impact Regular');
}`;

    // Build font-face rule for Courier Prime (local font, no external CDN)
    const courierPrimeFontFace = courierPrimeFontPath
        ? `@font-face {
    font-family: 'Courier Prime';
    src: url('${courierPrimeFontPath}') format('truetype');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
}`
        : `@font-face {
    font-family: 'Courier Prime';
    src: local('Courier Prime'), local('Courier Prime Regular');
    font-display: swap;
}`;

    // PDF HTML: fixed Courier Prime / Impact stack only; not tied to app locale CSS variables.
    // body line-height/color/background: keep in sync with --mps-screenplay-line-height, --mps-screenplay-ink, --mps-screenplay-paper in fonts-local.css / fonts-cdn.css.
    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${courierPrimeFontFace}
${impactFontFace}

body {
    font-family: 'Courier Prime', Courier, monospace;
    font-size: 12pt;
    max-width: 8.5in;
    margin: 0 auto;
    padding: 1in;
    line-height: 1.5;
    color: #000;
    background: #fff;
}

p { margin: 0; }

.title-page {
    text-align: center;
    margin-bottom: 2em;
}

.scene-heading {
    text-align: left;
    margin-top: 1em;
    text-transform: uppercase;
}

.action {
    text-align: left;
    margin-top: 0.5em;
}

.character {
    text-align: center;
    margin-top: 1em;
    text-transform: uppercase;
}

.parenthetical {
    text-align: center;
}

.dialogue {
    text-align: center;
}

.sfx {
    text-align: left;
    margin-top: 0.5em;
    text-transform: uppercase;
}

/* Title Card Styling - Character Introduction Cards */
.title-card {
    text-align: center;
    margin: 1.5em 0;
    padding: 1em 0;
}

.title-card-epithet {
    font-family: 'Courier Prime', Courier, monospace;
    font-size: 12pt;
    letter-spacing: 0.05em;
    margin-bottom: 0.25em;
    display: block;
}

.title-card-subheader {
    font-family: 'Courier Prime', Courier, monospace;
    font-size: 12pt;
    margin-bottom: 0.25em;
    display: block;
}

.title-card-name {
    font-family: Impact, 'Arial Black', sans-serif;
    font-size: 48pt;
    line-height: 1.1;
    letter-spacing: 0.02em;
    display: block;
    margin: 0.1em 0;
}

.title-card-age {
    font-family: 'Courier Prime', Courier, monospace;
    font-size: 12pt;
    margin-top: 0.25em;
    display: block;
}

.transition {
    text-align: right;
}

.soundtrack {
    font-style: italic;
    margin-top: 0.5em;
}

.soundtrack a {
    color: #0066cc;
    text-decoration: none;
}

.soundtrack a:hover {
    text-decoration: underline;
}
</style>
</head>
<body>
`;

    // Title page
    if (screenplay.title)
    {
        html += `<div class="title-page"><p>${escapeHtml(screenplay.title)}</p>`;
        if (screenplay.author)
        {
            html += `<p>${escapeHtml(screenplay.author)}</p>`;
        }
        html += `</div>\n`;
    }

    // Scenes
    for (const scene of screenplay.scenes)
    {
        if (scene.heading)
        {
            html += `<br><p class="scene-heading">${escapeHtml(scene.heading)}</p>\n`;
        }

        for (const el of scene.elements)
        {
            html += renderElementToHtml(el, includeTitles);
        }
    }

    html += `<br><p class="transition">THE END</p>
</body>
</html>`;

    return html;
}

/**
 * Render a single screenplay element to HTML
 * @param {ScreenplayElement | TitleCardElement} element
 * @param {boolean} includeTitles
 * @returns {string}
 */
function renderElementToHtml(element, includeTitles)
{
    switch (element.type)
    {
        case 'action':
            return `<br><p class="action">${escapeHtml(element.content)}</p>\n`;

        case 'character':
            {
                let charLine = element.content;
                if (element.meta?.modifier)
                {
                    charLine += ` (${element.meta.modifier})`;
                }
                return `<br><p class="character">${escapeHtml(charLine)}</p>\n`;
            }

        case 'parenthetical':
            return `<p class="parenthetical">(${escapeHtml(element.content)})</p>\n`;

        case 'dialogue':
            return `<p class="dialogue">${escapeHtml(element.content)}</p>\n`;

        case 'sfx':
            return `<br><p class="sfx">[SFX: ${escapeHtml(element.content)}]</p>\n`;

        case 'title_card':
            if (!includeTitles)
            {
                return '';
            }
            return renderTitleCardToHtml(/** @type {TitleCardElement} */ (element));

        case 'transition':
            return `<p class="transition">${escapeHtml(element.content)}</p>\n`;

        default:
            return '';
    }
}

/**
 * Render a title card element to HTML
 * @param {TitleCardElement} titleCard
 * @returns {string}
 */
function renderTitleCardToHtml(titleCard)
{
    let html = '<br><p class="title-card">';

    if (titleCard.meta?.epithet)
    {
        html += `<span class="title-card-epithet">${escapeHtml(titleCard.meta.epithet)}</span><br>`;
    }

    if (titleCard.meta?.subheader)
    {
        html += `<span class="title-card-subheader">${escapeHtml(titleCard.meta.subheader)}</span><br>`;
    }

    html += `<span class="title-card-name">${escapeHtml(titleCard.content)}</span>`;

    if (titleCard.meta?.age)
    {
        html += `<br><span class="title-card-age">${escapeHtml(titleCard.meta.age)}</span>`;
    }

    html += '</p>\n';

    return html;
}

/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text)
{
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// =============================================================================
// JSON OUTPUT
// =============================================================================

/**
 * Convert screenplay to a clean JSON-serializable object
 * @param {Screenplay} screenplay
 * @returns {Object}
 */
export function screenplayToJson(screenplay)
{
    return {
        title: screenplay.title,
        author: screenplay.author,
        scenes: screenplay.scenes.map(scene => ({
            heading: scene.heading,
            sceneNumber: scene.sceneNumber,
            pageId: scene.pageId,
            elements: scene.elements.map(el => ({
                type: el.type,
                content: el.content,
                ...(el.meta && Object.keys(el.meta).length > 0 ? { meta: el.meta } : {})
            }))
        }))
    };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
    astToScreenplay,
    parseTitleCard,
    renderScreenplayToHtml,
    screenplayToJson,
    validateScreenplay
};
