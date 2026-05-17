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
    sceneHeading: /^(INT|EXT)\.\s*(.+)$/,
    forcedSceneHeading: /^\..+$/,

    // Character: ALL CAPS preceded by blank line, possibly with modifier and/or dual dialogue ^
    character: /^([A-Z][A-Z\s'&,]+?)(?:\s+\^)?(?:\s+\((V\.O\.|O\.S\.)\))?$/,

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
    const lines = text.split('\n');
    let cursor = 0;

    // Parse title page
    const titlePage = {};
    while (cursor < lines.length)
    {
        const line = lines[cursor];

        // Empty line ends title page section
        if (line.trim() === '')
        {
            cursor++;
            break;
        }

        const keyMatch = line.match(PATTERNS.titlePageKey);
        if (keyMatch)
        {
            titlePage[keyMatch[1].trim().toLowerCase()] = keyMatch[2].trim();
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

            sceneNumber++;
            const heading = trimmed;
            currentScene = {
                heading,
                sceneNumber,
                elements: [],
                pageId: undefined
            };

            // Apply pending src to scene (as a tracking reference)
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

            sceneNumber++;
            currentScene = {
                heading: trimmed.substring(1), // Remove leading .
                sceneNumber,
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

        // Check for synopsis = text
        if (trimmed.startsWith('= '))
        {
            // Non-printing, skip
            cursor++;
            continue;
        }

        // Check for page break ===
        if (/^={3,}$/.test(trimmed))
        {
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

            if (charMatch[2])
            {
                charElement.meta = { modifier: charMatch[2] };
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

                // Empty line ends dialogue block
                if (nextTrimmed === '')
                {
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

                // Dialogue text
                currentScene.elements.push({
                    type: /** @type {ScreenplayElementType} */ ('dialogue'),
                    content: nextTrimmed
                });
                cursor++;
            }

            continue;
        }

        // Default: action
        ensureScene();
        currentScene.elements.push({
            type: /** @type {ScreenplayElementType} */ ('action'),
            content: trimmed
        });
        cursor++;
    }

    // Push final scene
    if (currentScene)
    {
        scenes.push(currentScene);
    }

    return {
        title: titlePage.title || 'Untitled',
        author: titlePage.author,
        scenes
    };

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
