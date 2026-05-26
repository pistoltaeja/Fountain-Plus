/**
 * FDX (Final Draft XML) Parser
 *
 * Reads .fdx files and returns a Screenplay object.
 * Uses DOMParser (native in browsers; caller provides polyfill for Node/Bun).
 *
 * @module core/import/fdx-reader
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
 * @property {string} [meta.parenthetical]
 * @property {boolean} [meta.dualDialogue]
 * @property {number} [sourceLineStart]
 * @property {number} [sourceLineEnd]
 */

/**
 * @typedef {Object} ScreenplayScene
 * @property {string} heading
 * @property {number} sceneNumber
 * @property {string} [sceneLabel]
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
// PARAGRAPH TYPE MAPPING
// =============================================================================

/** @type {Record<string, ScreenplayElementType>} */
const TYPE_MAP =
{
    'Scene Heading': 'scene_heading',
    'Action': 'action',
    'Character': 'character',
    'Dialogue': 'dialogue',
    'Parenthetical': 'parenthetical',
    'Transition': 'transition',
    'Shot': 'action',
    'General': 'action',
    'Cast List': 'action',
    'New Act': 'action',
    'End of Act': 'action',
};

const CHARACTER_EXT_RE = /^(.+?)\s*\(([^)]+)\)\s*$/;
const CREDIT_RE = /^(written by|screenplay by|by)$/i;

/**
 * Fountain-compatible transition pattern: must end in "TO:" or be "FADE OUT."
 * FDX paragraphs typed as Transition that don't match are demoted to action.
 */
const FOUNTAIN_TRANSITION_RE = /\bTO:\s*$|^FADE OUT\.$/i;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Concatenate all <Text> children of a Paragraph into plain text.
 * @param {Element} paragraph
 * @returns {string}
 */
function extractText(paragraph)
{
    const textNodes = paragraph.getElementsByTagName('Text');
    let result = '';
    for (let i = 0; i < textNodes.length; i++)
    {
        result += textNodes[i].textContent || '';
    }
    return result;
}

/**
 * Extract ScriptNote content from a parent element.
 * @param {Element} parent
 * @returns {ScreenplayElement[]}
 */
function extractScriptNotes(parent)
{
    const notes = [];
    const noteEls = parent.getElementsByTagName('ScriptNote');
    for (let i = 0; i < noteEls.length; i++)
    {
        const paragraphs = noteEls[i].getElementsByTagName('Paragraph');
        let text = '';
        for (let j = 0; j < paragraphs.length; j++)
        {
            if (j > 0) text += '\n';
            text += extractText(paragraphs[j]);
        }
        if (text.trim())
        {
            notes.push({ type: 'note', content: text.trim() });
        }
    }
    return notes;
}

// =============================================================================
// TITLE PAGE EXTRACTION
// =============================================================================

/**
 * Parse the TitlePage element into metadata fields.
 * Centered text after title/credit/author that doesn't match known metadata
 * patterns is collected as epigraph (action) content.
 * @param {Element} titlePageEl
 * @returns {{ title: string, author?: string, credit?: string, source?: string, contact?: string, copyright?: string, epigraph: string[] }}
 */
function parseTitlePage(titlePageEl)
{
    const result = { title: '', epigraph: [] };
    const contentEl = titlePageEl.getElementsByTagName('Content')[0];
    if (!contentEl) return result;

    const paragraphs = contentEl.getElementsByTagName('Paragraph');

    const centered = [];
    const left = [];

    for (let i = 0; i < paragraphs.length; i++)
    {
        const p = paragraphs[i];
        const alignment = (p.getAttribute('Alignment') || '').toLowerCase();
        const text = extractText(p).trim();
        if (!text) continue;

        if (alignment === 'center')
        {
            centered.push(text);
        }
        else if (alignment === 'left' || alignment === 'full')
        {
            left.push(text);
        }
    }

    let foundTitle = false;
    let foundCredit = false;
    const SOURCE_RE = /^based on /i;

    for (const text of centered)
    {
        if (!foundTitle)
        {
            result.title = text;
            foundTitle = true;
            continue;
        }

        if (!foundCredit && CREDIT_RE.test(text))
        {
            result.credit = text;
            foundCredit = true;
            continue;
        }

        if (foundCredit && !result.author)
        {
            result.author = text;
            continue;
        }

        if (foundCredit && !result.source && SOURCE_RE.test(text))
        {
            result.source = text;
            continue;
        }

        // Remaining centered text is epigraph / body content
        result.epigraph.push(text);
    }

    if (left.length > 0)
    {
        result.contact = left.join('\n');
    }

    return result;
}

// =============================================================================
// CONTENT PARSING
// =============================================================================

/**
 * Parse a single <Paragraph> into a ScreenplayElement.
 * @param {Element} paragraph
 * @param {boolean} isDualSecond - Whether this is the second character in a DualDialogue
 * @returns {ScreenplayElement}
 */
function parseParagraph(paragraph, isDualSecond)
{
    const fdxType = paragraph.getAttribute('Type') || 'General';
    let type = TYPE_MAP[fdxType] || 'action';
    const content = extractText(paragraph);

    // Demote FDX transitions that aren't Fountain-compatible to action
    if (type === 'transition' && !FOUNTAIN_TRANSITION_RE.test(content.trim()))
    {
        type = 'action';
    }

    /** @type {ScreenplayElement} */
    const element = { type, content };

    // FDX parentheticals include outer parens: "(closer)" — strip them
    // so the Screenplay format matches Fountain's bare "closer".
    // Downstream writers (PDF, FDX, Fountain) re-add the wrapping parens.
    if (type === 'parenthetical')
    {
        const trimmed = content.trim();
        if (trimmed.startsWith('(') && trimmed.endsWith(')'))
        {
            element.content = trimmed.slice(1, -1);
        }
    }

    if (type === 'character')
    {
        let name = content.trim();
        // Find where the first parenthesized extension begins
        const extStart = name.search(/\s*\([^)]+\)\s*$/);
        if (extStart !== -1)
        {
            // Walk back to find the true start of all chained extensions
            let scanPos = extStart;
            while (scanPos > 0)
            {
                const before = name.slice(0, scanPos).trimEnd();
                const prevExt = before.search(/\s*\([^)]+\)$/);
                if (prevExt === -1) break;
                scanPos = prevExt;
            }
            const rawSuffix = name.slice(scanPos);
            name = name.slice(0, scanPos).trim();
            // Extract individual extension texts for meta.modifier
            const modifiers = [];
            const modRe = /\(([^)]+)\)/g;
            let mm;
            while ((mm = modRe.exec(rawSuffix)) !== null)
            {
                modifiers.push(mm[1]);
            }
            element.content = name;
            element.meta = { modifier: modifiers.join(') ('), rawExtension: rawSuffix };
        }
        else
        {
            element.content = name;
        }
        if (isDualSecond)
        {
            element.meta = element.meta || {};
            element.meta.dualDialogue = true;
        }
    }

    return element;
}

/**
 * Parse the <Content> element into an array of ScreenplayElements,
 * handling DualDialogue wrappers and StartsNewPage.
 * @param {Element} contentEl
 * @returns {ScreenplayElement[]}
 */
function parseContent(contentEl)
{
    /** @type {ScreenplayElement[]} */
    const elements = [];
    const children = contentEl.children;

    for (let i = 0; i < children.length; i++)
    {
        const node = children[i];

        if (node.tagName === 'DualDialogue')
        {
            parseDualDialogue(node, elements);
            continue;
        }

        if (node.tagName === 'Paragraph')
        {
            const startsNew = node.getAttribute('StartsNewPage') === 'Yes';
            if (startsNew)
            {
                elements.push({ type: 'page_break', content: '' });
            }

            const el = parseParagraph(node, false);
            elements.push(el);

            const notes = extractScriptNotes(node);
            elements.push(...notes);
            continue;
        }

        if (node.tagName === 'ScriptNote')
        {
            const paragraphs = node.getElementsByTagName('Paragraph');
            let text = '';
            for (let j = 0; j < paragraphs.length; j++)
            {
                if (j > 0) text += '\n';
                text += extractText(paragraphs[j]);
            }
            if (text.trim())
            {
                elements.push({ type: 'note', content: text.trim() });
            }
        }
    }

    return elements;
}

/**
 * Parse a <DualDialogue> block. Mark the second character with dualDialogue flag.
 * @param {Element} dualEl
 * @param {ScreenplayElement[]} elements
 */
function parseDualDialogue(dualEl, elements)
{
    const paragraphs = dualEl.getElementsByTagName('Paragraph');
    let characterCount = 0;

    for (let i = 0; i < paragraphs.length; i++)
    {
        const p = paragraphs[i];
        const fdxType = p.getAttribute('Type') || '';

        if (fdxType === 'Character')
        {
            characterCount++;
        }

        const startsNew = p.getAttribute('StartsNewPage') === 'Yes';
        if (startsNew)
        {
            elements.push({ type: 'page_break', content: '' });
        }

        const isDualSecond = fdxType === 'Character' && characterCount >= 2;
        const el = parseParagraph(p, isDualSecond);
        elements.push(el);
    }
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
 * Parse Final Draft XML into a Screenplay object.
 * Works in browser (DOMParser) and Node/Bun (caller provides polyfill).
 *
 * @param {string} xml - Raw FDX XML string
 * @returns {Screenplay}
 */
export function parseFdx(xml)
{
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    const root = doc.documentElement;
    if (!root || root.tagName !== 'FinalDraft')
    {
        throw new Error('Not a valid FDX file: missing <FinalDraft> root element');
    }

    /** @type {Screenplay} */
    const screenplay = { title: '', scenes: [] };

    // Title page
    /** @type {ScreenplayElement[]} */
    let epigraphElements = [];
    const titlePageEl = root.getElementsByTagName('TitlePage')[0];
    if (titlePageEl)
    {
        const meta = parseTitlePage(titlePageEl);
        screenplay.title = meta.title;
        if (meta.author) screenplay.author = meta.author;
        if (meta.credit) screenplay.credit = meta.credit;
        if (meta.source) screenplay.source = meta.source;
        if (meta.contact) screenplay.contact = meta.contact;
        if (meta.copyright) screenplay.copyright = meta.copyright;

        // Epigraph text from the title page becomes action content
        if (meta.epigraph.length > 0)
        {
            epigraphElements.push({ type: 'action', content: meta.epigraph.join(' ') });
        }
    }

    // Content
    const contentEls = root.children;
    let contentEl = null;
    for (let i = 0; i < contentEls.length; i++)
    {
        if (contentEls[i].tagName === 'Content')
        {
            contentEl = contentEls[i];
            break;
        }
    }

    if (contentEl)
    {
        const elements = [...epigraphElements, ...parseContent(contentEl)];
        screenplay.scenes = groupIntoScenes(elements);

        // Apply sceneLabel from FDX Number attribute
        const paragraphs = contentEl.getElementsByTagName('Paragraph');
        let sceneIdx = 0;
        for (let i = 0; i < paragraphs.length; i++)
        {
            if ((paragraphs[i].getAttribute('Type') || '') === 'Scene Heading')
            {
                sceneIdx++;
                const num = paragraphs[i].getAttribute('Number');
                if (num)
                {
                    const scene = screenplay.scenes.find(s => s.sceneNumber === sceneIdx);
                    if (scene)
                    {
                        scene.sceneLabel = num;
                    }
                }
            }
        }
    }

    return screenplay;
}
