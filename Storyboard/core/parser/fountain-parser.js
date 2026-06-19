/**
 * Mangaplay Fountain Parser
 * Parses Fountain text into Screenplay objects
 *
 * Supports standard Fountain elements plus Mangaplay extensions:
 * - [[TITLE_CARD: ...]] notes for character introduction cards
 * - [[SFX: ...]] notes for sound effects
 * - [[_src:start-end]] notes for source line mapping
 *
 * Output matches the Screenplay/ScreenplayScene/ScreenplayElement types
 * from screenplay-parser.js exactly.
 *
 * @module core/parser/fountain-parser
 */

/** @typedef {import('./screenplay-parser.js').Screenplay} Screenplay */
/** @typedef {import('./screenplay-parser.js').ScreenplayScene} ScreenplayScene */
/** @typedef {import('./screenplay-parser.js').ScreenplayElement} ScreenplayElement */
/** @typedef {import('./screenplay-parser.js').ScreenplayElementType} ScreenplayElementType */
/** @typedef {import('./screenplay-parser.js').TitleCardElement} TitleCardElement */

import { parseTitleCard } from './screenplay-parser.js';

// =============================================================================
// PATTERNS
// =============================================================================

const PATTERNS = {
    // Title page key-value
    titlePageKey: /^([A-Za-z ]+):\s*(.*)$/,

    // Scene headings: INT. or EXT. (or forced with leading .)
    sceneHeading: /^(INT|EXT|EST|INT\.\/EXT\.|INT\/EXT|EXT\.\/INT\.|EXT\/INT|I\/E|E\/I)\.?\s+(.+)$/i,
    nonStandardHeading: /^(FLASHBACK|FLASH BACK|MONTAGE|INTERCUT|BACK TO SCENE|DREAM SEQUENCE|FANTASY SEQUENCE|TIME CUT|SERIES OF SHOTS)\.?\s*(.*)$/i,
    forcedSceneHeading: /^\.[^.].+$/,

    // Character: ALL CAPS preceded by blank line, possibly with modifier and/or dual dialogue ^
    character: /^([A-Z][A-Z0-9\s'&,.\-]+?)(?:\s+((?:\([A-Z][A-Z0-9.,\s']+\)\s*)+))?(\s+\^)?$/,

    // Parenthetical
    parenthetical: /^\((.+)\)$/,

    // Transition: ends with TO: or forced with >
    transition: /^.+TO:$/,
    forcedTransition: /^>.+$/,

    // Mangaplay extension notes
    titleCardNote: /^\[\[TITLE_CARD:\s*(.+)\]\]$/,
    sfxNote: /^\[\[SFX(?:\s*:)?\s+(.+)\]\]$/,
    srcNote: /^\[\[_src:(\d+)-(\d+)\]\]$/,
};

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Parse Fountain text into a Screenplay object.
 *
 * @param {string} text - Fountain-formatted text
 * @returns {Screenplay}
 */
export function parseFountain(text)
{
    text = text.replace(/[‘’]/g, "'");
    text = text.replace(/[“”]/g, '"');
    const rawLines = text.split('\n');

    // Pre-process: strip boneyard comments /* ... */ (can span multiple lines)
    let inBoneyard = false;
    const cleanedLines = [];
    for (const rawLine of rawLines)
    {
        let line = rawLine;
        if (inBoneyard)
        {
            const endIdx = line.indexOf('*/');
            if (endIdx !== -1)
            {
                line = line.substring(endIdx + 2);
                inBoneyard = false;
            }
            else
            {
                cleanedLines.push('');
                continue;
            }
        }
        // Strip inline boneyards
        while (!inBoneyard)
        {
            const startIdx = line.indexOf('/*');
            if (startIdx === -1) break;
            const endIdx = line.indexOf('*/', startIdx + 2);
            if (endIdx !== -1)
            {
                line = line.substring(0, startIdx) + line.substring(endIdx + 2);
            }
            else
            {
                line = line.substring(0, startIdx);
                inBoneyard = true;
            }
        }
        cleanedLines.push(line);
    }
    const lines = cleanedLines;

    let cursor = 0;

    // Parse title page
    const titlePage = {};
    let lastTitleKey = null;
    while (cursor < lines.length)
    {
        const line = lines[cursor];

        // Empty line ends title page section
        if (line.trim() === '')
        {
            cursor++;
            break;
        }

        // Continuation line: tab or 3+ spaces
        if (lastTitleKey && /^(\t|   )/.test(line))
        {
            const prev = titlePage[lastTitleKey] || '';
            const continuation = line.trim();
            titlePage[lastTitleKey] = prev ? prev + '\n' + continuation : continuation;
            cursor++;
            continue;
        }

        const keyMatch = line.match(PATTERNS.titlePageKey);
        if (keyMatch)
        {
            lastTitleKey = keyMatch[1].trim().toLowerCase();
            titlePage[lastTitleKey] = keyMatch[2].trim();
            cursor++;
        }
        else
        {
            // Not a title page line, stop
            break;
        }
    }

    // Parse body elements
    /** @type {ScreenplayScene[]} */
    const scenes = [];
    /** @type {ScreenplayScene | null} */
    let currentScene = null;
    let sceneNumber = 0;

    // Pending source annotation to attach to previous element
    /** @type {{ start: number, end: number } | null} */
    let pendingSrc = null;

    while (cursor < lines.length)
    {
        const line = lines[cursor];
        const trimmed = line.trim();

        // Skip empty lines
        if (trimmed === '')
        {
            cursor++;
            continue;
        }

        // Check for source annotation
        const srcMatch = trimmed.match(PATTERNS.srcNote);
        if (srcMatch)
        {
            const start = parseInt(srcMatch[1], 10);
            const end = parseInt(srcMatch[2], 10);

            // Apply to last element in current scene
            if (currentScene && currentScene.elements.length > 0)
            {
                const lastEl = currentScene.elements[currentScene.elements.length - 1];
                if (lastEl.sourceLineStart === undefined)
                {
                    lastEl.sourceLineStart = start;
                    lastEl.sourceLineEnd = end;
                }
            }
            else
            {
                pendingSrc = { start, end };
            }
            cursor++;
            continue;
        }

        // Standalone script note [[...]]
        if (/^\[\[(.+)\]\]$/.test(trimmed) && !PATTERNS.titleCardNote.test(trimmed) && !PATTERNS.sfxNote.test(trimmed))
        {
            ensureScene();
            const noteContent = trimmed.match(/^\[\[(.+)\]\]$/)[1];
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('note'),
                content: noteContent
            });
            cursor++;
            continue;
        }

        // Check for TITLE_CARD note
        const titleCardMatch = trimmed.match(PATTERNS.titleCardNote);
        if (titleCardMatch)
        {
            ensureScene();
            const tc = parseTitleCard(titleCardMatch[1]);
            if (tc)
            {
                currentScene.elements.push(tc);
            }
            else
            {
                // Fallback: simple title card with content as-is
                currentScene.elements.push({
                    type: /** @type {ScreenplayElementType} */ ('title_card'),
                    content: titleCardMatch[1],
                    meta: {}
                });
            }
            cursor++;
            continue;
        }

        // Check for SFX note
        const sfxMatch = trimmed.match(PATTERNS.sfxNote);
        if (sfxMatch)
        {
            ensureScene();
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('sfx'),
                content: sfxMatch[1]
            });
            cursor++;
            continue;
        }

        // Check for scene heading
        const sceneMatch = trimmed.match(PATTERNS.sceneHeading);
        if (sceneMatch)
        {
            // Push previous scene
            if (currentScene)
            {
                scenes.push(currentScene);
            }

            let heading = trimmed;
            let sceneLabel = undefined;
            // Extract Fountain scene number markers: #1A#, #42#, etc.
            const sceneNumMatch = heading.match(/\s*#([^#]+)#\s*$/);
            if (sceneNumMatch)
            {
                heading = heading.substring(0, heading.length - sceneNumMatch[0].length);
                sceneLabel = sceneNumMatch[1].trim();
            }

            sceneNumber++;
            currentScene = {
                heading,
                sceneNumber,
                sceneLabel,
                elements: [],
                pageId: undefined
            };

            // Apply pending src to scene (as a tracking reference)
            pendingSrc = null;
            cursor++;
            continue;
        }

        // Check for non-standard scene heading (FLASHBACK, MONTAGE, etc.)
        // Skip if the line ends with ":" — those are transitions/directives
        // (e.g. "FLASHBACK TO:", "INTERCUT WITH:"), not scene headings.
        const nonStdMatch = trimmed.match(PATTERNS.nonStandardHeading);
        if (nonStdMatch && !trimmed.endsWith(':'))
        {
            if (currentScene)
            {
                scenes.push(currentScene);
            }

            let heading = trimmed;
            let sceneLabel = undefined;
            const sceneNumMatch = heading.match(/\s*#([^#]+)#\s*$/);
            if (sceneNumMatch)
            {
                heading = heading.substring(0, heading.length - sceneNumMatch[0].length);
                sceneLabel = sceneNumMatch[1].trim();
            }

            sceneNumber++;
            currentScene = {
                heading,
                sceneNumber,
                sceneLabel,
                elements: [],
                pageId: undefined
            };

            pendingSrc = null;
            cursor++;
            continue;
        }

        // Check for forced scene heading
        if (PATTERNS.forcedSceneHeading.test(trimmed))
        {
            if (currentScene)
            {
                scenes.push(currentScene);
            }

            let heading = trimmed.substring(1); // Remove leading .
            let sceneLabel = undefined;
            const sceneNumMatch = heading.match(/\s*#([^#]+)#\s*$/);
            if (sceneNumMatch)
            {
                heading = heading.substring(0, heading.length - sceneNumMatch[0].length);
                sceneLabel = sceneNumMatch[1].trim();
            }

            sceneNumber++;
            currentScene = {
                heading,
                sceneNumber,
                sceneLabel,
                elements: [],
                pageId: undefined
            };
            cursor++;
            continue;
        }

        // Check for centered text >TEXT<
        const centeredMatch = trimmed.match(/^>(.+)<$/);
        if (centeredMatch)
        {
            ensureScene();
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('action'),
                content: centeredMatch[1],
                meta: { centered: true }
            });
            cursor++;
            continue;
        }

        // Check for lyrics ~text
        if (trimmed.startsWith('~'))
        {
            ensureScene();
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('action'),
                content: trimmed.substring(1),
                meta: { lyrics: true }
            });
            cursor++;
            continue;
        }

        // Check for forced action !
        if (trimmed.startsWith('!'))
        {
            ensureScene();
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('action'),
                content: trimmed.substring(1)
            });
            cursor++;
            continue;
        }

        // Check for forced character @
        if (trimmed.startsWith('@'))
        {
            ensureScene();
            const forcedCharContent = trimmed.substring(1);
            const charElement = {
                type: /** @type {ScreenplayElementType} */ ('character'),
                content: forcedCharContent,
                meta: {}
            };
            currentScene.elements.push(charElement);
            cursor++;

            // Collect parenthetical and dialogue (same as normal character block)
            while (cursor < lines.length)
            {
                const nextTrimmed = lines[cursor].trim();

                // Empty line ends dialogue block (Fountain: two-space line continues dialogue)
                if (nextTrimmed === '')
                {
                    const rawNextLine = lines[cursor];
                    if (rawNextLine === '  ')
                    {
                        // Two-space empty line: add blank line within dialogue
                        currentScene.elements.push({
                            type: /** @type {ScreenplayElementType} */ ('dialogue'),
                            content: ''
                        });
                        cursor++;
                        continue;
                    }
                    break;
                }

                const nextSrc = nextTrimmed.match(PATTERNS.srcNote);
                if (nextSrc)
                {
                    if (currentScene.elements.length > 0)
                    {
                        const lastEl = currentScene.elements[currentScene.elements.length - 1];
                        if (lastEl.sourceLineStart === undefined)
                        {
                            lastEl.sourceLineStart = parseInt(nextSrc[1], 10);
                            lastEl.sourceLineEnd = parseInt(nextSrc[2], 10);
                        }
                    }
                    cursor++;
                    continue;
                }

                const parenMatch = nextTrimmed.match(PATTERNS.parenthetical);
                if (parenMatch)
                {
                    currentScene.elements.push({
                        type: /** @type {ScreenplayElementType} */ ('parenthetical'),
                        content: parenMatch[1]
                    });
                    cursor++;
                    continue;
                }

                const titleCardInDialogue = nextTrimmed.match(PATTERNS.titleCardNote);
                const sfxInDialogue = nextTrimmed.match(PATTERNS.sfxNote);
                if (titleCardInDialogue || sfxInDialogue) break;

                // Preserve inline whitespace (e.g. spaces around emphasis markers)
                const rawForcedDialogue = lines[cursor].replace(/\[\[.*?\]\]/g, '');
                if (!rawForcedDialogue.trim()) { cursor++; continue; }
                currentScene.elements.push({
                    type: /** @type {ScreenplayElementType} */ ('dialogue'),
                    content: rawForcedDialogue
                });
                cursor++;
            }
            continue;
        }

        // Section headers (## and deeper)
        const sectionMatch = trimmed.match(/^(#{2,6})\s+(.+)$/);
        if (sectionMatch)
        {
            ensureScene();
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('section'),
                content: sectionMatch[2],
                meta: { depth: sectionMatch[1].length }
            });
            cursor++;
            continue;
        }

        // Synopsis = text
        if (trimmed.startsWith('= '))
        {
            ensureScene();
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('synopsis'),
                content: trimmed.substring(2)
            });
            cursor++;
            continue;
        }

        // Check for page break ===
        if (/^={3,}$/.test(trimmed))
        {
            ensureScene();
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('page_break'),
                content: ''
            });
            cursor++;
            continue;
        }

        // Check for transition
        if (PATTERNS.transition.test(trimmed) || PATTERNS.forcedTransition.test(trimmed))
        {
            ensureScene();
            const content = PATTERNS.forcedTransition.test(trimmed)
                ? trimmed.substring(1).trim()
                : trimmed;
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('transition'),
                content
            });
            cursor++;
            continue;
        }

        // Check for character (ALL CAPS, preceded by blank line)
        const prevLine = cursor > 0 ? lines[cursor - 1].trim() : '';
        const charMatch = trimmed.match(PATTERNS.character);

        if (charMatch && prevLine === '')
        {
            ensureScene();

            /** @type {ScreenplayElement} */
            const charElement = {
                type: /** @type {ScreenplayElementType} */ ('character'),
                content: charMatch[1].trim(),
                meta: {}
            };

            if (charMatch[3])
            {
                charElement.meta.dualDialogue = true;
            }

            if (charMatch[2])
            {
                const exts = charMatch[2].match(/\([A-Z][A-Z0-9.,\s'']+\)/g);
                if (exts)
                {
                    charElement.meta.modifier = exts.map(e => e.slice(1, -1).trim()).join(') (');
                }
            }

            currentScene.elements.push(charElement);
            cursor++;

            // Look ahead for _src annotation on character
            if (cursor < lines.length && PATTERNS.srcNote.test(lines[cursor].trim()))
            {
                const srcM = lines[cursor].trim().match(PATTERNS.srcNote);
                if (srcM)
                {
                    charElement.sourceLineStart = parseInt(srcM[1], 10);
                    charElement.sourceLineEnd = parseInt(srcM[2], 10);
                    cursor++;
                }
            }

            // Collect parenthetical and dialogue
            while (cursor < lines.length)
            {
                const nextTrimmed = lines[cursor].trim();

                // Empty line ends dialogue block (Fountain: two-space line continues dialogue)
                if (nextTrimmed === '')
                {
                    const rawNextLine = lines[cursor];
                    if (rawNextLine === '  ')
                    {
                        // Two-space empty line: add blank line within dialogue
                        currentScene.elements.push({
                            type: /** @type {ScreenplayElementType} */ ('dialogue'),
                            content: ''
                        });
                        cursor++;
                        continue;
                    }
                    break;
                }

                // Source annotation
                const nextSrc = nextTrimmed.match(PATTERNS.srcNote);
                if (nextSrc)
                {
                    // Apply to last element
                    if (currentScene.elements.length > 0)
                    {
                        const lastEl = currentScene.elements[currentScene.elements.length - 1];
                        if (lastEl.sourceLineStart === undefined)
                        {
                            lastEl.sourceLineStart = parseInt(nextSrc[1], 10);
                            lastEl.sourceLineEnd = parseInt(nextSrc[2], 10);
                        }
                    }
                    cursor++;
                    continue;
                }

                // Parenthetical
                const parenMatch = nextTrimmed.match(PATTERNS.parenthetical);
                if (parenMatch)
                {
                    currentScene.elements.push({
                        type: /** @type {ScreenplayElementType} */ ('parenthetical'),
                        content: parenMatch[1]
                    });
                    cursor++;
                    continue;
                }

                // Must be dialogue text (or a note)
                const titleCardInDialogue = nextTrimmed.match(PATTERNS.titleCardNote);
                const sfxInDialogue = nextTrimmed.match(PATTERNS.sfxNote);

                if (titleCardInDialogue || sfxInDialogue)
                {
                    break; // Not dialogue, let outer loop handle
                }

                // Dialogue text — preserve inline whitespace (e.g. spaces around emphasis markers)
                const rawDialogueLine = lines[cursor].replace(/\[\[.*?\]\]/g, '');
                if (rawDialogueLine.trim())
                {
                    currentScene.elements.push({
                        type: /** @type {ScreenplayElementType} */ ('dialogue'),
                        content: rawDialogueLine
                    });
                }
                cursor++;
            }

            continue;
        }

        // Default: action — preserve inline whitespace (e.g. spaces around emphasis markers)
        ensureScene();
        const rawActionLine = line.replace(/\[\[.*?\]\]/g, '');
        if (rawActionLine.trim())
        {
            currentScene.elements.push({
                type: /** @type {ScreenplayElementType} */ ('action'),
                content: rawActionLine
            });
        }
        cursor++;
    }

    // Push final scene
    if (currentScene)
    {
        scenes.push(currentScene);
    }

    /** @type {Screenplay} */
    const result = {
        title: titlePage.title || '',
        author: titlePage.author || titlePage.writer || titlePage.by,
        credit: titlePage.credit,
        source: titlePage.source,
        draftDate: titlePage['draft date'],
        contact: titlePage.contact,
        copyright: titlePage.copyright,
        notes: titlePage.notes,
        scenes
    };

    // Optional Characters / Vocabulary title-page keys → string[].
    // Split rule: comma OR newline. Trim each entry. Filter empties.
    // Leave properties undefined when absent so the field stays optional.
    if (titlePage.characters)
    {
        const parts = titlePage.characters.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) result.characters = parts;
    }
    if (titlePage.vocabulary)
    {
        const parts = titlePage.vocabulary.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) result.vocabulary = parts;
    }

    return result;

    /**
     * Ensure currentScene exists. If not, create one without heading.
     */
    function ensureScene()
    {
        if (!currentScene)
        {
            sceneNumber++;
            currentScene = {
                heading: '',
                sceneNumber,
                elements: [],
                pageId: undefined
            };
        }
    }
}
