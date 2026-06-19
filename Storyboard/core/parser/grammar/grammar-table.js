/**
 * Per-format grammar tables for editor highlighting, structured-input UIs, and
 * autocomplete. Three tables share a `TableEntry` typedef and a `classify(line,
 * table)` dispatcher. Mangaplay panel classification routes through the
 * canonical `tag-classifier.js` sets — no duplication.
 *
 * Each entry's `classify` runs only after `pattern.test(line)` succeeds, so the
 * classifier can assume the regex matched. Order matters — first match wins.
 *
 * @module core/parser/grammar/grammar-table
 */

import { extractTags, classifyTags } from '../tag-classifier.js';

/**
 * @typedef {Object} ClassifiedLine
 * @property {string} name - The grammar token name (e.g. 'panel', 'character').
 * @property {string} raw - The original line text.
 * @property {string[]} [tags] - Optional structured tags (Mangaplay panels).
 * @property {string} [number] - Optional captured number (page / panel).
 * @property {string} [speaker] - Optional captured speaker (sup dialogue cue).
 */

/**
 * @typedef {Object} TableEntry
 * @property {string} name - Stable grammar token name.
 * @property {RegExp} pattern - Test regex for line membership.
 * @property {(line: string, context?: any) => ClassifiedLine} classify
 * @property {string[]} [editorDecorations] - Placeholder for CodeMirror 6 decoration tags.
 */

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Classify a single line against a per-format grammar table.
 *
 * Returns the first matching entry's classifier output. When no entry matches,
 * the line is classified as `action` (the universal default).
 *
 * @param {string} line
 * @param {TableEntry[]} table
 * @param {any} [context]
 * @returns {ClassifiedLine}
 */
export function classify(line, table, context)
{
    for (const entry of table)
    {
        if (entry.pattern.test(line))
        {
            return entry.classify(line, context);
        }
    }
    return { name: 'action', raw: line };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ACTION = (line) => ({ name: 'action', raw: line });
const SCENE_HEADING_RE = /^(INT|EXT|EST|INT\.\/EXT\.|INT\/EXT|EXT\.\/INT\.|EXT\/INT|I\/E|E\/I)\.?\s/i;
const TRANSITION_RE = /^(?:>\s*.+|.*TO:\s*$|FADE OUT\.\s*$|FADE IN:\s*$)/;
const CENTERED_RE = /^>\s.+\s<\s*$/;
const LYRICS_RE = /^~.+$/;
const NOTE_RE = /^\[\[.+\]\]\s*$/;

// ---------------------------------------------------------------------------
// Fountain table
// ---------------------------------------------------------------------------

/** @type {TableEntry[]} */
export const fountainTable = [
    {
        name: 'centered',
        pattern: CENTERED_RE,
        classify: (line) => ({ name: 'centered', raw: line })
    },
    {
        name: 'lyrics',
        pattern: LYRICS_RE,
        classify: (line) => ({ name: 'lyrics', raw: line })
    },
    {
        name: 'note',
        pattern: NOTE_RE,
        classify: (line) => ({ name: 'note', raw: line })
    },
    {
        name: 'scene_heading',
        pattern: SCENE_HEADING_RE,
        classify: (line) => ({ name: 'scene_heading', raw: line })
    },
    {
        name: 'forced_scene_heading',
        pattern: /^\.\S/,
        classify: (line) => ({ name: 'scene_heading', raw: line })
    },
    {
        name: 'transition',
        pattern: TRANSITION_RE,
        classify: (line) => ({ name: 'transition', raw: line })
    },
    {
        name: 'parenthetical',
        pattern: /^\s*\(.+\)\s*$/,
        classify: (line) => ({ name: 'parenthetical', raw: line })
    },
    {
        name: 'character',
        // ALL-CAPS cue with optional (EXT) extension. Plain cue lines only —
        // dialogue follows on the next line.
        pattern: /^[A-Z][A-Z0-9\s'&,.\-]+(?:\s*\([A-Z'.\s]+\))?$/,
        classify: (line) => ({ name: 'character', raw: line })
    }
];

// ---------------------------------------------------------------------------
// Mangaplay table
// ---------------------------------------------------------------------------

const MANGAPLAY_PAGE_RE = /^#\s*Page(\s+\S.*)?$/i;
const MANGAPLAY_LEGACY_PANEL_RE = /^#\s*Panel\s+\d/i;
const MANGAPLAY_PANEL_RE = /^Panel\s+(\d+(?:-\d+)?)((?:\s*\[[^\]]+\])*)\s*$/i;
const MANGAPLAY_SFX_RE = /^SFX(?:\s*:)?\s+\S/i;
const MANGAPLAY_BONEYARD_RE = /^\/\*\s*PANEL\b/i;

/** @type {TableEntry[]} */
export const mangaplayTable = [
    {
        name: 'page',
        pattern: MANGAPLAY_PAGE_RE,
        classify: (line) =>
        {
            const m = line.match(/^#\s*Page\s+(\S+)/i);
            const number = m ? m[1] : '';
            return { name: 'page', raw: line, number };
        }
    },
    {
        name: 'panel_boneyard',
        pattern: MANGAPLAY_BONEYARD_RE,
        classify: (line) => ({ name: 'panel_boneyard', raw: line })
    },
    {
        name: 'panel_legacy',
        pattern: MANGAPLAY_LEGACY_PANEL_RE,
        classify: (line) =>
        {
            const m = line.match(/^#\s*Panel\s+(\d+(?:-\d+)?)((?:\s*\[[^\]]+\])*)/i);
            const number = m ? m[1] : '';
            const rawTagStr = m && m[2] ? m[2] : '';
            const tags = classifiedTagNames(rawTagStr);
            return { name: 'panel', raw: line, number, tags };
        }
    },
    {
        name: 'panel',
        pattern: MANGAPLAY_PANEL_RE,
        classify: (line) =>
        {
            const m = line.match(MANGAPLAY_PANEL_RE);
            const number = m ? m[1] : '';
            const rawTagStr = m && m[2] ? m[2] : '';
            const tags = classifiedTagNames(rawTagStr);
            return { name: 'panel', raw: line, number, tags };
        }
    },
    {
        name: 'sfx',
        pattern: MANGAPLAY_SFX_RE,
        classify: (line) => ({ name: 'sfx', raw: line })
    },
    {
        name: 'note',
        pattern: NOTE_RE,
        classify: (line) => ({ name: 'note', raw: line })
    },
    {
        name: 'scene_heading',
        pattern: SCENE_HEADING_RE,
        classify: (line) => ({ name: 'scene_heading', raw: line })
    },
    {
        name: 'forced_scene_heading',
        pattern: /^\.\S/,
        classify: (line) => ({ name: 'scene_heading', raw: line })
    },
    {
        name: 'transition',
        pattern: TRANSITION_RE,
        classify: (line) => ({ name: 'transition', raw: line })
    },
    {
        name: 'parenthetical',
        // Mangaplay parentheticals usually sit on their own line, often
        // indented after a cue. Accept indented (paren) lines.
        pattern: /^\s*\([^)]+\)\s*$/,
        classify: (line) => ({ name: 'parenthetical', raw: line })
    },
    {
        name: 'character',
        // ALL-CAPS cue at column 0 (Mangaplay convention is indented dialogue,
        // ALL-CAPS speaker at column 0).
        pattern: /^[A-Z][A-Z0-9\s'&,.\-]+(?:\s*\([A-Z'.\s]+\))?$/,
        classify: (line) => ({ name: 'character', raw: line })
    }
];

/**
 * Surface the canonical tag names for a Mangaplay panel header. Routes via the
 * shared tag-classifier so the canonical layout/size/style/modifier sets stay
 * in one place.
 *
 * @param {string} rawTagStr - The bracketed tag text after the panel number.
 * @returns {string[]}
 */
function classifiedTagNames(rawTagStr)
{
    if (!rawTagStr) return [];
    const tags = extractTags(rawTagStr);
    const classified = classifyTags(tags, 0);
    // Build a flat name list reflecting every channel set on the panel.
    const names = [];
    if (classified.layout && classified.layout !== 'none') names.push(classified.layout);
    if (classified.size) names.push(classified.size);
    if (classified.style) names.push(classified.style);
    if (classified.orientation) names.push(classified.orientation);
    if (classified.hasSplit) names.push('SPLIT');
    if (classified.joinGroup) names.push('G');
    if (classified.placeAtEnd) names.push('END');
    return names;
}

// ---------------------------------------------------------------------------
// Superscript (.sup) table
//
// Regex sources: Fountain-Plus/Storyboard/core/parser/superscript-parser.js
// PATTERNS object (lines 55-84). Patterns are duplicated here because the
// superscript-parser module does not export its PATTERNS object — keeping them
// inline avoids a churn-prone parser export. Update both sites together if the
// superscript regexes change.
// ---------------------------------------------------------------------------

const SUP_PAGE_RE = /^PAGE\s+(\d+)(\.)?(?:\s+(INT|EXT)(\.?)\s+(.+?)(?:\s*-\s*(DAY|NIGHT|DAWN|DUSK))?)?$/i;
const SUP_PANEL_RE = /^(?:Panel|PANEL)\s+(\d+(?:-\d+)?)(\.)?(?:\s*((?:\s*\[[A-Z][A-Z0-9\s\-\/]*\])+))?$/;
const SUP_DIALOGUE_RE = /^([A-Z][A-Z\s']*?)(?:\s+\(O\.P\.\))?:\s*(.*)$/;
const SUP_DIALOGUE_CONT_RE = /^(?:\s{2}|\t)(.+)$/;
const SUP_SFX_RE = /^SFX(?:\s*:)?\s+(.+)$/i;
const SUP_FRONT_MATTER_RE = /^([a-zA-Z][a-zA-Z\s]*):\s+(.+)$/;
const SUP_LAST_SPEAKER_RE = /^:\s+(.+)$/;
const SUP_PREV_SPEAKER_RE = /^::\s+(.+)$/;
const SUP_TITLE_RE = /^#\s+(.+)$/;

/** @type {TableEntry[]} */
export const supTable = [
    {
        name: 'page',
        pattern: SUP_PAGE_RE,
        classify: (line) =>
        {
            const m = line.match(SUP_PAGE_RE);
            return { name: 'page', raw: line, number: m ? m[1] : '' };
        }
    },
    {
        name: 'panel',
        pattern: SUP_PANEL_RE,
        classify: (line) =>
        {
            const m = line.match(SUP_PANEL_RE);
            const rawTagStr = m && m[3] ? m[3] : '';
            const tags = classifiedTagNames(rawTagStr);
            return { name: 'panel', raw: line, number: m ? m[1] : '', tags };
        }
    },
    {
        name: 'sfx',
        pattern: SUP_SFX_RE,
        classify: (line) => ({ name: 'sfx', raw: line })
    },
    {
        name: 'prev_speaker',
        pattern: SUP_PREV_SPEAKER_RE,
        classify: (line) => ({ name: 'dialogue', raw: line })
    },
    {
        name: 'last_speaker',
        pattern: SUP_LAST_SPEAKER_RE,
        classify: (line) => ({ name: 'dialogue', raw: line })
    },
    {
        name: 'character',
        pattern: SUP_DIALOGUE_RE,
        classify: (line) =>
        {
            const m = line.match(SUP_DIALOGUE_RE);
            const speaker = m ? m[1].trim() : '';
            return { name: 'character', raw: line, speaker };
        }
    },
    {
        name: 'dialogue_continuation',
        pattern: SUP_DIALOGUE_CONT_RE,
        classify: (line) => ({ name: 'dialogue', raw: line })
    },
    {
        name: 'front_matter',
        pattern: SUP_FRONT_MATTER_RE,
        classify: (line) => ({ name: 'front_matter', raw: line })
    },
    {
        name: 'title_heading',
        pattern: SUP_TITLE_RE,
        classify: (line) => ({ name: 'title_heading', raw: line })
    }
];

// Re-export so the action fallback is observable to callers who want a sentinel.
export const ACTION_DEFAULT = ACTION;
