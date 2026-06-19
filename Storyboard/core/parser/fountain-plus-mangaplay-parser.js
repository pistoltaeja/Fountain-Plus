/**
 * Mangaplay Script Parser
 * Parses MangaScriptFormat markdown into an AST.
 * Supports both .mangaplay and .superscript formats via auto-detection.
 */

/** @typedef {import('../types.js').ScriptAST} ScriptAST */
/** @typedef {import('../types.js').ScriptMetadata} ScriptMetadata */
/** @typedef {import('../types.js').ScriptFormat} ScriptFormat */
/** @typedef {import('../types.js').Page} Page */
/** @typedef {import('../types.js').Panel} Panel */
/** @typedef {import('../types.js').Dialogue} Dialogue */
/** @typedef {import('../types.js').TitleCard} TitleCard */
/** @typedef {import('../types.js').Location} Location */
/** @typedef {import('../types.js').PanelType} PanelType */
/** @typedef {import('../types.js').ReadingDirection} ReadingDirection */

import { detectFormat } from '../format-detector.js';
import { parseSuperscript } from './superscript-parser.js';
import { extractTags, classifyTags } from './tag-classifier.js';

/**
 * @typedef {Object} ParseError
 * @property {number} line - 0-based line number
 * @property {number} [column] - 0-based column (optional)
 * @property {number} [length] - Length of the offending text (optional)
 * @property {string} message - Human-readable error message
 * @property {'error' | 'warning' | 'info'} severity
 * @property {string} [code] - Stable warning/error code for localisation (e.g. WARN_PAGE_LOWERCASE)
 * @property {Array<string|number>} [args] - Positional substitution values for localisation
 */

/**
 * @typedef {Object} ParseWarning
 * @property {string} code - Stable warning code (e.g. WARN_PAGE_LOWERCASE)
 * @property {Array<string|number>} args - Positional substitution values
 * @property {number} line - 0-based line number
 * @property {number} [column]
 * @property {number} [length]
 * @property {'warning' | 'info'} severity
 */

// Known metadata keys (Fountain-style Key: Value)
// Fountain commonly uses additional keys (Credit, Source, Draft date, Contact,
// Copyright, Notes, Revision); accept them tolerantly so any Fountain title page
// parses without unknown-key warnings. See extension-mangaplay-spec/spec.md §4.
const KNOWN_METADATA_KEYS = new Set([
    'Title', 'Author', 'Authors', 'Genre', 'Format', 'Pages', 'Status',
    'Credit', 'Source', 'Draft date', 'Contact', 'Copyright', 'Notes', 'Revision',
    'Characters', 'Vocabulary'
]);

// Default English message templates for warning codes. Used to populate the
// existing `message` field for backward compat. Localisation layer supersedes
// these via diagnostic-i18n.js.
const WARNING_TEMPLATES = {
    WARN_PAGE_LOWERCASE:
        'Page header casing: write "# Page {0}" instead of "# {1} {0}".',
    WARN_PAGE_MISSING_HASH:
        'Page header missing "#" prefix: write "# Page {0}" instead of "Page {0}".',
    WARN_ACTION_INDENTED:
        'Action lines should not be indented. Move to column 0 to match the format.',
    WARN_MIXED_INDENTATION:
        'Mixed indentation styles in one document — pick one convention for the whole document.',
    WARN_LEGACY_PANEL:
        '"# Panel N" is the legacy form. Prefer "Panel N" or "/* PANEL N */" for Fountain compatibility.',
    WARN_BONEYARD_UNTERMINATED:
        'Boneyard "/* …" was never closed with "*/".',
    WARN_RESERVED_MARKER:
        '"{0}" is reserved for future use and was ignored.',
    WARN_IMPLICIT_PAGE_1:
        'Content found before any "# Page" header — synthesised Page 1 implicitly.',
    PARSE_UNKNOWN_FORMAT:
        'Could not determine input format.',
    PARSE_ORPHAN_DIALOGUE:
        'Dialogue block found outside any character cue at line {0}.',
    PARSE_EMPTY_PANEL:
        'Panel {0} has no content.',
    PARSE_TAG_SYNTAX_ERROR:
        'Tag bracket opened but not closed at line {0}.'
};

/**
 * Render a warning's English template message from its code + args.
 * @param {string} code
 * @param {Array<string|number>} [args]
 * @returns {string}
 */
function renderWarningMessage(code, args)
{
    const tpl = WARNING_TEMPLATES[code];
    if (!tpl) return code;
    if (!args) return tpl;
    return tpl.replace(/\{(\d+)\}/g, (_, n) =>
    {
        const v = args[Number(n)];
        return v === undefined ? '' : String(v);
    });
}

// Panel-tag validation moved into `tag-classifier.js` — see
// TODO/PANEL_GRID_REFACTOR.md Section 2 for the new public surface.

// =============================================================================
// REGEX PATTERNS
// =============================================================================

// Static patterns (no indent dependency). These are file-level or
// indent-agnostic — safe to share across all panels regardless of convention.
const STATIC_PATTERNS = {
    // Metadata patterns (Fountain-style Key: Value)
    title: /^Title:\s*(.+)$/m,
    author: /^Author:\s*(.+)$/m,
    genre: /^Genre:\s*(.+)$/m,
    format: /^Format:\s*(.+)$/m,
    pages: /^Pages:\s*(\d+)$/m,
    status: /^Status:\s*(.+)$/m,

    // Page header: # Page 1 INT. PLACE - TIME (case-insensitive on Page keyword)
    // Period after INT/EXT is optional — parser auto-corrects and warns if missing.
    pageHeader: /^#\s+PAGE\s+(\d+(?:-(?:\d+|COVER|[IVXLCDM]+))?)\s*(?:(INT|EXT|EST|INT\.\/EXT\.|INT\/EXT|I\/E)(\.?)\s+(.+?)(?:\s*-\s*(DAY|NIGHT|DAWN|DUSK))?)?$/i
};

// Permissive panel detection. Captures leading indent (group 1) so the parser
// can pick a Convention (A: 4-space / B: 0-space) per panel. Trailing whitespace
// is tolerated — real-world files sometimes leave a stray space after tags.
// Panel: Panel 1, Panel 2 [TYPE], Panel 1-3, Panel 2 [H-2/3], Panel 1 [BLEED] [H]
//
// Group 4 captures trailing freeform text after the (optional) tag block,
// e.g. `Panel 1 Stacked` or `Panel 1 EXT. Room` or `Panel 1 [H] HELLO`.
// The trailing text is a natural-writing label/comment — not a documented
// feature, but real .mangaplay files have it, so we accept it rather than
// erroring. The parser does not surface the captured text anywhere; this
// group exists to make the regex match cleanly so subsequent parsing
// proceeds normally.
//
// The trailing text MUST NOT start with `[` — otherwise the (...)? tag
// block becomes ambiguous and the parser would lose tag detection on
// `Panel 1 [H]`. `[^\[]` ensures the trailing-text branch only fires for
// non-bracketed content like `EXT. Room` or `Stacked`.
//
// CAVEAT — the trailing-text group will also match a line like
// `    Panel 1 content.` that the author intended as DESCRIPTION text
// under a previously-opened Panel 1. The parser cannot disambiguate
// these without context (both are syntactically a panel header with a
// label). Convention: lines that look like a panel header ARE one.
// Authors who want literal "Panel 1" prose in description text should
// use `! Panel 1 content.` (forced-action prefix) to opt out of header
// parsing.
const PANEL_DETECT = /^(\s*)Panel\s+(\d+(?:-\d+)?)\s*((?:\s*\[[A-Z][A-Z0-9\s\-\/,]*\])+)?\s*([^\[\s].*?)?\s*$/;

// Alias exposed for external consumers that still reference the old name.
// Kept read-only; avoid mutating.
const PATTERNS = {
    ...STATIC_PATTERNS,
    // Legacy Convention A patterns — tests or external callers may import.
    panel: /^\s{4}Panel\s+(\d+(?:-\d+)?)\s*((?:\s*\[[A-Z][A-Z0-9\s\-\/,]*\])+)?$/,
    dialogueChar: /^\s{8}([A-Z][A-Z0-9\s'\-]+?)(?:\s+((?:\([A-Z][A-Z0-9.\s'']+\)\s*)+))?(\s*\^)?$/,
    dialogueType: /^\s{8}\((thought|whisper|caption)\)$/,
    sfx: /^\s{4}SFX(?:\s*:)?\s+(.+)$/,
    titleCardType: /^\s{4}\(([A-Z\s]+TITLE)\)$/,
    titleCardName: /^\s{4}([A-Z][A-Z0-9\s'\-]+)$/,
    titleCardInfo: /^\s{4}\(([^)]+)\)$/,
    condensedTitle: /^\s{4}(TITLE)(?::)?\s+(.+)$/i
};

/**
 * Build the set of indent-sensitive patterns for a given panel indent.
 * Convention A: panelIndent = 4, dialogueIndent = 8.
 * Convention B: panelIndent = 0, dialogueIndent = 4.
 * Convention C: panelIndent = 0, dialogueIndent = 0.
 * @param {number} panelIndent - Panel band column (0 or 4)
 * @param {number} dialogueIndent - Dialogue band column
 * @returns {Record<string, RegExp>}
 */
function makePatterns(panelIndent, dialogueIndent)
{
    const p = ' '.repeat(panelIndent);
    const d = ' '.repeat(dialogueIndent);
    return {
        ...STATIC_PATTERNS,
        panel:          new RegExp('^' + p + 'Panel\\s+(\\d+(?:-\\d+)?)\\s*((?:\\s*\\[[A-Z][A-Z0-9\\s\\-\\/,]*\\])+)?\\s*$'),
        dialogueChar:   new RegExp('^' + d + '([A-Z][A-Z0-9\\s\'\\-]+?)(?:\\s+((?:\\([A-Z][A-Z0-9.\\s\'\']+\\)\\s*)+))?(\\s*\\^)?$'),
        dialogueType:   new RegExp('^' + d + '\\((thought|whisper|caption)\\)$'),
        sfx:            new RegExp('^' + p + 'SFX(?:\\s*:)?\\s+(.+)$'),
        titleCardType:  new RegExp('^' + p + '\\(([A-Z\\s]+TITLE)\\)$'),
        titleCardName:  new RegExp('^' + p + '([A-Z][A-Z0-9\'\\s\\-]+)$'),
        titleCardInfo:  new RegExp('^' + p + '\\(([^)]+)\\)$'),
        // Match "TITLE" keyword (any casing — case-warning emitted later)
        // followed by an OPTIONAL colon and at least one space, then the
        // pipe-delimited body. Capture group 1 = the literal keyword as
        // written (for case validation), group 2 = the body.
        condensedTitle: new RegExp('^' + p + '(TITLE)(?::)?\\s+(.+)$', 'i'),
        forcedChar:     new RegExp('^' + d + '@([A-Z][A-Z0-9\\s\'\\-&,.]*?)(?:\\s+((?:\\([A-Z][A-Z0-9.\\s\'\']+\\)\\s*)+))?(\\s*\\^)?$'),
        transitionTo:   new RegExp('^' + p + '.+TO:$'),
        forcedTrans:    new RegExp('^' + p + '>.+[^<]$'),
        centered:       new RegExp('^' + p + '>(.+)<$'),
        synopsis:       new RegExp('^' + p + '=\\s+(.+)$'),
        lyrics:         new RegExp('^' + p + '~(.+)$'),
        forcedAction:   new RegExp('^' + p + '!.+$')
    };
}

function parseExtensions(raw)
{
    if (!raw) return [];
    const matches = raw.match(/\([A-Z][A-Z0-9.\s'']+\)/g);
    if (!matches) return [];
    return matches.map(m => m.slice(1, -1).trim());
}

// =============================================================================
// PARSER
// =============================================================================

/**
 * Derive reading direction from format metadata
 * @param {import('../types.js').Format} [format]
 * @returns {ReadingDirection}
 */
function deriveReadingDirection(format)
{
    if (format === 'Manga') return 'RTL';
    return 'LTR'; // Default to LTR for Comic or unspecified
}

/**
 * @typedef {Object} ParseOptions
 * @property {ScriptFormat} [format] - Force a specific format. Auto-detects if omitted.
 */

/**
 * Parses MangaScriptFormat markdown into a ScriptAST.
 * Best-effort: collects errors without throwing.
 * Supports both .mangaplay and .superscript formats.
 * @param {string} markdown - The markdown content to parse
 * @param {ParseOptions} [options] - Parse options
 * @returns {ScriptAST & { readingDirection: ReadingDirection, errors: ParseError[], warnings: ParseWarning[], format: ScriptFormat }}
 */
export function parseScript(markdown, options = {})
{
    const format = options.format || detectFormat(markdown);

    // Route to superscript parser if detected
    if (format === 'superscript')
    {
        const r = parseSuperscript(markdown);
        if (!r.warnings) r.warnings = [];
        return r;
    }

    // Mangaplay format (existing logic)
    /** @type {ParseError[]} */
    const errors = [];
    /** @type {ParseWarning[]} */
    const warnings = [];

    /**
     * Push a structured warning into both the errors stream (with severity)
     * and the dedicated warnings array. Backwards-compatible: existing
     * consumers that scan `errors` still see it.
     * @param {string} code
     * @param {Array<string|number>} args
     * @param {{ line: number, column?: number, length?: number, severity?: 'warning'|'info' }} loc
     */
    const emitWarning = (code, args, loc) =>
    {
        const severity = loc.severity || 'warning';
        const message = renderWarningMessage(code, args);
        const w = {
            code,
            args,
            line: loc.line,
            column: loc.column,
            length: loc.length,
            severity,
            message
        };
        warnings.push(w);
        errors.push(w);
    };

    // Normalize tabs to 4 spaces so indent-aware patterns match naturally.
    // This is a pre-step independent of Convention A vs B — indent arithmetic
    // downstream counts spaces in either convention.
    if (markdown.includes('\t'))
    {
        errors.push({
            line: 0,
            message: 'Tabs detected \u2014 converted to 4 spaces for parsing',
            messageKey: 'parser.tabsConverted',
            severity: 'info'
        });
        markdown = markdown.replace(/\t/g, '    ');
    }

    let lines = markdown.split('\n');

    // Pre-pass: process boneyard /* ... */ blocks.
    // PANEL boneyards become synthetic `Panel N [tags]` lines (Spec V2 §6.2).
    // Other boneyards are author comments — replace with blank lines so that
    // line numbers (used for warnings) remain stable.
    lines = processBoneyards(lines, errors);

    const metadata = parseMetadata(markdown);
    collectMetadataErrors(lines, metadata, errors);

    const pages = parsePages(lines, errors, emitWarning);
    const readingDirection = deriveReadingDirection(metadata.format);

    collectPageErrors(pages, errors);

    // Compute dominant indentation convention across the parsed pages.
    // 'A' → all panels at 4-space indent (canonical).
    // 'B' → all panels at 0-space indent (default).
    // 'mixed' → both conventions appear in the same file.
    metadata.indentStyle = computeIndentStyle(pages);
    if (metadata.indentStyle === 'mixed') {
        emitWarning('WARN_MIXED_INDENTATION', [], {
            line: 0, column: 0, length: 0, severity: 'warning'
        });
    }

    // If totalPages not specified, auto-count from content.
    // Mark as implicit so formatters don't round-trip write a Pages line
    // that wasn't in the source.
    if (metadata.totalPages === undefined && pages.length > 0)
    {
        metadata.totalPages = pages.length;
        metadata._totalPagesImplicit = true;
    }

    let detectedFormat = 'unknown';
    const hasPageHeaders = /^#\s+PAGE\s+\d/mi.test(markdown);
    const hasPanelLines = /^\s*Panel\s+\d/m.test(markdown);
    const hasMangaplayConstruct = hasPageHeaders || hasPanelLines;
    const hasFountainMarkers = /^(INT|EXT|EST|INT\/EXT|I\/E)[\.\s]/mi.test(markdown)
        || /^[A-Z][A-Z\s]*TO:$/m.test(markdown)
        || /^Title:\s/m.test(markdown);
    const hasMangaplayExtensions = /^\s*SFX[\s:]/mi.test(markdown)
        || /\[\[SFX:/m.test(markdown)
        || /^\s*TITLE[\s:]/mi.test(markdown);

    if (hasMangaplayConstruct)
    {
        detectedFormat = 'mangaplay';
    }
    else if (hasFountainMarkers && hasMangaplayExtensions)
    {
        detectedFormat = 'fountain+';
    }
    else if (hasFountainMarkers)
    {
        detectedFormat = 'fountain';
    }

    runSmellTests(pages, markdown, warnings, emitWarning);

    return { metadata, pages, readingDirection, errors, warnings, diagnostics: warnings, format: 'mangaplay', detectedFormat };
}

/**
 * Pre-pass: scan whole document for boneyard ranges, replace each
 * range with blank lines (line-stable) or, when the first non-whitespace
 * token is `PANEL` (uppercase), a single synthetic `Panel N [tags]` line.
 * Unterminated boneyard emits an ERROR. Other boneyards are treated as
 * author comments and dropped from output.
 *
 * @param {string[]} lines
 * @param {ParseError[]} errors
 * @returns {string[]} new line array with same length
 */
function processBoneyards(lines, errors)
{
    const out = lines.slice();
    let i = 0;
    while (i < out.length)
    {
        const line = out[i];
        const openIdx = line.indexOf('/*');
        if (openIdx === -1)
        {
            i++;
            continue;
        }

        // Find the closing */ on this line or a later one.
        let closeLine = -1;
        let closeCol = -1;
        const sameLineClose = line.indexOf('*/', openIdx + 2);
        if (sameLineClose !== -1)
        {
            closeLine = i;
            closeCol = sameLineClose;
        }
        else
        {
            for (let j = i + 1; j < out.length; j++)
            {
                const cidx = out[j].indexOf('*/');
                if (cidx !== -1)
                {
                    closeLine = j;
                    closeCol = cidx;
                    break;
                }
            }
        }

        if (closeLine === -1)
        {
            // Unterminated boneyard.
            errors.push({
                code: 'WARN_BONEYARD_UNTERMINATED',
                args: [],
                line: i,
                column: openIdx,
                length: 2,
                severity: 'error',
                message: renderWarningMessage('WARN_BONEYARD_UNTERMINATED')
            });
            // Blank from openIdx onward.
            out[i] = line.slice(0, openIdx);
            for (let j = i + 1; j < out.length; j++)
            {
                out[j] = '';
            }
            return out;
        }

        // Extract inner content between /* and */ (exclusive).
        let inner;
        if (closeLine === i)
        {
            inner = line.slice(openIdx + 2, closeCol);
        }
        else
        {
            const parts = [line.slice(openIdx + 2)];
            for (let j = i + 1; j < closeLine; j++)
            {
                parts.push(out[j]);
            }
            parts.push(out[closeLine].slice(0, closeCol));
            inner = parts.join('\n');
        }

        // Detect PANEL marker. Spec V2 §6.2: first non-whitespace token MUST
        // be uppercase PANEL. Collapse whitespace for the multi-line tag form.
        const flat = inner.replace(/\s+/g, ' ').trim();
        const flatMatch = /^PANEL\s+(\d+(?:-\d+)?)\s*((?:\s*\[[^\]]*\])*)?\s*$/.exec(flat);

        const beforeOpen = line.slice(0, openIdx);
        const afterClose = out[closeLine].slice(closeCol + 2);

        if (flatMatch)
        {
            const num = flatMatch[1];
            // Boneyard panel tags are lowercase-kebab per spec §6.4. The
            // existing PANEL_DETECT regex requires `[A-Z]` start, so
            // canonicalise tags to uppercase here. Hyphens and slashes are
            // preserved.
            const tagPart = (flatMatch[2] || '').trim().toUpperCase();
            const synth = `Panel ${num}${tagPart ? ' ' + tagPart : ''}`;
            out[i] = beforeOpen.trim() === '' ? synth : (beforeOpen + synth);
        }
        else
        {
            // Author comment — strip entirely.
            if (closeLine === i)
            {
                out[i] = beforeOpen + afterClose;
            }
            else
            {
                out[i] = beforeOpen;
            }
        }

        // Blank interior lines + close line (when multi-line).
        if (closeLine !== i)
        {
            for (let j = i + 1; j < closeLine; j++)
            {
                out[j] = '';
            }
            out[closeLine] = afterClose;
        }

        i = closeLine + 1;
    }
    return out;
}

/**
 * Tally panelIndent values across all panels; return dominant convention.
 * @param {Page[]} pages
 * @returns {'A' | 'B' | 'C' | 'mixed' | undefined}
 */
/**
 * Check if a panel has any dialogue with a forced-cue character.
 * Forced-cue panels should be excluded from the indent convention set.
 * @param {Panel} panel
 * @returns {boolean}
 */
function hasForcedCue(panel)
{
    return (panel.dialogue || []).some(d => d.character && d.character.startsWith('@'));
}

function computeIndentStyle(pages)
{
    let a = 0;
    let b = 0;
    let c = 0;
    let zeroIndentNoDialogue = 0;
    for (const page of pages)
    {
        for (const panel of page.panels)
        {
            // Skip forced-cue panels from convention counting.
            // Their indentation is dictated by the cue syntax, not by
            // the document's stylistic convention.
            if (hasForcedCue(panel)) continue;

            if (panel._panelIndent === 0)
            {
                if (panel._dialogueIndent === 0) c++;
                else if (panel.dialogue.length > 0) b++;
                else zeroIndentNoDialogue++;
            }
            else a++; // Default to A when missing (covers 4-space or absent)
        }
    }
    // Dialogue-less panels at panelIndent 0 are ambiguous between B and C.
    // When only C panels exist alongside them, report 'C'. When only B, 'B'.
    // When neither B nor C has evidence but panelIndent-0 panels exist, default to 'B'.
    if (a === 0 && b === 0 && c === 0 && zeroIndentNoDialogue === 0) return undefined;
    if (a === 0 && b === 0 && c === 0 && zeroIndentNoDialogue > 0) return 'B';
    if (a > 0 && b === 0 && c === 0) return 'A';
    if (b > 0 && a === 0 && c === 0) return 'B';
    if (c > 0 && a === 0 && b === 0) return 'C';
    return 'mixed';
}

/**
 * Validate metadata fields and collect errors
 * @param {string[]} lines
 * @param {ScriptMetadata} metadata
 * @param {ParseError[]} errors
 */
function collectMetadataErrors(lines, metadata, errors)
{
    // Check for unknown metadata keys (Fountain-style Key: Value at top of file)
    const metaKeyPattern = /^([A-Za-z]+):\s*(.*)$/;
    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];
        // Stop scanning once we hit a page header
        if (/^#\s+PAGE/i.test(line)) break;

        const keyMatch = line.match(metaKeyPattern);
        if (keyMatch)
        {
            const key = keyMatch[1].trim();
            // Skip SFX: and TITLE: which are panel-level content, not metadata
            if (key === 'SFX' || key === 'TITLE') continue;
            if (!KNOWN_METADATA_KEYS.has(key))
            {
                errors.push({
                    line: i,
                    column: 0,
                    length: key.length,
                    message: `Unknown metadata field: "${key}"`,
                    severity: 'warning'
                });
            }
        }
    }

    // Status is now free-text — any string is accepted (Draft, In Progress,
    // Complete, Published, One Shot, etc.). No enum validation.
}

/**
 * Validate page-level issues: duplicate page numbers, panel numbering, unknown tags
 * @param {Page[]} pages
 * @param {ParseError[]} errors
 */
function collectPageErrors(pages, errors)
{
    // Duplicate page numbers
    /** @type {Map<string, number>} */
    const seenPageIds = new Map();
    for (const page of pages)
    {
        const prevLine = seenPageIds.get(page.id);
        if (prevLine !== undefined)
        {
            errors.push({
                line: page.lineNumber ?? 0,
                message: `Duplicate page number: PAGE ${page.id} (first defined at line ${prevLine + 1})`,
                severity: 'error'
            });
        }
        else
        {
            seenPageIds.set(page.id, page.lineNumber ?? 0);
        }

        // Panel numbering: check for sequence gaps
        const panelNumbers = page.panels.map(p => p.displayNumber);
        for (let i = 1; i < panelNumbers.length; i++)
        {
            const expected = panelNumbers[i - 1] + 1;
            const actual = panelNumbers[i];
            if (actual !== expected && actual > expected)
            {
                const panel = page.panels[i];
                errors.push({
                    line: panel.lineNumber ?? 0,
                    message: `Panel numbering gap on PAGE ${page.id}: expected Panel ${expected}, found Panel ${actual}`,
                    severity: 'warning'
                });
            }
        }

        // Row-cluster validation: a [ROW] marker that has no following panels
        // before the next [ROW] or end of page is pointless. Warn the author.
        // Inset panels are excluded from cluster membership (they aren't laid
        // out in the page grid), matching the calculator's split in
        // calculatePanelLayouts.
        const clusterPanels = page.panels.filter(p => p.type !== 'INSET');
        for (let i = 0; i < clusterPanels.length; i++)
        {
            const p = clusterPanels[i];
            if (p.rowStart !== true) continue;

            // Find cluster size: this panel plus any following panels up to
            // the next rowStart (or end of page).
            let size = 1;
            for (let j = i + 1; j < clusterPanels.length; j++)
            {
                if (clusterPanels[j].rowStart === true) break;
                size++;
            }

            // A single-panel [ROW] cluster is valid syntax: [ROW] is a
            // row-break marker meaning "begin a new row here". The cluster
            // simply contains a single panel until the next [ROW] (or end of
            // page). Layout treats `rowStart` as the row boundary directly,
            // so no promotion to [H] and no warning is needed.
        }
    }
}

/**
 * Parses script metadata from pure markdown header.
 * All fields optional. Defaults: title="Untitled", format=undefined, status="Draft".
 * @param {string} markdown
 * @returns {ScriptMetadata}
 */
function parseMetadata(markdown)
{
    /** @type {ScriptMetadata} */
    const metadata = {
        title: 'Untitled'
    };

    const titleMatch = markdown.match(PATTERNS.title);
    if (titleMatch) metadata.title = titleMatch[1].trim();

    const authorMatch = markdown.match(PATTERNS.author);
    if (authorMatch) metadata.author = authorMatch[1].trim();

    const genreMatch = markdown.match(PATTERNS.genre);
    if (genreMatch) metadata.genre = genreMatch[1].trim();

    const formatMatch = markdown.match(PATTERNS.format);
    if (formatMatch)
    {
        metadata.format = /** @type {import('../types.js').Format} */ (formatMatch[1].trim());
    }

    const pagesMatch = markdown.match(PATTERNS.pages);
    if (pagesMatch) metadata.totalPages = parseInt(pagesMatch[1], 10);

    const statusMatch = markdown.match(PATTERNS.status);
    if (statusMatch) metadata.status = /** @type {import('../types.js').Status} */ (statusMatch[1].trim());

    // Characters / Vocabulary — line-aware so multi-line continuation lines
    // (tab or 3+ space indent) are folded into the key's value.
    const mdLines = markdown.split('\n');
    /** @type {string|null} */
    let activeKey = null;
    /** @type {Record<string, string>} */
    const collected = {};
    for (let i = 0; i < mdLines.length; i++)
    {
        const line = mdLines[i];
        // Stop at first page header — title page is over.
        if (/^#\s+PAGE/i.test(line)) break;
        if (line.trim() === '')
        {
            activeKey = null;
            continue;
        }
        // Continuation line (tab or 3+ leading spaces): append to active key.
        if (activeKey && /^(\t|   )/.test(line))
        {
            collected[activeKey] = collected[activeKey]
                ? collected[activeKey] + '\n' + line.trim()
                : line.trim();
            continue;
        }
        const m = line.match(/^([A-Za-z][A-Za-z ]*?):\s*(.*)$/);
        if (m)
        {
            const key = m[1].trim().toLowerCase();
            activeKey = key;
            collected[key] = m[2].trim();
        }
        else
        {
            activeKey = null;
        }
    }

    if (collected.characters)
    {
        const parts = collected.characters.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) metadata.characters = parts;
    }
    if (collected.vocabulary)
    {
        const parts = collected.vocabulary.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) metadata.vocabulary = parts;
    }

    return metadata;
}

/**
 * Parses all pages from the markdown lines
 * @param {string[]} lines
 * @param {ParseError[]} errors - Error collector
 * @param {(code: string, args: Array<string|number>, loc: any) => void} [emitWarning]
 * @returns {Page[]}
 */
function parsePages(lines, errors, emitWarning)
{
    // Default no-op so legacy callers (tests, etc.) still work.
    if (!emitWarning)
    {
        emitWarning = (code, args, loc) =>
        {
            errors.push({
                code,
                args,
                line: loc.line,
                column: loc.column,
                length: loc.length,
                severity: loc.severity || 'warning',
                message: renderWarningMessage(code, args)
            });
        };
    }

    /** @type {Page[]} */
    const pages = [];
    let currentPage = null;
    let currentPanel = null;
    /** @type {Record<string, RegExp>} */
    let patterns = makePatterns(4, 8); // Default Convention A until first Panel
    let panelIndent = 4;             // Column of the panel band for currentPanel
    let dialogueIndent = 8;          // Column of the dialogue band (Convention A: 8, B: 4, C: 0)
    let dialogueIndentStr = '        '; // cached ' '.repeat(dialogueIndent)
    let panelIndentStr = '    ';     // cached ' '.repeat(panelIndent)
    let currentDialogue = null;
    let lastDialogueChar = null;
    let descriptionGap = false;

    function appendDescription(panel, desc)
    {
        if (panel.description)
        {
            const separator = descriptionGap ? '\n\n' : '\n';
            if (descriptionGap) panel._descParaCount++;
            panel.description += separator + desc;
        }
        else
        {
            panel._descParaCount++;
            panel.description = desc;
        }
        descriptionGap = false;
    }

    let inTitleCard = false;
    let titleCardType = '';
    let panelIndex = 0; // Sequential index within current page
    let inTitlePage = true; // Title-page block — terminates at first non-metadata line
    let lastTitleKey = null; // Track last metadata key for continuation lines
    /** @type {Set<number>} */
    const malformedHeaderLines = new Set(); // Suppress duplicate malformed-header emissions on re-processed (i--) lines

    /**
     * Rebuild the per-panel regex set and indent string caches.
     * @param {number} newIndent
     * @param {number} [newDialogueIndent] - Explicit dialogue indent; defaults to newIndent + 4
     */
    const setPanelIndent = (newIndent, newDialogueIndent) =>
    {
        panelIndent = newIndent;
        if (newDialogueIndent !== undefined)
        {
            dialogueIndent = newDialogueIndent;
        }
        else
        {
            dialogueIndent = panelIndent + 4;
        }
        panelIndentStr = ' '.repeat(panelIndent);
        dialogueIndentStr = ' '.repeat(dialogueIndent);
        patterns = makePatterns(panelIndent, dialogueIndent);
    };

    for (let i = 0; i < lines.length; i++)
    {
        let line = lines[i];

        // Title-page tracking — a blank line alone does NOT terminate the
        // title page. The title page ends when we hit content that is not
        // metadata (handled below in the !currentPage branch).

        // TASK 6: Page breaks ===
        // Spec V2 §7.8: redundant when adjacent to `# PAGE` header. Drop
        // silently in that case; otherwise treat as a Fountain-style page
        // break (no synthesised page header — the next `# PAGE` or implicit
        // page-1 will absorb the following content).
        if (/^={3,}$/.test(line.trim()))
        {
            continue;
        }

        // Reserved markers: ## Chapter N, # SCENE N, and any other
        // `# UPPERCASE_WORD N` that is not PAGE. Demote to warning and skip.
        // Spec V2 §11. (## sections were already silently skipped — keep that
        // behaviour but tag the first-line variant as a reserved-marker warn.)
        const reservedMatch = /^(#{1,6})\s+([A-Z][A-Z_]*)\s+(\d+)\s*$/.exec(line);
        if (reservedMatch && reservedMatch[2] !== 'PAGE')
        {
            // Skip if it's actually a panel header (Panel N) – impossible here
            // since `Panel` is mixed-case; this regex demands uppercase.
            const markerName = `${reservedMatch[1]} ${reservedMatch[2]} ${reservedMatch[3]}`.trim();
            emitWarning('WARN_RESERVED_MARKER', [markerName], {
                line: i,
                column: 0,
                length: line.length,
                severity: 'warning'
            });
            continue;
        }

        // TASK 12: Sections ##, ###, etc. (non-printing, skip)
        if (/^#{2,6}\s+(.+)$/.test(line))
        {
            continue;
        }

        // Legacy `# Panel N [tags]` (Spec V2 §6.1). Demote
        // to a warning and rewrite the line so it falls through into the
        // PANEL_DETECT branch below. Case-insensitive on "Panel".
        const legacyHashPanel = /^(#)\s+(Panel)\s+(\d+(?:-\d+)?)\s*((?:\s*\[[^\]]*\])*)?\s*$/i.exec(line);
        if (legacyHashPanel)
        {
            emitWarning('WARN_LEGACY_PANEL', [legacyHashPanel[3]], {
                line: i,
                column: 0,
                length: line.length,
                severity: 'warning'
            });
            // Rewrite the in-memory line for downstream PANEL_DETECT match.
            // Preserve panelIndent convention: produce `    Panel N [tags]`
            // (Convention A) which PANEL_DETECT accepts equally to col-0.
            // Uppercase tags so they pass the existing PANEL_DETECT `[A-Z]`
            // tag-content requirement.
            const tagPart = (legacyHashPanel[4] || '').trim().toUpperCase();
            line = `    Panel ${legacyHashPanel[3]}${tagPart ? ' ' + tagPart : ''}`;
            lines[i] = line;
            // Fall through — the new line will hit PANEL_DETECT below.
        }

        // Bare `Page N` (without `#` prefix). Spec: accepted with warning.
        // Rewrite in-memory to `# Page N` so it falls through to the
        // standard pageHeader branch below.
        const barePageMatch = /^Page\s+(\d+(?:-(?:\d+|COVER|[IVXLCDM]+))?)\s*$/i.exec(line);
        if (barePageMatch && !legacyHashPanel)
        {
            emitWarning('WARN_PAGE_MISSING_HASH', [barePageMatch[1]], {
                line: i,
                column: 0,
                length: line.length,
                severity: 'warning'
            });
            line = `# Page ${barePageMatch[1]}`;
            lines[i] = line;
            // Fall through — the rewritten line will match STATIC_PATTERNS.pageHeader below.
        }

        // Malformed page header (# PAGE without number).
        // Implicit Page 1 path can re-process the same line index (i--), so
        // guard against duplicate emission with a per-line set.
        if (/^#\s+PAGE\s*$/i.test(line) || /^#\s+PAGE\s+[^0-9]/i.test(line))
        {
            if (!line.match(STATIC_PATTERNS.pageHeader)
                && !malformedHeaderLines.has(i))
            {
                malformedHeaderLines.add(i);
                errors.push({
                    line: i,
                    column: 0,
                    length: line.length,
                    message: `Malformed page header: expected "# Page <number>"`,
                    severity: 'error'
                });
            }
        }

        // Page header
        const pageMatch = line.match(STATIC_PATTERNS.pageHeader);
        if (pageMatch)
        {
            // Title page is implicitly terminated by a page header.
            inTitlePage = false;

            // Page-header case warning. Spec §5.1: `Page` canonical, `PAGE`
            // Fountain alias (no warn); `page` warns. Capture the literal
            // word as written by inspecting the raw line.
            const pageWordMatch = /^#\s+(\S+)/.exec(line);
            if (pageWordMatch && pageWordMatch[1] !== 'Page' && pageWordMatch[1] !== 'PAGE')
            {
                emitWarning('WARN_PAGE_LOWERCASE', [pageMatch[1], pageWordMatch[1]], {
                    line: i,
                    column: line.indexOf(pageWordMatch[1]),
                    length: pageWordMatch[1].length,
                    severity: 'warning'
                });
            }

            if (currentPanel && currentPage)
            {
                currentPanel.lineNumberEnd = findLastContentLine(lines, currentPanel.lineNumber ?? 0, i - 1);
                currentPage.panels.push(currentPanel);
            }
            if (currentPage)
            {
                pages.push(currentPage);
            }

            const pageId = pageMatch[1];
            const { baseNumber, suffix } = parsePageId(pageId);

            currentPage = {
                id: pageId,
                baseNumber,
                suffix,
                lineNumber: i,
                panels: []
            };

            // Merge pre-page transitions/sceneHeadings from an implicit
            // page that had no panels and ONLY contains transitions or
            // sceneHeadings (e.g. FADE IN: before # PAGE 1).
            if (pages.length > 0)
            {
                const prev = pages[pages.length - 1];
                const hasOnlyMeta = prev.panels.length === 0
                    && (prev.transitions || prev.sceneHeadings)
                    && !prev.description;
                if (hasOnlyMeta)
                {
                    if (prev.transitions)
                    {
                        currentPage.transitions = prev.transitions;
                    }
                    if (prev.sceneHeadings)
                    {
                        currentPage.sceneHeadings = prev.sceneHeadings;
                    }
                    pages.pop();
                }
            }

            if (pageMatch[2])
            {
                if (!pageMatch[3])
                {
                    errors.push({
                        line: i,
                        column: line.search(/INT|EXT/i) + pageMatch[2].length,
                        length: 1,
                        message: `Missing period after ${pageMatch[2].toUpperCase()} — expected "${pageMatch[2].toUpperCase()}."`,
                        severity: 'warning'
                    });
                }
                currentPage.location = {
                    type: /** @type {import('../types.js').LocationType} */ (pageMatch[2].toUpperCase()),
                    place: pageMatch[4] ? pageMatch[4].trim() : '',
                    time: pageMatch[5] ? /** @type {import('../types.js').TimeOfDay} */ (pageMatch[5]) : undefined
                };
            }

            currentPanel = null;
            currentDialogue = null;
            lastDialogueChar = null;
            inTitleCard = false;
            panelIndex = 0;
            continue;
        }

        if (!currentPage)
        {
            // Implicit Page 1 (Spec V2 §5.4).
            // Content before any `# PAGE` header MUST be assigned to Page 1.
            // Trigger when we hit body content (Panel marker, scene heading,
            // transition, character cue, action prose, etc).
            // Skip silently for: blank lines, title-page metadata, and
            // section-heading style `#` comment lines.
            const trimmed = line.trim();
            if (trimmed === '')
            {
                continue;
            }
            // Lines beginning with `#` that did not match the page header
            // regex are either malformed page headers (already errored
            // upstream), reserved markers (already warned upstream), or
            // free-text section comments (`# This is a comment`). None of
            // these should trigger implicit Page 1.
            if (/^#/.test(trimmed))
            {
                continue;
            }
            // Title-page metadata key: skip silently.
            // Title-page keys are arbitrary (Fountain accepts anything) but we
            // exclude UPPERCASE-only `SFX` and `TITLE` keywords because those
            // are panel-level constructs (used inside panels, not in the title
            // page). Title-page `Title:` is mixed-case and is fine.
            if (inTitlePage && /^[A-Za-z][A-Za-z\s]*:\s*/.test(line)
                && !/^(SFX|TITLE)\s/.test(trimmed)
                && !/^FADE (IN:|OUT\.)$/.test(trimmed)
                && !/^[A-Z][A-Z\s]*TO:$/.test(trimmed))
            {
                lastTitleKey = trimmed.split(':')[0].trim();
                continue;
            }
            // Title-page continuation line (tab or 3+ leading spaces, after a
            // key was seen). Spec V2 §4. Parity with fountain-parser.js:125-132:
            // continuation lines append to the previous key's value (joined with
            // newline). The folded value lives on `metadata` keyed by the
            // lowercased key name. Page-content parsing already happens via
            // parsePages elsewhere — here we just maintain the title-page
            // bookkeeping so multi-line values aren't silently dropped.
            if (inTitlePage && lastTitleKey && /^(\t|   )/.test(line))
            {
                continue;
            }

            // Real body content reached → synthesize Page 1.
            inTitlePage = false;
            emitWarning('WARN_IMPLICIT_PAGE_1', [], {
                line: i,
                column: 0,
                length: line.length,
                severity: 'warning'
            });
            currentPage = {
                id: '1',
                baseNumber: 1,
                suffix: undefined,
                lineNumber: i,
                panels: []
            };
            // Re-process this same line under the synthesised page.
            i--;
            continue;
        }

        // Permissive Panel detection. Accepts any leading-whitespace length;
        // validated afterward to guarantee panelIndent is exactly 0 or 4.
        const detect = line.match(PANEL_DETECT);
        if (detect)
        {
            let detectedIndent = detect[1].length;
            if (detectedIndent !== 0 && detectedIndent !== 4)
            {
                // Snap to nearest accepted indent and warn — best-effort fallback.
                const snapped = detectedIndent < 2 ? 0 : 4;
                errors.push({
                    line: i,
                    column: 0,
                    length: detectedIndent,
                    message: `Unusual panel indent: ${detectedIndent} spaces (expected 0 or 4). Parsed as ${snapped}.`,
                    severity: 'warning'
                });
                detectedIndent = snapped;
            }

            // Close previous panel.
            if (currentPanel)
            {
                currentPanel.lineNumberEnd = findLastContentLine(lines, currentPanel.lineNumber ?? 0, i - 1);
                currentPage.panels.push(currentPanel);
            }

            setPanelIndent(detectedIndent);

            const displayNumber = detect[2].includes('-')
                ? parseInt(detect[2].split('-')[0], 10)
                : parseInt(detect[2], 10);

            const rawTagStr = detect[3] ? detect[3].trim() : undefined;
            const individualTags = extractTags(rawTagStr);
            const classified = classifyTags(individualTags, panelIndex);

            // Surface classifier warnings on the editor's error channel. The
            // structured payload (`code` + `offendingTag` + `suggestion`) is
            // preserved for the [VALIDATE] worker's downstream consumers.
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
                type: classified.type ?? /** @type {PanelType} */ ('A'),
                modifiers: classified.modifiers,
                description: '',
                dialogue: [],
                sfx: [],
                titleCards: [],
                lineNumber: i,
                lineNumberEnd: i,
                _panelIndent: panelIndent,
                _dialogueIndent: dialogueIndent,
                _descParaCount: 0
            };

            panelIndex++;

            const trailingText = detect[4];
            if (trailingText)
            {
                const shPattern = /^(INT|EXT|EST|INT\.\/EXT\.|INT\/EXT|EXT\/INT|I\/E)[\.\s]/i;
                if (shPattern.test(trailingText))
                {
                    if (!currentPanel.sceneHeadings) currentPanel.sceneHeadings = [];
                    currentPanel.sceneHeadings.push(trailingText);
                }
            }

            currentDialogue = null;
            lastDialogueChar = null;
            inTitleCard = false;
            descriptionGap = false;
            continue;
        }

        // Malformed panel line: starts like a panel but regex failed.
        if (/^\s*Panel\s+\d/.test(line))
        {
            errors.push({
                line: i,
                column: 0,
                length: line.length,
                message: `Malformed panel: expected "Panel <number>" or "Panel <number> [TYPE]"`,
                severity: 'error'
            });
            continue;
        }

        // ====================================================================
        // Fountain primitives that may appear between panels (or before the
        // first panel of a page). They attach to the current panel when one
        // exists; otherwise to the current page.
        // ====================================================================

        // Scene heading. Standalone Fountain scene heading at column 0 (or
        // forced via leading period) — Spec V2 §7.1.
        // Examples: `INT. KITCHEN - DAY`, `EXT. CLIFFTOP`, `.kitchen`.
        const trimmedSH = line.trim();
        const sceneHeadingMatch =
            /^(INT|EXT|EST|INT\.\/EXT\.|I\/E)[\.\s]/i.test(trimmedSH)
                ? trimmedSH
                : null;
        if (sceneHeadingMatch && line === trimmedSH)
        {
            attachSceneHeading(currentPanel, currentPage, trimmedSH);
            continue;
        }
        // Forced scene heading: leading period, no other dots, looks like a
        // scene (not a parenthetical, not a Format key, single line of text).
        // Spec V2 §7.1.
        if (/^\.[A-Za-z]/.test(line) && !/^\.\./.test(line) && line === trimmedSH)
        {
            const dotCount = (trimmedSH.match(/\./g) || []).length;
            if (dotCount === 1)
            {
                attachSceneHeading(currentPanel, currentPage,
                    trimmedSH.slice(1));
                continue;
            }
        }

        // Transitions. Standalone uppercase line ending in TO:, or FADE OUT.,
        // FADE IN:. Spec V2 §7.5.
        if (line === trimmedSH && trimmedSH !== '')
        {
            if (/^[A-Z][A-Z\s]*TO:$/.test(trimmedSH)
                || /^FADE OUT\.$/.test(trimmedSH)
                || /^FADE IN:$/.test(trimmedSH))
            {
                attachTransition(currentPanel, currentPage, trimmedSH);
                continue;
            }
            // Forced transition `> CUT TO:` (column 0).
            const forcedTrans = /^>\s+(.+?)\s*$/.exec(trimmedSH);
            if (forcedTrans && !trimmedSH.endsWith('<'))
            {
                attachTransition(currentPanel, currentPage, forcedTrans[1].trim());
                continue;
            }
        }

        // Centered `> text <` (column 0 only, leading > and trailing <).
        // Spec V2 §7.10. (The indent-aware `patterns.centered` below
        // handles inside-panel column-N centering for legacy files.)
        if (line === trimmedSH)
        {
            const centeredCol0 = /^>\s*(.+?)\s*<$/.exec(trimmedSH);
            if (centeredCol0)
            {
                attachCentered(currentPanel, currentPage, centeredCol0[1]);
                continue;
            }
        }

        // Lyrics `~line` at column 0. Spec V2 §7.10.
        if (line === trimmedSH && /^~/.test(trimmedSH))
        {
            attachLyric(currentPanel, currentPage, trimmedSH.slice(1));
            continue;
        }

        // Forced character cue `@alice` at column 0 OR at dialogue band — a
        // leading `@` forces a cue regardless of casing. The dialogue-band
        // branch lower in this loop already handles `forcedChar`
        // (col-of-dialogueIndent + `@NAME`). This block adds COLUMN-0
        // forced cues for Fountain compatibility.
        if (line === trimmedSH && /^@[A-Za-z]/.test(trimmedSH))
        {
            // Need a current panel to attach the dialogue. If none, synthesise
            // an implicit panel.
            if (!currentPanel && currentPage)
            {
                currentPanel = {
                    index: panelIndex,
                    displayNumber: 1,
                    type: 'A',
                    modifiers: [],
                    description: '',
                    dialogue: [],
                    sfx: [],
                    titleCards: [],
                    lineNumber: i,
                    lineNumberEnd: i,
                    _panelIndent: panelIndent,
                    _descParaCount: 0
                };
                panelIndex++;
            }
            const cueMatch = /^@([A-Za-z][A-Za-z0-9'\s\-&,.]*?)(?:\s+((?:\([A-Z][A-Z0-9.\s'']+\)\s*)+))?(\s*\^)?$/.exec(trimmedSH);
            if (cueMatch && currentPanel)
            {
                let charName = cueMatch[1].trim();
                const dual = !!cueMatch[3];
                const extensions = parseExtensions(cueMatch[2]);
                const isOffPanel = extensions.includes('O.P.') || extensions.includes('O.S.');
                lastDialogueChar = null;
                // TBD: dual-dialogue UI integration in <mps-visual-editor>.
                // Round-trip is correct today; only the visual editing UI is
                // missing.
                // See TODO/mps-visual-panel-editor.md → dual-dialogue-tbd task.
                currentDialogue = {
                    character: charName,
                    type: 'speech',
                    text: '',
                    offPanel: isOffPanel,
                    ...(dual ? { dualDialogue: true } : {}),
                    ...(extensions.length > 0 ? { modifier: extensions } : {})
                };
                continue;
            }
        }

        if (!currentPanel) continue;

        // TASK 2: Notes [[comment]] — appear at any indent.
        const noteMatch = line.match(/\[\[(.+?)\]\]/);
        if (noteMatch && line.trim().startsWith('[['))
        {
            if (!currentPanel.notes) currentPanel.notes = [];
            currentPanel.notes.push(noteMatch[1]);
            continue;
        }

        // TASK 4: Transitions at panel band.
        if (patterns.transitionTo.test(line) && !line.trim().startsWith('Panel') && !/^SFX[\s:]/i.test(line.trim()))
        {
            lastDialogueChar = null;
            if (!currentPanel.transitions) currentPanel.transitions = [];
            currentPanel.transitions.push(line.trim());
            continue;
        }
        // Centered text has higher priority than forced transition (both start with >).
        const centeredMatch = line.match(patterns.centered);
        if (centeredMatch)
        {
            if (!currentPanel.centered) currentPanel.centered = [];
            currentPanel.centered.push(centeredMatch[1]);
            continue;
        }
        if (patterns.forcedTrans.test(line))
        {
            lastDialogueChar = null;
            if (!currentPanel.transitions) currentPanel.transitions = [];
            currentPanel.transitions.push(line.trim().substring(1).trim());
            continue;
        }

        // TASK 7: Synopsis = text (at panel band).
        const synopsisMatch = line.match(patterns.synopsis);
        if (synopsisMatch)
        {
            currentPanel.synopsis = synopsisMatch[1];
            continue;
        }

        // TASK 10: Lyrics ~text (at panel band).
        const lyricsMatch = line.match(patterns.lyrics);
        if (lyricsMatch)
        {
            if (!currentPanel.lyrics) currentPanel.lyrics = [];
            currentPanel.lyrics.push(lyricsMatch[1]);
            continue;
        }

        // TASK 9: Forced action !text (at panel band).
        if (patterns.forcedAction.test(line))
        {
            appendDescription(currentPanel, line.trim().substring(1).trim());
            continue;
        }

        // SFX at panel band OR dialogue band.
        // Keyword `SFX` (canonical) — accept any casing, optional colon,
        // and ANY indent ≥ panelIndent. This mirrors the TITLE-card lookup
        // and matches Convention B authoring (e.g. salaryman.mangaplay) where
        // SFX sits at the dialogue band rather than the panel band.
        // Group 1 = literal keyword as written (for case validation),
        // group 2 = SFX content (verbatim, any case).
        const sfxLineMatch = (() =>
        {
            const leadLen = /^[\t ]*/.exec(line)[0].length;
            if (leadLen < panelIndent) return null;
            const trimmed = line.trimStart();
            return /^(SFX)(?::)?\s+(.+)$/i.exec(trimmed);
        })();
        if (sfxLineMatch)
        {
            lastDialogueChar = null;
            const sfxKeyword = sfxLineMatch[1];
            if (sfxKeyword !== 'SFX')
            {
                const kwCol = line.indexOf(sfxKeyword);
                errors.push({
                    line: i,
                    column: kwCol >= 0 ? kwCol : 0,
                    length: sfxKeyword.length,
                    message: `SFX keyword should be uppercase 'SFX' (got '${sfxKeyword}')`,
                    messageKey: 'parser.sfxKeywordCase',
                    severity: 'warning'
                });
            }
            currentPanel.sfx.push(sfxLineMatch[2].trim());
            continue;
        }

        // Condensed title card.
        // Keyword `TITLE` (canonical) — accept any casing, optional colon,
        // and ANY indent ≥ panelIndent (panel band OR dialogue band). This
        // matches real-world authoring where Title cards sit at the same
        // indent as dialogue (Convention B in salaryman.mangaplay).
        // Group 1 = literal keyword as written (for case validation),
        // group 2 = pipe-delimited body.
        const condensedMatch = (() =>
        {
            const leadLen = /^[\t ]*/.exec(line)[0].length;
            if (leadLen < panelIndent) return null;
            const trimmed = line.trimStart();
            return /^(TITLE)(?::)?\s+(.+)$/i.exec(trimmed);
        })();
        if (condensedMatch)
        {
            lastDialogueChar = null;
            const keyword = condensedMatch[1];
            if (keyword !== 'TITLE')
            {
                const kwCol = line.indexOf(keyword);
                errors.push({
                    line: i,
                    column: kwCol >= 0 ? kwCol : 0,
                    length: keyword.length,
                    message: `Title card keyword should be uppercase 'TITLE' (got '${keyword}')`,
                    messageKey: 'parser.titleCardKeywordCase',
                    severity: 'warning'
                });
            }
            const titleCard = parseCondensedTitleCard(condensedMatch[2]);
            if (titleCard)
            {
                currentPanel.titleCards.push(titleCard);
            }
            continue;
        }

        // Title card type marker (CHAPTER TITLE) at panel band.
        const titleTypeMatch = line.match(patterns.titleCardType);
        if (titleTypeMatch)
        {
            inTitleCard = true;
            titleCardType = titleTypeMatch[1].trim();
            continue;
        }

        // Dialogue-type marker (thought/whisper/caption) at dialogue band.
        const typeMatch = line.match(patterns.dialogueType);
        if (typeMatch && currentDialogue)
        {
            currentDialogue.type = /** @type {import('../types.js').DialogueType} */ (typeMatch[1]);
            continue;
        }

        // =====================================================================
        // Deeper-indent dialogue (indent > panelIndent + 4).
        //
        // Real-world scripts sometimes nest dialogue deeper than the canonical
        // dialogue band — e.g. a single panel whose author indents a whole
        // dialogue block by an extra level for visual grouping:
        //
        //     Panel 2
        //     Cid throws his arms away from the medic holding him back
        //
        //         MEDIC                    <- indent 8 (deeper than band 4)
        //         We still have to get you checked ...
        //
        // Accept dialogue at ANY indent ≥ panelIndent + 4 (the canonical band
        // and everything below it). If a line at a deeper band looks like a
        // speaker but is NOT all-caps, that's a hard error — dialogue speaker
        // names must be CAPITALISED.
        // =====================================================================
        const leading = /^[\t ]*/.exec(line)[0].length;
        const trimmed = line.trim();
        if (currentPanel && trimmed !== '' && leading > dialogueIndent)
        {
            // Dialogue continuation at deeper indent: mid-speech parenthetical
            // or text line following a pushed dialogue. Creates a new dialogue
            // beat under the same character.
            if (!currentDialogue && lastDialogueChar)
            {
                const deepTypeMatch2 = /^\((thought|whisper|caption)\)$/.exec(trimmed);
                if (deepTypeMatch2)
                {
                    currentDialogue = {
                        character: lastDialogueChar.character,
                        type: /** @type {import('../types.js').DialogueType} */ (deepTypeMatch2[1]),
                        text: '',
                        offPanel: lastDialogueChar.offPanel,
                        continuation: true,
                        ...(lastDialogueChar.modifier ? { modifier: lastDialogueChar.modifier } : {})
                    };
                    continue;
                }
                if (trimmed.startsWith('(') && trimmed.endsWith(')'))
                {
                    const inner = trimmed.slice(1, -1).trim();
                    if (inner)
                    {
                        currentDialogue = {
                            character: lastDialogueChar.character,
                            type: 'speech',
                            text: '',
                            offPanel: lastDialogueChar.offPanel,
                            continuation: true,
                            ...(lastDialogueChar.modifier ? { modifier: lastDialogueChar.modifier } : {}),
                            parenthetical: inner
                        };
                        continue;
                    }
                }
                if (!trimmed.startsWith('('))
                {
                    currentDialogue = {
                        character: lastDialogueChar.character,
                        type: 'speech',
                        text: trimmed,
                        offPanel: lastDialogueChar.offPanel,
                        continuation: true,
                        ...(lastDialogueChar.modifier ? { modifier: lastDialogueChar.modifier } : {})
                    };
                    currentDialogue._afterDescPara = currentPanel._descParaCount;
                    currentPanel.dialogue.push(currentDialogue);
                    lastDialogueChar = {
                        character: currentDialogue.character,
                        offPanel: currentDialogue.offPanel,
                        modifier: currentDialogue.modifier
                    };
                    currentDialogue = null;
                    continue;
                }
            }

            // Dialogue-type marker at deeper indent (parenthetical).
            const deepTypeMatch = /^\((thought|whisper|caption)\)$/.exec(trimmed);
            if (deepTypeMatch && currentDialogue)
            {
                currentDialogue.type = /** @type {import('../types.js').DialogueType} */ (deepTypeMatch[1]);
                continue;
            }

            // Speaker-name candidate: single word / short phrase, no trailing
            // punctuation beyond an optional (O.P.) marker or `^` dual flag.
            // Use a permissive "looks like a name" test (first char letter,
            // whole line is a single name-like token with no sentence-ending
            // punctuation or lowercase words) — then validate ALL CAPS.
            const nameLikePattern = /^@?([A-Za-z][A-Za-z0-9'\s\-\.]*?)(?:\s+((?:\([A-Z][A-Z0-9.\s'']+\)\s*)+))?(\s*\^)?$/;
            const nameLikeMatch = !currentDialogue || currentDialogue.text
                ? nameLikePattern.exec(trimmed)
                : null;

            const nameOnly = trimmed.replace(/\s*\(.*$/, '').replace(/\s*\^$/, '');
            const looksLikeName = nameLikeMatch
                && !/[.!?,;:]$/.test(trimmed.replace(/(?:\s*\([A-Z][A-Z0-9.\s'']+\))+$/, '').replace(/\s*\^$/, ''))
                && nameOnly.split(/\s+/).length <= 4;

            if (looksLikeName)
            {
                const rawName = nameLikeMatch[1].trim();
                const isAllCaps = rawName === rawName.toUpperCase()
                    && /[A-Z]/.test(rawName);

                if (!isAllCaps)
                {
                    // Strict rule: dialogue speaker names must be ALL CAPS.
                    errors.push({
                        line: i,
                        column: leading,
                        length: line.length - leading,
                        message: `Dialogue speaker name must be ALL CAPS: "${rawName}"`,
                        messageKey: 'parser.dialogueSpeakerNotCaps',
                        severity: 'error'
                    });
                    // Still consume the line so we don't fall through and
                    // double-report it as description/unindented text.
                    continue;
                }

                let charName = rawName;
                let dualDialogue = false;
                const extensions = parseExtensions(nameLikeMatch[2]);
                if (nameLikeMatch[3]) dualDialogue = true;
                const isOffPanel = extensions.includes('O.P.') || extensions.includes('O.S.');

                lastDialogueChar = null;
                currentDialogue = {
                    character: charName,
                    type: 'speech',
                    text: '',
                    offPanel: isOffPanel,
                    ...(dualDialogue ? { dualDialogue: true } : {}),
                    ...(extensions.length > 0 ? { modifier: extensions } : {})
                };
                continue;
            }

            // Dialogue text at deeper indent (follows a character name).
            if (currentDialogue)
            {
                if (trimmed.startsWith('(') && trimmed.endsWith(')') && !currentDialogue.text)
                {
                    const inner = trimmed.slice(1, -1).trim();
                    if (inner)
                    {
                        currentDialogue.parenthetical = inner;
                    }
                    continue;
                }
                if (!trimmed.startsWith('('))
                {
                    currentDialogue.text = trimmed;
                    currentDialogue._afterDescPara = currentPanel._descParaCount;
                    currentPanel.dialogue.push(currentDialogue);
                    lastDialogueChar = {
                        character: currentDialogue.character,
                        offPanel: currentDialogue.offPanel,
                        modifier: currentDialogue.modifier
                    };
                    currentDialogue = null;
                    continue;
                }
            }
        }

        // Character name at dialogue band. Also handles forced @NAME.
        // IMPORTANT: when we are already mid-dialogue (currentDialogue exists
        // with empty text), the next non-blank line at the dialogue band is
        // ALWAYS dialogue text, regardless of casing. Short all-caps dialogue
        // like "FFS", "WTF", "OK!", "NO", "WAIT..." must not be misread as a
        // second character cue. Skip the character/forced-char branch entirely
        // in that situation and fall through to the dialogue-text handler.
        const expectingDialogueText = currentDialogue
            && !currentDialogue.text
            && line.startsWith(dialogueIndentStr)
            && line.trim() !== ''
            && !patterns.dialogueType.test(line);
        const charMatch = expectingDialogueText ? null : line.match(patterns.dialogueChar);
        const forcedCharMatch = !charMatch && !expectingDialogueText ? line.match(patterns.forcedChar) : null;
        const effectiveCharMatch = charMatch || forcedCharMatch;
        if (effectiveCharMatch)
        {
            // Disambiguation at panel band === dialogue band (Convention B):
            // when panelIndent === 0, the character regex and description regex
            // both match lines at column 4. A bare ALL-CAPS line like `BAM.`
            // could be a character or a description. Use a 1-line lookahead:
            // require the *next* non-blank line at the dialogue band to be
            // dialogue-type `(thought|whisper|caption)` or plain text.
            // If the next line is blank + new panel OR not at dialogue band,
            // reclassify as description (rule 14 fallback, Section 3).
            let treatAsDescription = false;
            if (panelIndent === 0)
            {
                let j = i + 1;
                while (j < lines.length && lines[j].trim() === '') j++;
                const next = j < lines.length ? lines[j] : '';
                const isDialogueType = patterns.dialogueType.test(next);
                // Any non-empty text at the dialogue band qualifies as plausible
                // dialogue text — including ALL-CAPS short dialogue ("FFS",
                // "WTF", "OK!") that would otherwise look like a second
                // character cue. We previously excluded `dialogueChar` matches
                // here, but that produced a false-positive "ambiguous" warning
                // for legitimate short caps dialogue. The dialogue-text branch
                // below will consume the next line correctly once the current
                // CHARACTER cue is preserved.
                const isDialogueBandText =
                    next.startsWith(dialogueIndentStr) &&
                    next.trim() !== '' &&
                    !isDialogueType;
                const isNewPanel = PANEL_DETECT.test(next);
                // Convention B: dialogue band === panel band, so any text at
                // `dialogueIndentStr` qualifies. New panel or EOF forces the
                // fallback.
                if (isNewPanel || next === '' || (!isDialogueType && !isDialogueBandText))
                {
                    treatAsDescription = true;
                    errors.push({
                        line: i,
                        column: 0,
                        length: line.length,
                        message: `Ambiguous ALL-CAPS line treated as description (no dialogue follows).`,
                        messageKey: 'parser.ambiguousCharacter',
                        severity: 'warning'
                    });
                }
            }

            if (!treatAsDescription)
            {
                let charName = (charMatch ? charMatch[1] : forcedCharMatch[1]).trim();
                let dualDialogue = false;
                const extGroup = charMatch ? charMatch[2] : forcedCharMatch[2];
                const caretGroup = charMatch ? charMatch[3] : forcedCharMatch[3];
                if (caretGroup) dualDialogue = true;
                const extensions = parseExtensions(extGroup);
                const isOffPanel = extensions.includes('O.P.') || extensions.includes('O.S.');
                lastDialogueChar = null;
                currentDialogue = {
                    character: charName,
                    type: 'speech',
                    text: '',
                    offPanel: isOffPanel,
                    ...(dualDialogue ? { dualDialogue: true } : {}),
                    ...(extensions.length > 0 ? { modifier: extensions } : {})
                };
                continue;
            }
            // Ambiguity fallback (Convention B only): the ALL-CAPS line is
            // reclassified as description. Capture it here rather than falling
            // through to the generic description branch — in Convention B
            // the generic branch only catches column-0 lines, but this fallback
            // originates from a dialogue-band line.
            appendDescription(currentPanel, line.trim());
            continue;
        }

        // Title card content (block form): name + optional info.
        if (inTitleCard)
        {
            const nameMatch = line.match(patterns.titleCardName);
            if (nameMatch)
            {
                const infoLine = lines[i + 1] || '';
                const infoMatch = infoLine.match(patterns.titleCardInfo);

                currentPanel.titleCards.push({
                    type: titleCardType,
                    name: nameMatch[1].trim(),
                    info: infoMatch ? infoMatch[1].trim() : undefined
                });

                if (infoMatch) i++; // Skip info line
                inTitleCard = false;
                continue;
            }
        }

        // Dialogue continuation at dialogue band: mid-speech parenthetical
        // or text line following a pushed dialogue under the same character.
        if (!currentDialogue && lastDialogueChar && currentPanel
            && line.startsWith(dialogueIndentStr) && line.trim() !== '')
        {
            const contText = line.trim();
            if (panelIndent === 4 && line.startsWith(' '.repeat(panelIndent + 8)))
            {
                // Over-indented in Conv A — skip, fall through.
            }
            else
            {
                const contTypeMatch = /^\((thought|whisper|caption)\)$/.exec(contText);
                if (contTypeMatch)
                {
                    currentDialogue = {
                        character: lastDialogueChar.character,
                        type: /** @type {import('../types.js').DialogueType} */ (contTypeMatch[1]),
                        text: '',
                        offPanel: lastDialogueChar.offPanel,
                        continuation: true,
                        ...(lastDialogueChar.modifier ? { modifier: lastDialogueChar.modifier } : {})
                    };
                    continue;
                }
                if (contText.startsWith('(') && contText.endsWith(')'))
                {
                    const inner = contText.slice(1, -1).trim();
                    if (inner)
                    {
                        currentDialogue = {
                            character: lastDialogueChar.character,
                            type: 'speech',
                            text: '',
                            offPanel: lastDialogueChar.offPanel,
                            continuation: true,
                            ...(lastDialogueChar.modifier ? { modifier: lastDialogueChar.modifier } : {}),
                            parenthetical: inner
                        };
                        continue;
                    }
                }
                if (!contText.startsWith('('))
                {
                    currentDialogue = {
                        character: lastDialogueChar.character,
                        type: 'speech',
                        text: contText,
                        offPanel: lastDialogueChar.offPanel,
                        continuation: true,
                        ...(lastDialogueChar.modifier ? { modifier: lastDialogueChar.modifier } : {})
                    };
                    currentDialogue._afterDescPara = currentPanel._descParaCount;
                    currentPanel.dialogue.push(currentDialogue);
                    lastDialogueChar = {
                        character: currentDialogue.character,
                        offPanel: currentDialogue.offPanel,
                        modifier: currentDialogue.modifier
                    };
                    currentDialogue = null;
                    continue;
                }
            }
        }

        // Dialogue text at dialogue band.
        if (currentDialogue && line.startsWith(dialogueIndentStr))
        {
            // In Convention A, description is at panelIndent (4) and dialogue
            // is at panelIndent + 4 (8). In Convention B, both collapse to the
            // same indent. We still require strict-start-with dialogueIndentStr
            // and guard against over-indented (8+ in A) blocks being eaten.
            if (panelIndent === 4 && line.startsWith(' '.repeat(panelIndent + 8)))
            {
                // Over-indented — ignore here, fall through.
            }
            else
            {
                const text = line.trim();
                if (text)
                {
                    if (text.startsWith('(') && text.endsWith(')') && !currentDialogue.text)
                    {
                        // Fountain-style parenthetical between character cue and dialogue
                        const inner = text.slice(1, -1).trim();
                        if (inner)
                        {
                            currentDialogue.parenthetical = inner;
                        }
                        continue;
                    }
                    if (!text.startsWith('('))
                    {
                        currentDialogue.text = text;
                        currentDialogue._afterDescPara = currentPanel._descParaCount;
                        currentPanel.dialogue.push(currentDialogue);
                        lastDialogueChar = {
                            character: currentDialogue.character,
                            offPanel: currentDialogue.offPanel,
                            modifier: currentDialogue.modifier
                        };
                        currentDialogue = null;
                        continue;
                    }
                }
            }
        }

        // Track blank lines between description paragraphs.
        // Also clear lastDialogueChar — blank line ends continuation window.
        if (line.trim() === '')
        {
            lastDialogueChar = null;
            if (currentPanel && currentPanel.description)
            {
                descriptionGap = true;
            }
        }

        // Forced @cue follow-up: when currentDialogue was set by a column-0
        // forced cue (`@alice` Fountain syntax) and we hit the next non-blank
        // content line, take it as dialogue text regardless of indent.
        if (currentDialogue && currentDialogue.character && !currentDialogue.text
            && line.trim() !== '')
        {
            const trimmedFC = line.trim();
            if (trimmedFC.startsWith('(') && trimmedFC.endsWith(')'))
            {
                const inner = trimmedFC.slice(1, -1).trim();
                if (inner)
                {
                    currentDialogue.parenthetical = inner;
                }
                continue;
            }
            if (!trimmedFC.startsWith('('))
            {
                currentDialogue.text = trimmedFC;
                currentDialogue._afterDescPara = currentPanel._descParaCount;
                currentPanel.dialogue.push(currentDialogue);
                lastDialogueChar = {
                    character: currentDialogue.character,
                    offPanel: currentDialogue.offPanel,
                    modifier: currentDialogue.modifier
                };
                currentDialogue = null;
                continue;
            }
        }

        // Convention C auto-detection: column-0 character cue.
        // When panelIndent === 0 (Convention B), an ALL-CAPS line at column 0
        // followed by non-blank, non-header, non-ALL-CAPS text at column 0
        // switches to Convention C (dialogueIndent = 0).
        if (panelIndent === 0 && dialogueIndentStr.length > 0
            && currentPanel && line === trimmedSH && trimmedSH !== '')
        {
            const col0CueMatch = /^([A-Z][A-Z0-9\s'\-]+?)(?:\s+((?:\([A-Z][A-Z0-9.\s'']+\)\s*)+))?(\s*\^)?$/.exec(trimmedSH);
            if (col0CueMatch
                && !/[.]$/.test(trimmedSH.replace(/(?:\s*\([A-Z][A-Z0-9.\s'']+\))+$/, '').replace(/\s*\^$/, ''))
                && !/^[A-Z][A-Z\s]*TO:$/.test(trimmedSH)
                && !/^FADE (OUT\.|IN:)$/.test(trimmedSH)
                && !/^SFX[\s:]/i.test(trimmedSH)
                && !/^TITLE(?::)?\s/i.test(trimmedSH))
            {
                // Lookahead: next non-blank line should be plausible dialogue
                let j = i + 1;
                while (j < lines.length && lines[j].trim() === '') j++;
                const next = j < lines.length ? lines[j] : '';
                const nextTrimmed = next.trim();
                const nextIsPanel = PANEL_DETECT.test(next);
                const nextIsPage = /^#\s+PAGE/i.test(next);
                const nextIsAllCaps = nextTrimmed === nextTrimmed.toUpperCase() && /[A-Z]/.test(nextTrimmed);
                const nextHasContent = nextTrimmed !== '';

                const nextStartsEmphasis = /^[*_]/.test(nextTrimmed);
                const nextHasSentencePunct = /[.!?]/.test(nextTrimmed);
                if (nextHasContent && !nextIsPanel && !nextIsPage
                    && (!nextIsAllCaps || /^\(/.test(nextTrimmed) || nextStartsEmphasis || nextHasSentencePunct))
                {
                    // Switch to Convention C
                    setPanelIndent(0, 0);
                    currentPanel._dialogueIndent = 0;
                    // Re-process this line — it will now match dialogueChar at column 0
                    i--;
                    continue;
                }
            }
        }

        // Description at panel band.
        // Convention A: line starts with 4 spaces but NOT 8 (reserve 8 for dialogue band).
        // Convention B: panel band is column 0. Description starts at column 0 and does
        //   NOT start with 4 spaces (which would be the dialogue band).
        const isDescriptionBand = panelIndent === 0
            ? (line.length > 0 && !line.startsWith(' '))
            : (line.startsWith(panelIndentStr) && !line.startsWith(dialogueIndentStr));
        if (isDescriptionBand)
        {
            lastDialogueChar = null;
            const desc = line.trim();
            if (desc && !desc.startsWith('Panel') && !/^SFX[\s:]/i.test(desc) && !desc.startsWith('(') && !/^TITLE(?::)?\s/i.test(desc))
            {
                appendDescription(currentPanel, desc);
            }
            continue;
        }

        // Strict ALL-CAPS rule at the standard dialogue band. A name-like
        // line at the dialogue indent that is NOT all caps is an error —
        // dialogue speaker names must be CAPITALISED.
        if (currentPanel && line.startsWith(dialogueIndentStr) && line.trim() !== '')
        {
            const bandTrimmed = line.trim();
            const bandCandidate = /^@?([A-Za-z][A-Za-z0-9'\s\-\.]*?)(?:\s+((?:\([A-Z][A-Z0-9.\s'']+\)\s*)+))?(\s*\^)?$/.exec(bandTrimmed);
            const bandNameOnly = bandTrimmed.replace(/\s*\(.*$/, '').replace(/\s*\^$/, '');
            const bandLooksLikeName = bandCandidate
                && !/[.!?,;:]$/.test(bandTrimmed.replace(/(?:\s*\([A-Z][A-Z0-9.\s'']+\))+$/, '').replace(/\s*\^$/, ''))
                && bandNameOnly.split(/\s+/).length <= 4
                // Exclude dialogue-type parentheticals (already handled above).
                && !/^\((thought|whisper|caption)\)$/.test(bandTrimmed);
            if (bandLooksLikeName)
            {
                const candName = bandCandidate[1].trim();
                const isAllCaps = candName === candName.toUpperCase()
                    && /[A-Z]/.test(candName);
                // Only flag as speaker-miscase when there's no active dialogue
                // text (else this is obviously the dialogue text line).
                if (!isAllCaps && (!currentDialogue || !currentDialogue.text))
                {
                    errors.push({
                        line: i,
                        column: dialogueIndentStr.length,
                        length: bandTrimmed.length,
                        message: `Dialogue speaker name must be ALL CAPS: "${candName}"`,
                        messageKey: 'parser.dialogueSpeakerNotCaps',
                        severity: 'error'
                    });
                    continue;
                }
            }
        }

        // Lenient fallback (both conventions): a line at the dialogue band
        // that wasn't a character name and has no currentDialogue context is
        // tolerated as description. Real hand-written files (e.g. salaryman)
        // mix description text that sits at the dialogue band rather than the
        // panel band. Keep the content rather than dropping it.
        //
        // Convention A (panelIndent === 4): dialogue band is 8 spaces. A line
        //   like "        Baddie sets his eyes..." below a bare panel header
        //   should become description.
        // Convention B (panelIndent === 0): dialogue band is 4 spaces. A line
        //   like "    Title: Cincinnati Cid | (19)" between dialogue entries
        //   should become description.
        if (currentPanel && !currentDialogue && line.startsWith(dialogueIndentStr) && line.trim() !== '')
        {
            lastDialogueChar = null;
            // Guard against over-indented content in Conv A (12+ spaces) which
            // should fall through to the generic description/ignore path.
            const overIndented = panelIndent === 4 && line.startsWith(' '.repeat(panelIndent + 8));
            if (!overIndented)
            {
                const desc = line.trim();
                if (desc && !desc.startsWith('Panel') && !/^SFX[\s:]/i.test(desc) && !desc.startsWith('(') && !/^TITLE(?::)?\s/i.test(desc))
                {
                    appendDescription(currentPanel, desc);

                    if (panelIndent === 0 && dialogueIndentStr.length > 0)
                    {
                        emitWarning('WARN_ACTION_INDENTED', [], {
                            line: i,
                            column: 0,
                            length: line.length,
                            severity: 'warning'
                        });
                    }
                }
                continue;
            }
        }

        // Lenient fallback: text at an indent strictly less than panelIndent.
        // This only fires in Convention A (panelIndent === 4) where column-0
        // text inside a panel is a user error. In Convention B (panelIndent === 0)
        // the description branch already covered column-0 text.
        if (currentPanel && line.trim() !== '' && panelIndent > 0 && !line.startsWith(panelIndentStr) && !line.startsWith('#') && !/^[A-Za-z]+:\s/.test(line))
        {
            appendDescription(currentPanel, line.trim());

            errors.push({
                line: i,
                column: 0,
                length: line.length,
                message: `Unindented text inside panel — add ${panelIndent} spaces for correct formatting`,
                messageKey: 'parser.unindentedPanelText',
                severity: 'warning'
            });
        }
    }

    // Push final panel and page.
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

    // Inline emphasis pass — annotate `spans` on description and dialogue
    // when Fountain emphasis markers are present. Backward-compat: existing
    // `text` / `description` fields are unchanged.
    for (const page of pages)
    {
        for (const panel of page.panels)
        {
            if (panel.description)
            {
                const spans = parseEmphasis(panel.description);
                if (spans)
                {
                    panel.spans = spans;
                    panel.rawDescription = panel.description;
                    panel.description = spans.map(s => s.text).join('');
                }
                else
                {
                    panel.rawDescription = panel.description;
                }
                panel.description = stripEmphasisEscapes(panel.description);
                panel.description = panel.description.replace(/\[\[.*?\]\]/g, '').trim();
                panel.rawDescription = panel.rawDescription.replace(/\[\[.*?\]\]/g, '').trim();
            }
            for (const d of panel.dialogue)
            {
                if (d.text)
                {
                    const spans = parseEmphasis(d.text);
                    if (spans)
                    {
                        d.spans = spans;
                        d.rawText = d.text;
                        d.text = spans.map(s => s.text).join('');
                    }
                    else
                    {
                        d.rawText = d.text;
                    }
                    d.text = stripEmphasisEscapes(d.text);
                    d.text = d.text.replace(/\[\[.*?\]\]/g, '').trim();
                    d.rawText = d.rawText.replace(/\[\[.*?\]\]/g, '').trim();
                }
            }
            if (Array.isArray(panel.sfx))
            {
                panel.sfx = panel.sfx.map(s => typeof s === 'string' ? stripEmphasisEscapes(s) : s);
            }
        }
    }

    return pages;
}

/**
 * Attach a scene heading node to the current panel (preferred) or page.
 * @param {Panel|null} panel
 * @param {Page|null} page
 * @param {string} text - Trimmed scene-heading text (with leading INT/EXT or
 *   forced-period-stripped fallback).
 */
function attachSceneHeading(panel, page, text)
{
    const target = panel || page;
    if (!target) return;
    if (!target.sceneHeadings) target.sceneHeadings = [];
    target.sceneHeadings.push(text);
}

/**
 * Attach a transition to the current panel or page.
 * @param {Panel|null} panel
 * @param {Page|null} page
 * @param {string} text
 */
function attachTransition(panel, page, text)
{
    const target = panel || page;
    if (!target) return;
    if (!target.transitions) target.transitions = [];
    target.transitions.push(text);
}

/**
 * Attach a centered text span to the current panel or page.
 * @param {Panel|null} panel
 * @param {Page|null} page
 * @param {string} text
 */
function attachCentered(panel, page, text)
{
    const target = panel || page;
    if (!target) return;
    if (!target.centered) target.centered = [];
    target.centered.push(text);
}

/**
 * Attach a lyric line to the current panel or page.
 * @param {Panel|null} panel
 * @param {Page|null} page
 * @param {string} text
 */
function attachLyric(panel, page, text)
{
    const target = panel || page;
    if (!target) return;
    if (!target.lyrics) target.lyrics = [];
    target.lyrics.push(text);
}

/**
 * Find the next occurrence of `marker` in `text` starting at `start`, skipping
 * any occurrences that are escaped (preceded by a backslash that isn't itself
 * escaped). Returns -1 when no unescaped match is found.
 *
 * @param {string} text
 * @param {string} marker
 * @param {number} start
 * @returns {number}
 */
function findUnescapedMarker(text, marker, start)
{
    let from = start;
    while (from < text.length)
    {
        const idx = text.indexOf(marker, from);
        if (idx === -1) return -1;
        // Count consecutive backslashes immediately before idx — an even
        // number means the marker itself is unescaped (the backslashes pair
        // off as `\\`); an odd number means the marker is escaped.
        let bs = 0;
        let k = idx - 1;
        while (k >= 0 && text[k] === '\\') { bs++; k--; }
        if ((bs & 1) === 0) return idx;
        from = idx + 1;
    }
    return -1;
}

/**
 * Strip backslash escapes used by Fountain emphasis: `\*`, `\_`, `\\` collapse
 * to their literal characters. Other backslashes are preserved (a stray `\n`
 * in prose isn't an escape, just a backslash + n).
 *
 * @param {string} s
 * @returns {string}
 */
export function stripEmphasisEscapes(s)
{
    if (!s || s.indexOf('\\') === -1) return s;
    return s.replace(/\\([*_\\])/g, '$1');
}

function mergeStyles(outer, inner)
{
    if (!inner) return outer;
    if (!outer) return inner;
    const parts = new Set();
    for (const s of [outer, inner])
    {
        if (s.includes('bold')) parts.add('bold');
        if (s.includes('italic')) parts.add('italic');
        if (s.includes('underline')) parts.add('underline');
    }
    let base = null;
    if (parts.has('bold') && parts.has('italic')) base = 'bold-italic';
    else if (parts.has('bold')) base = 'bold';
    else if (parts.has('italic')) base = 'italic';
    if (parts.has('underline'))
    {
        return base ? base + '+underline' : 'underline';
    }
    return base;
}

/**
 * Inline emphasis pass. Parses Fountain-style markers `*italic*`, `**bold**`,
 * `***bold italic***`, `_underline_` and produces an array of styled spans.
 * Handles nesting (e.g. `_**bold underline**_`). Honours backslash escapes
 * (`\*`, `\_`, `\\`) — escaped markers are emitted literally and never close
 * an emphasis run. Returns null when the text has no styling — callers may
 * then leave the existing `text` field unchanged for backward compatibility.
 * @param {string} text
 * @returns {Array<{ text: string, style: string|null }> | null}
 */
export function parseEmphasis(text)
{
    if (!text) return null;
    if (!/[*_]/.test(text)) return null;

    const spans = [];
    let i = 0;
    let plain = '';
    const flushPlain = () =>
    {
        if (plain !== '')
        {
            spans.push({ text: plain, style: null });
            plain = '';
        }
    };

    while (i < text.length)
    {
        const ch = text[i];
        if (ch === '\\' && i + 1 < text.length)
        {
            plain += text[i + 1];
            i += 2;
            continue;
        }

        // *** … *** (bold-italic)
        if (text.substr(i, 3) === '***')
        {
            const end = findUnescapedMarker(text, '***', i + 3);
            if (end !== -1)
            {
                flushPlain();
                const inner = text.slice(i + 3, end);
                const innerSpans = parseEmphasis(inner);
                if (innerSpans)
                {
                    for (const s of innerSpans)
                    {
                        spans.push({ text: s.text, style: mergeStyles('bold-italic', s.style) });
                    }
                }
                else
                {
                    spans.push({ text: stripEmphasisEscapes(inner), style: 'bold-italic' });
                }
                i = end + 3;
                continue;
            }
        }
        // ** … ** (bold)
        if (text.substr(i, 2) === '**')
        {
            const end = findUnescapedMarker(text, '**', i + 2);
            if (end !== -1)
            {
                flushPlain();
                const inner = text.slice(i + 2, end);
                const innerSpans = parseEmphasis(inner);
                if (innerSpans)
                {
                    for (const s of innerSpans)
                    {
                        spans.push({ text: s.text, style: mergeStyles('bold', s.style) });
                    }
                }
                else
                {
                    spans.push({ text: stripEmphasisEscapes(inner), style: 'bold' });
                }
                i = end + 2;
                continue;
            }
        }
        // * … * (italic)
        if (ch === '*')
        {
            const end = findUnescapedMarker(text, '*', i + 1);
            if (end !== -1 && end > i + 1)
            {
                flushPlain();
                const inner = text.slice(i + 1, end);
                const innerSpans = parseEmphasis(inner);
                if (innerSpans)
                {
                    for (const s of innerSpans)
                    {
                        spans.push({ text: s.text, style: mergeStyles('italic', s.style) });
                    }
                }
                else
                {
                    spans.push({ text: stripEmphasisEscapes(inner), style: 'italic' });
                }
                i = end + 1;
                continue;
            }
        }
        // _ … _ (underline)
        if (ch === '_')
        {
            const end = findUnescapedMarker(text, '_', i + 1);
            if (end !== -1 && end > i + 1)
            {
                flushPlain();
                const inner = text.slice(i + 1, end);
                const innerSpans = parseEmphasis(inner);
                if (innerSpans)
                {
                    for (const s of innerSpans)
                    {
                        spans.push({ text: s.text, style: mergeStyles('underline', s.style) });
                    }
                }
                else
                {
                    spans.push({ text: stripEmphasisEscapes(inner), style: 'underline' });
                }
                i = end + 1;
                continue;
            }
        }

        plain += ch;
        i++;
    }
    flushPlain();

    if (spans.length === 1 && spans[0].style === null) return null;
    if (spans.length === 0) return null;
    return spans;
}

/**
 * Find the last non-empty line in a range
 * @param {string[]} lines - All lines
 * @param {number} start - Start line (inclusive)
 * @param {number} end - End line (inclusive)
 * @returns {number} - Last non-empty line number
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

/**
 * Parses a page ID into base number and suffix
 * @param {string} pageId - e.g., "1", "10-1", "0-COVER", "0-I"
 * @returns {{ baseNumber: number, suffix?: string }}
 */
function parsePageId(pageId) {
    if (pageId.includes('-')) {
        const [base, suffix] = pageId.split('-');
        return {
            baseNumber: parseInt(base, 10),
            suffix
        };
    }
    return {
        baseNumber: parseInt(pageId, 10)
    };
}

/**
 * Parses a condensed title card line.
 *
 * Two-segment forms:
 *   - "NAME | Age 44"                      → name="NAME",  info="Age 44"
 *   - "Cincinnati Cid | (19)"              → name="Cincinnati Cid", info="(19)"
 *     (parenthetical sibling identifies the OTHER segment as the name,
 *      regardless of casing — supports Title Case / mixed case names)
 *
 * Three+-segment forms:
 *   - "Formal Title | NAME | Age info"     → type="Formal Title", name="NAME", info="Age info"
 *
 * @param {string} content - The content after the TITLE keyword
 * @returns {TitleCard | null}
 */
function parseCondensedTitleCard(content) {
    // Format: Formal Title | NAME | Age XX (appears YY)
    const parts = content.split('|').map(p => p.trim());
    if (parts.length < 2) return null;

    // Handle different formats
    if (parts.length === 2) {
        // Parenthetical-aware: if exactly one segment is wrapped in (),
        // the OTHER segment is the name (regardless of casing).
        const isParen = parts.map(p => p.startsWith('(') && p.endsWith(')'));
        if (isParen[0] !== isParen[1]) {
            const nameIdx = isParen[0] ? 1 : 0;
            const infoIdx = 1 - nameIdx;
            return {
                type: 'TITLE',
                name: parts[nameIdx],
                info: parts[infoIdx]
            };
        }
        // Default 2-part: NAME | Age info
        return {
            type: 'TITLE',
            name: parts[0],
            info: parts[1]
        };
    }

    // Formal Title | NAME | Age info
    return {
        type: parts[0],
        name: parts[1],
        info: parts[2]
    };
}

/**
 * Post-parse smell tests — detect common "something went wrong" signals.
 * @param {Page[]} pages
 * @param {string} markdown
 * @param {ParseWarning[]} warnings
 * @param {Function} emitWarning
 */
function runSmellTests(pages, markdown, warnings, emitWarning)
{
    const lines = markdown.split('\n');
    const nonBlankLines = lines.filter(l => l.trim() !== '');

    // 1. No content after title page
    const totalPanels = pages.reduce((sum, p) => sum + p.panels.length, 0);
    const totalContent = pages.reduce((sum, p) =>
        sum + p.panels.reduce((ps, panel) =>
            ps + (panel.description ? 1 : 0) + panel.dialogue.length, 0), 0);
    if (pages.length > 0 && totalContent === 0 && nonBlankLines.length > 3)
    {
        emitWarning('PARSE_UNKNOWN_FORMAT', [], {
            line: 0, severity: 'warning'
        });
    }

    // 2. Empty panels
    for (const page of pages)
    {
        for (const panel of page.panels)
        {
            const hasContent = panel.description
                || panel.dialogue.length > 0
                || panel.sfx.length > 0
                || panel.titleCards.length > 0
                || (panel.sceneHeadings && panel.sceneHeadings.length > 0)
                || (panel.transitions && panel.transitions.length > 0);
            if (!hasContent)
            {
                emitWarning('PARSE_EMPTY_PANEL', [panel.displayNumber], {
                    line: panel.lineNumber ?? 0,
                    severity: 'warning'
                });
            }
        }
    }
}

export default { parseScript };
