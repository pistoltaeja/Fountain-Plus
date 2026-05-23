/**
 * Fade In (.fadein) Parser
 *
 * Reads .fadein files (ZIP containing OSF document.xml) and returns a Screenplay object.
 *
 * @module core/import/fadein-reader
 */

import JSZip from 'jszip';

/**
 * @typedef {'scene_heading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'page_break' | 'synopsis' | 'section' | 'note'} ScreenplayElementType
 */

/**
 * @typedef {Object} ScreenplayElement
 * @property {ScreenplayElementType} type
 * @property {string} content
 * @property {Object} [meta]
 * @property {string} [meta.modifier]
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
    'Normal Text': 'action',
};

const CHARACTER_EXT_RE = /^(.+?)\s*\(([^)]+)\)\s*$/;
const CREDIT_RE = /^(written by|screenplay by|by)$/i;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Concatenate all <text> children of a <para> into plain text.
 * @param {Element} para
 * @returns {string}
 */
function extractText(para)
{
    const textNodes = para.getElementsByTagName('text');
    let result = '';
    for (let i = 0; i < textNodes.length; i++)
    {
        result += textNodes[i].textContent || '';
    }
    return result;
}

/**
 * Get the basestylename from a <para>'s <style> child.
 * @param {Element} para
 * @returns {string}
 */
function getStyleName(para)
{
    const styleEl = para.getElementsByTagName('style')[0];
    if (!styleEl) return '';
    return styleEl.getAttribute('basestylename') || '';
}

/**
 * Get a named attribute from a <para>'s <style> child.
 * @param {Element} para
 * @param {string} attr
 * @returns {string}
 */
function getStyleAttr(para, attr)
{
    const styleEl = para.getElementsByTagName('style')[0];
    if (!styleEl) return '';
    return styleEl.getAttribute(attr) || '';
}

// =============================================================================
// TITLE PAGE EXTRACTION
// =============================================================================

/**
 * Parse the <titlepage> element into metadata fields.
 * @param {Element} titlePageEl
 * @returns {{ title: string, author?: string, credit?: string, draftDate?: string, contact?: string, copyright?: string }}
 */
function parseTitlePage(titlePageEl)
{
    const result = { title: '' };
    const paragraphs = titlePageEl.getElementsByTagName('para');

    const entries = [];
    for (let i = 0; i < paragraphs.length; i++)
    {
        const p = paragraphs[i];
        const textNodes = p.getElementsByTagName('text');
        for (let j = 0; j < textNodes.length; j++)
        {
            const textEl = textNodes[j];
            const bookmark = textEl.getAttribute('bookmark') || '';
            const text = (textEl.textContent || '').trim();
            if (!text) continue;
            entries.push({ bookmark, text });
        }
    }

    let foundTitle = false;
    let foundCredit = false;

    for (const entry of entries)
    {
        if (entry.bookmark === 'Title')
        {
            result.title = entry.text;
            foundTitle = true;
            continue;
        }
        if (entry.bookmark === 'Author')
        {
            result.author = entry.text;
            continue;
        }
        if (entry.bookmark === 'Copyright')
        {
            result.copyright = entry.text;
            continue;
        }
        if (entry.bookmark === 'Draft')
        {
            result.draftDate = entry.text;
            continue;
        }
        if (entry.bookmark === 'Contact')
        {
            result.contact = entry.text;
            continue;
        }

        if (!foundCredit && CREDIT_RE.test(entry.text))
        {
            result.credit = entry.text;
            foundCredit = true;
            continue;
        }

        if (foundCredit && !result.author && !entry.bookmark)
        {
            result.author = entry.text;
            continue;
        }

        if (!foundTitle && !entry.bookmark)
        {
            result.title = entry.text;
            foundTitle = true;
        }
    }

    return result;
}

// =============================================================================
// CONTENT PARSING
// =============================================================================

/**
 * Parse <paragraphs> into a flat array of ScreenplayElements.
 * @param {Element} paragraphsEl
 * @returns {ScreenplayElement[]}
 */
function parseParagraphs(paragraphsEl)
{
    /** @type {ScreenplayElement[]} */
    const elements = [];
    const paras = paragraphsEl.getElementsByTagName('para');

    let pendingDualDialogue = false;

    for (let i = 0; i < paras.length; i++)
    {
        const para = paras[i];
        const styleName = getStyleName(para);
        const type = TYPE_MAP[styleName] || 'action';
        const content = extractText(para);

        const noteAttr = para.getAttribute('note');
        if (noteAttr)
        {
            elements.push({ type: 'note', content: noteAttr });
        }

        const synopsisAttr = para.getAttribute('synopsis');
        if (synopsisAttr)
        {
            elements.push({ type: 'synopsis', content: synopsisAttr });
        }

        if (getStyleAttr(para, 'startnewpage') === '1')
        {
            elements.push({ type: 'page_break', content: '' });
        }

        /** @type {ScreenplayElement} */
        const element = { type, content };

        if (type === 'character')
        {
            const match = content.match(CHARACTER_EXT_RE);
            if (match)
            {
                element.content = match[1].trim();
                element.meta = { modifier: match[2].trim() };
            }

            if (pendingDualDialogue)
            {
                element.meta = element.meta || {};
                element.meta.dualDialogue = true;
                pendingDualDialogue = false;
            }

            if (getStyleAttr(para, 'dualDialogue') === '1')
            {
                pendingDualDialogue = true;
            }
        }

        if (type === 'scene_heading')
        {
            const sceneNum = para.getAttribute('sceneNumber');
            if (sceneNum)
            {
                element._sceneLabel = sceneNum;
            }
        }

        elements.push(element);
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
            if (el._sceneLabel)
            {
                currentScene.sceneLabel = el._sceneLabel;
            }
            delete el._sceneLabel;
            continue;
        }

        delete el._sceneLabel;
        currentScene.elements.push(el);
    }

    scenes.push(currentScene);
    return scenes;
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Parse a Fade In (.fadein) file into a Screenplay object.
 *
 * @param {ArrayBuffer} zipBuffer - Raw .fadein file contents
 * @returns {Promise<Screenplay>}
 */
export async function parseFadein(zipBuffer)
{
    let zip;
    try
    {
        zip = await JSZip.loadAsync(zipBuffer);
    }
    catch (e)
    {
        throw new Error('Not a valid ZIP file: ' + e.message);
    }

    const docFile = zip.file('document.xml');
    if (!docFile)
    {
        throw new Error('No document.xml found in ZIP');
    }

    const xmlString = await docFile.async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    const root = doc.documentElement;
    if (!root || root.tagName !== 'document')
    {
        throw new Error('Invalid OSF XML: missing <document> root element');
    }

    const paragraphsEl = root.getElementsByTagName('paragraphs')[0];
    if (!paragraphsEl)
    {
        throw new Error('Invalid OSF XML: missing <paragraphs> section');
    }

    /** @type {Screenplay} */
    const screenplay = { title: '', scenes: [] };

    const titlePageEl = root.getElementsByTagName('titlepage')[0];
    if (titlePageEl)
    {
        const meta = parseTitlePage(titlePageEl);
        screenplay.title = meta.title;
        if (meta.author) screenplay.author = meta.author;
        if (meta.credit) screenplay.credit = meta.credit;
        if (meta.draftDate) screenplay.draftDate = meta.draftDate;
        if (meta.contact) screenplay.contact = meta.contact;
        if (meta.copyright) screenplay.copyright = meta.copyright;
    }

    const elements = parseParagraphs(paragraphsEl);
    screenplay.scenes = groupIntoScenes(elements);

    return screenplay;
}
