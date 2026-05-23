/**
 * PDF Screenplay Parser
 *
 * Reads PDF files and heuristically converts them to Screenplay objects.
 * Uses pdf.js for text extraction — the caller provides the getDocument function
 * via dependency injection.
 *
 * @module core/import/pdf-reader
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
 * @property {number} [sourceLineStart]
 * @property {number} [sourceLineEnd]
 */

/**
 * @typedef {Object} ScreenplayScene
 * @property {string} heading
 * @property {number} sceneNumber
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

/**
 * @typedef {Object} PdfLine
 * @property {number} x - Leftmost x-position in PDF points
 * @property {number} y - Y-position (top-to-bottom, after inversion)
 * @property {string} text - Concatenated text content
 * @property {number} pageIndex - 0-based page number
 */

// =============================================================================
// REGEXES
// =============================================================================

const SCENE_HEADING_RE = /^(INT|EXT|EST|INT\.\/EXT\.|INT\/EXT|I\/E)[\.\s\/]/i;
const CHARACTER_CUE_RE = /^[A-Z][A-Z0-9\s'&,\-]+$/;
const CHARACTER_EXT_RE = /^(.+?)\s*\(([^)]+)\)\s*$/;
const TRANSITION_RE = /^[A-Z][A-Z\s]+TO:$/;
const FADE_RE = /^(FADE OUT\.|FADE IN:)$/;
const PAGE_NUMBER_RE = /^\d{1,4}\.?$/;
const CREDIT_RE = /^(written by|screenplay by|by)$/i;

// =============================================================================
// TEXT EXTRACTION
// =============================================================================

/**
 * Extract text lines from a single PDF page.
 * Clusters TextItems by y-position into lines, sorted top-to-bottom.
 *
 * @param {Object} page - pdf.js page proxy
 * @returns {Promise<PdfLine[]>}
 */
async function extractPageLines(page)
{
    const textContent = await page.getTextContent();
    const items = textContent.items;

    if (!items || items.length === 0)
    {
        return [];
    }

    const Y_CLUSTER_THRESHOLD = 2;

    /** @type {Map<number, { x: number, texts: string[] }>} */
    const clusters = new Map();

    for (const item of items)
    {
        if (!item.str || item.str.trim() === '') continue;

        const x = item.transform[4];
        const y = item.transform[5];

        let matchedY = null;
        for (const existingY of clusters.keys())
        {
            if (Math.abs(existingY - y) <= Y_CLUSTER_THRESHOLD)
            {
                matchedY = existingY;
                break;
            }
        }

        if (matchedY !== null)
        {
            const cluster = clusters.get(matchedY);
            cluster.x = Math.min(cluster.x, x);
            cluster.texts.push(item.str);
        }
        else
        {
            clusters.set(y, { x, texts: [item.str] });
        }
    }

    const lines = [];
    for (const [y, cluster] of clusters)
    {
        const text = cluster.texts.join('').trim();
        if (text)
        {
            lines.push({ x: cluster.x, y, text });
        }
    }

    lines.sort((a, b) => b.y - a.y);

    return lines;
}

/**
 * Extract all lines from all pages of a PDF document.
 *
 * @param {Object} pdfDoc - pdf.js document proxy
 * @returns {Promise<{ lines: PdfLine[], pageCount: number }>}
 */
async function extractAllLines(pdfDoc)
{
    const pageCount = pdfDoc.numPages;
    /** @type {PdfLine[]} */
    const allLines = [];

    for (let i = 1; i <= pageCount; i++)
    {
        const page = await pdfDoc.getPage(i);
        const pageLines = await extractPageLines(page);

        for (const line of pageLines)
        {
            line.pageIndex = i - 1;
            allLines.push(line);
        }
    }

    return { lines: allLines, pageCount };
}

// =============================================================================
// X-POSITION HISTOGRAM & MARGIN DETECTION
// =============================================================================

/**
 * @typedef {Object} MarginProfile
 * @property {number} leftMargin - Most common x (action/scene headings)
 * @property {number} dialogueX - Dialogue x cluster
 * @property {number} characterX - Character cue x cluster
 * @property {number} parentheticalX - Parenthetical x cluster
 * @property {number} transitionX - Transition x cluster (rightmost)
 */

/**
 * Build a histogram of x-positions and identify margin clusters.
 * Buckets are 5pt wide.
 *
 * @param {PdfLine[]} lines
 * @returns {MarginProfile}
 */
function buildMarginProfile(lines)
{
    const BUCKET_WIDTH = 5;

    /** @type {Map<number, number>} */
    const histogram = new Map();

    for (const line of lines)
    {
        if (PAGE_NUMBER_RE.test(line.text)) continue;

        const bucket = Math.round(line.x / BUCKET_WIDTH) * BUCKET_WIDTH;
        histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
    }

    const sorted = [...histogram.entries()].sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0)
    {
        return {
            leftMargin: 100,
            dialogueX: 170,
            parentheticalX: 210,
            characterX: 260,
            transitionX: 380,
        };
    }

    const leftMargin = sorted[0][0];

    const xValues = sorted.map(e => e[0]).filter(x => x > leftMargin + 15).sort((a, b) => a - b);

    let dialogueX = leftMargin + 70;
    let parentheticalX = leftMargin + 110;
    let characterX = leftMargin + 160;
    let transitionX = leftMargin + 280;

    if (xValues.length >= 3)
    {
        dialogueX = xValues[0];
        parentheticalX = xValues.length >= 4 ? xValues[1] : dialogueX - 20;
        characterX = xValues[xValues.length - 1];
        transitionX = characterX + 50;
    }
    else if (xValues.length === 2)
    {
        dialogueX = xValues[0];
        characterX = xValues[1];
        parentheticalX = dialogueX - 20;
        transitionX = characterX + 50;
    }
    else if (xValues.length === 1)
    {
        dialogueX = xValues[0];
        characterX = dialogueX + 80;
        parentheticalX = dialogueX - 20;
        transitionX = characterX + 50;
    }

    return { leftMargin, dialogueX, parentheticalX, characterX, transitionX };
}

// =============================================================================
// LINE CLASSIFICATION
// =============================================================================

/**
 * Classify a single PDF line into a screenplay element type.
 *
 * @param {PdfLine} line
 * @param {MarginProfile} profile
 * @param {PdfLine|null} prevLine
 * @param {PdfLine|null} nextLine
 * @returns {{ type: ScreenplayElementType, content: string, meta?: Object } | null}
 */
function classifyLine(line, profile, prevLine, nextLine)
{
    const text = line.text.trim();

    if (!text) return null;
    if (PAGE_NUMBER_RE.test(text)) return null;

    const xDelta = line.x - profile.leftMargin;

    if (SCENE_HEADING_RE.test(text) && Math.abs(xDelta) < 30)
    {
        return { type: 'scene_heading', content: text };
    }

    if (TRANSITION_RE.test(text) || FADE_RE.test(text))
    {
        return { type: 'transition', content: text };
    }

    const charThreshold = (profile.characterX - profile.dialogueX) / 2 + profile.dialogueX;
    const dialogueThreshold = (profile.dialogueX - profile.leftMargin) / 2 + profile.leftMargin;
    const parenThreshold = dialogueThreshold - 10;

    if (xDelta > charThreshold - profile.leftMargin)
    {
        const withoutExt = text.replace(/\s*\([^)]+\)\s*$/, '');
        if (CHARACTER_CUE_RE.test(withoutExt) && text.length < 50)
        {
            const match = text.match(CHARACTER_EXT_RE);
            if (match)
            {
                return {
                    type: 'character',
                    content: match[1].trim(),
                    meta: { modifier: match[2].trim() },
                };
            }
            return { type: 'character', content: text };
        }
    }

    if (/^\(.+\)$/.test(text) && xDelta > parenThreshold - profile.leftMargin)
    {
        return { type: 'parenthetical', content: text };
    }

    if (xDelta > dialogueThreshold - profile.leftMargin && xDelta < charThreshold - profile.leftMargin)
    {
        if (prevLine)
        {
            const prevType = classifyLineType(prevLine, profile);
            if (prevType === 'character' || prevType === 'parenthetical' || prevType === 'dialogue')
            {
                return { type: 'dialogue', content: text };
            }
        }
    }

    if (Math.abs(xDelta) < 30)
    {
        return { type: 'action', content: text };
    }

    if (xDelta > dialogueThreshold - profile.leftMargin)
    {
        return { type: 'dialogue', content: text };
    }

    return { type: 'action', content: text };
}

/**
 * Quick type-only classification for lookahead/lookbehind.
 *
 * @param {PdfLine} line
 * @param {MarginProfile} profile
 * @returns {ScreenplayElementType}
 */
function classifyLineType(line, profile)
{
    const text = line.text.trim();
    if (PAGE_NUMBER_RE.test(text)) return 'action';

    const xDelta = line.x - profile.leftMargin;
    const charThreshold = (profile.characterX - profile.dialogueX) / 2 + profile.dialogueX;
    const dialogueThreshold = (profile.dialogueX - profile.leftMargin) / 2 + profile.leftMargin;

    if (SCENE_HEADING_RE.test(text) && Math.abs(xDelta) < 30) return 'scene_heading';
    if (TRANSITION_RE.test(text) || FADE_RE.test(text)) return 'transition';

    if (xDelta > charThreshold - profile.leftMargin)
    {
        const withoutExt = text.replace(/\s*\([^)]+\)\s*$/, '');
        if (CHARACTER_CUE_RE.test(withoutExt) && text.length < 50) return 'character';
    }

    if (/^\(.+\)$/.test(text)) return 'parenthetical';
    if (xDelta > dialogueThreshold - profile.leftMargin && xDelta < charThreshold - profile.leftMargin) return 'dialogue';

    return 'action';
}

// =============================================================================
// TITLE PAGE DETECTION
// =============================================================================

/**
 * Attempt to extract title and author from the first PDF page.
 * Heuristic: if the first page has very few lines and centered text,
 * it's likely a title page.
 *
 * @param {PdfLine[]} firstPageLines
 * @param {MarginProfile} profile
 * @returns {{ title: string, author?: string, credit?: string, isTitlePage: boolean }}
 */
function extractTitlePage(firstPageLines, profile)
{
    const result = { title: '', isTitlePage: false };

    if (firstPageLines.length > 15 || firstPageLines.length < 2)
    {
        return result;
    }

    const hasSceneHeading = firstPageLines.some(l => SCENE_HEADING_RE.test(l.text.trim()));
    if (hasSceneHeading)
    {
        return result;
    }

    const pageWidth = 612;
    const centerX = pageWidth / 2;
    const centeredLines = firstPageLines.filter(l =>
    {
        return Math.abs(l.x - centerX) < 100 && l.x > profile.leftMargin + 30;
    });

    if (centeredLines.length < 2)
    {
        return result;
    }

    result.isTitlePage = true;

    let foundTitle = false;
    let foundCredit = false;

    for (const line of centeredLines)
    {
        const text = line.text.trim();
        if (!text) continue;

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
        }
    }

    return result;
}

// =============================================================================
// SCENE GROUPING
// =============================================================================

/**
 * Group flat elements into scenes by scene_heading boundaries.
 *
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
 * Parse a PDF file into a Screenplay object.
 * Requires pdf.js — the caller provides the getDocument function.
 *
 * @param {ArrayBuffer} pdfBuffer - Raw PDF file contents
 * @param {Function} getDocument - pdf.js getDocument function
 * @returns {Promise<Screenplay>}
 */
export async function parsePdf(pdfBuffer, getDocument)
{
    let pdfDoc;
    try
    {
        const loadingTask = getDocument({ data: pdfBuffer });
        pdfDoc = await loadingTask.promise;
    }
    catch (e)
    {
        throw new Error('Failed to parse PDF: ' + e.message);
    }

    const { lines, pageCount } = await extractAllLines(pdfDoc);

    if (lines.length < 10)
    {
        throw new Error(
            'PDF appears to be scanned/image-based. Text-based PDF required.'
        );
    }

    /** @type {Screenplay} */
    const screenplay = { title: '', scenes: [] };

    const profile = buildMarginProfile(lines);

    const firstPageLines = lines.filter(l => l.pageIndex === 0);
    const titleInfo = extractTitlePage(firstPageLines, profile);

    if (titleInfo.isTitlePage)
    {
        screenplay.title = titleInfo.title;
        if (titleInfo.author) screenplay.author = titleInfo.author;
        if (titleInfo.credit) screenplay.credit = titleInfo.credit;
    }

    /** @type {ScreenplayElement[]} */
    const elements = [];
    let lineNum = 0;
    let prevPageIndex = titleInfo.isTitlePage ? 0 : -1;

    const contentLines = titleInfo.isTitlePage
        ? lines.filter(l => l.pageIndex > 0)
        : lines;

    for (let i = 0; i < contentLines.length; i++)
    {
        const line = contentLines[i];
        lineNum++;

        if (line.pageIndex !== prevPageIndex && prevPageIndex >= (titleInfo.isTitlePage ? 0 : -1))
        {
            if (elements.length > 0)
            {
                elements.push({ type: 'page_break', content: '' });
            }
        }
        prevPageIndex = line.pageIndex;

        const prev = i > 0 ? contentLines[i - 1] : null;
        const next = i < contentLines.length - 1 ? contentLines[i + 1] : null;

        const classified = classifyLine(line, profile, prev, next);
        if (!classified) continue;

        /** @type {ScreenplayElement} */
        const element = {
            type: classified.type,
            content: classified.content,
            sourceLineStart: lineNum,
            sourceLineEnd: lineNum,
        };

        if (classified.meta)
        {
            element.meta = classified.meta;
        }

        elements.push(element);
    }

    screenplay.scenes = groupIntoScenes(elements);

    return screenplay;
}
