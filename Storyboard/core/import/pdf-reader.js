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
// CONSTANTS
// =============================================================================

const DUAL_DIALOGUE_GAP_PT = 25;

// =============================================================================
// REGEXES
// =============================================================================

// Optional leading scene-number token (e.g. "1 ", "A23 ", "7A ", "A23A ").
// Numbers may carry alpha prefix or suffix (production-draft style).
const SCENE_NUMBER_PREFIX_RE = /^([A-Z]?\d+[A-Z]?|[A-Z]\d*)\s+/;
const SCENE_HEADING_RE = /^(?:[A-Z]?\d+[A-Z]?\s+|[A-Z]\s+)?(INT|EXT|EST|INT\.\/EXT\.|INT\/EXT|I\/E)[\.\s\/]/i;

// TV-script structural markers. Centered, all-caps, optionally
// trailing period. Treated as scene-heading boundaries so that
// `groupIntoScenes` opens a new scene container on each act break.
const TV_ACT_MARKER_RE = /^(?:TEASER|COLD\s+OPEN|ACT\s+[A-Z]+|END\s+OF\s+ACT(?:\s+[A-Z]+)?|END\s+ACT(?:\s+[A-Z]+)?|TAG|END\s+OF\s+SHOW)\.?$/;

const CHARACTER_CUE_RE = /^[A-Z][A-Z0-9\s'&,.\-\/‘’]+$/;
const CHARACTER_EXT_RE = /^([A-Z][A-Z0-9\s'&,\-‘’]+?)\s*((?:\([^)]+\)\s*)+)$/;
const TRANSITION_RE = /^[A-Z][A-Z\s]+TO:$/;
const FADE_RE = /^(FADE OUT\.|FADE IN:|CUT TO BLACK\.)$/;
const PAGE_NUMBER_RE = /^\d{1,4}\.?$/;
const CONTINUED_HINT_RE = /^\(CONTINUED\)$/;
const MORE_HINT_RE = /^\(MORE\)$/;
const SCENE_CONTINUATION_RE = /^\d+[A-Z]?\s+CONTINUED(?:\s*:\s*\(\d+\))?\s*:?$/;
const SHOT_DIRECTION_RE = /^\d+[A-Z]?\s+[A-Z]/;
const CREDIT_RE = /^(written by|screenplay by|by)$/i;

/**
 * Strip Fountain emphasis markers (bold, italic, underline) from text.
 * Used for element types where emphasis is structural, not inline.
 *
 * @param {string} text
 * @returns {string}
 */
function stripEmphasis(text)
{
    let s = text.trim();
    let changed = true;
    while (changed)
    {
        changed = false;
        if (s.startsWith('***') && s.endsWith('***'))
        {
            s = s.slice(3, -3).trim();
            changed = true;
        }
        else if (s.startsWith('**') && s.endsWith('**'))
        {
            s = s.slice(2, -2).trim();
            changed = true;
        }
        else if (s.startsWith('*') && s.endsWith('*'))
        {
            s = s.slice(1, -1).trim();
            changed = true;
        }
        if (s.startsWith('_') && s.endsWith('_'))
        {
            s = s.slice(1, -1).trim();
            changed = true;
        }
    }
    return s;
}

/**
 * Strip leading/trailing scene-number tokens (e.g. "1 ", "A23 ", " 7A") from a
 * scene-heading line. Returns the cleaned slug. The numeric token is dropped
 * because `groupIntoScenes` assigns its own sequential `sceneNumber`.
 *
 * @param {string} text
 * @returns {string}
 */
function stripSceneNumber(text)
{
    let s = text.trim();
    s = s.replace(SCENE_NUMBER_PREFIX_RE, '');
    s = s.replace(/\s+([A-Z]?\d+[A-Z]?)\s*$/, '');
    return s;
}

// =============================================================================
// UNDERLINE DETECTION
// =============================================================================

/**
 * @typedef {Object} UnderlineRegion
 * @property {number} xStart - Left edge of underline
 * @property {number} xEnd - Right edge of underline
 * @property {number} y - Y-position of the underline stroke
 */

/**
 * Extract horizontal line regions from a page's operator list that likely
 * represent underlines. Scans for `constructPath` ops with sub-ops [13,14]
 * (moveTo + lineTo) where y1 ≈ y2. Applies the active CTM transform so
 * returned coordinates match `getTextContent()` coordinate space.
 *
 * @param {Object} page - pdf.js page proxy
 * @returns {Promise<UnderlineRegion[]>}
 */
async function extractUnderlineRegions(page)
{
    /** @type {UnderlineRegion[]} */
    const regions = [];

    let ops;
    try
    {
        ops = await page.getOperatorList();
    }
    catch
    {
        return regions;
    }

    // pdf.js op codes
    const OP_SAVE = 10;
    const OP_RESTORE = 11;
    const OP_TRANSFORM = 12;
    const OP_CONSTRUCT_PATH = 91;

    // pdf.js constructPath sub-op codes
    const MOVE_TO = 13;
    const LINE_TO = 14;

    // Track CTM stack for coordinate transforms.
    // The CTM maps path coords → text-content coords.
    // Identity: [1, 0, 0, 1, 0, 0] (a, b, c, d, e, f)
    let ctm = [1, 0, 0, 1, 0, 0];
    const ctmStack = [];

    for (let i = 0; i < ops.fnArray.length; i++)
    {
        const fn = ops.fnArray[i];

        if (fn === OP_SAVE)
        {
            ctmStack.push([...ctm]);
            continue;
        }

        if (fn === OP_RESTORE)
        {
            if (ctmStack.length > 0)
            {
                ctm = ctmStack.pop();
            }
            continue;
        }

        if (fn === OP_TRANSFORM)
        {
            const m = ops.argsArray[i];
            if (m && m.length >= 6)
            {
                // Multiply current CTM by new matrix: ctm = ctm * m
                const [a1, b1, c1, d1, e1, f1] = ctm;
                const [a2, b2, c2, d2, e2, f2] = m;
                ctm = [
                    a1 * a2 + c1 * b2,
                    b1 * a2 + d1 * b2,
                    a1 * c2 + c1 * d2,
                    b1 * c2 + d1 * d2,
                    a1 * e2 + c1 * f2 + e1,
                    b1 * e2 + d1 * f2 + f1,
                ];
            }
            continue;
        }

        if (fn !== OP_CONSTRUCT_PATH) continue;

        const args = ops.argsArray[i];
        if (!args || !Array.isArray(args[0]) || !Array.isArray(args[1])) continue;

        const subOps = args[0];
        const coords = args[1];

        // Walk through sub-ops, consuming coords
        let ci = 0;
        let lastMoveX = 0;
        let lastMoveY = 0;

        for (let s = 0; s < subOps.length; s++)
        {
            if (subOps[s] === MOVE_TO)
            {
                lastMoveX = coords[ci];
                lastMoveY = coords[ci + 1];
                ci += 2;
            }
            else if (subOps[s] === LINE_TO)
            {
                const lineX = coords[ci];
                const lineY = coords[ci + 1];
                ci += 2;

                // Horizontal line: y values within 1pt
                if (Math.abs(lastMoveY - lineY) < 1)
                {
                    const xStart = Math.min(lastMoveX, lineX);
                    const xEnd = Math.max(lastMoveX, lineX);
                    const width = xEnd - xStart;

                    // Skip tiny marks (< 5pt) — likely not underlines
                    if (width >= 5)
                    {
                        // Apply CTM to transform path coords into text-content space
                        const rawY = (lastMoveY + lineY) / 2;
                        const [a, b, c, d, e, f] = ctm;
                        const txStart = a * xStart + c * rawY + e;
                        const txEnd = a * xEnd + c * rawY + e;
                        const ty = b * xStart + d * rawY + f;

                        regions.push({
                            xStart: Math.min(txStart, txEnd),
                            xEnd: Math.max(txStart, txEnd),
                            y: ty,
                        });
                    }
                }

                lastMoveX = lineX;
                lastMoveY = lineY;
            }
            else if (subOps[s] === 19) // rectangle: consumes 4 coords
            {
                ci += 4;
            }
            else if (subOps[s] === 15) // curveTo: consumes 6 coords
            {
                ci += 6;
            }
            else if (subOps[s] === 16 || subOps[s] === 17) // curveTo2/3: consumes 4 coords
            {
                ci += 4;
            }
            else if (subOps[s] === 18) // closePath: consumes 0 coords
            {
                // no coords consumed
            }
            else
            {
                ci += 2; // fallback: assume 2 coords
            }
        }
    }

    return regions;
}

/**
 * Check if a text run is underlined by any of the given underline regions.
 * An underline sits within 5pt below the text baseline and spans the run's x-range.
 *
 * @param {number} runX - Left x of the text run
 * @param {number} runEndX - Right x of the text run
 * @param {number} textY - Y-position of the text baseline
 * @param {UnderlineRegion[]} regions
 * @returns {boolean}
 */
function isRunUnderlined(runX, runEndX, textY, regions)
{
    const runWidth = runEndX - runX;
    if (runWidth < 1) return false;

    for (const region of regions)
    {
        // Underline should be within 5pt below baseline (in raw PDF coords,
        // "below" depends on coordinate direction — accept both directions)
        const yDelta = Math.abs(region.y - textY);
        if (yDelta > 5) continue;

        // Underline x-range must overlap at least 60% of the text run
        const overlapStart = Math.max(runX, region.xStart);
        const overlapEnd = Math.min(runEndX, region.xEnd);
        const overlap = overlapEnd - overlapStart;

        if (overlap >= runWidth * 0.6)
        {
            return true;
        }
    }
    return false;
}

// =============================================================================
// TEXT EXTRACTION
// =============================================================================

/**
 * Extract text lines from a single PDF page.
 * Clusters TextItems by y-position into lines, sorted top-to-bottom.
 *
 * @param {Object} page - pdf.js page proxy
 * @param {UnderlineRegion[]} [underlineRegions] - Detected underline regions for this page
 * @returns {Promise<PdfLine[]>}
 */
async function extractPageLines(page, underlineRegions)
{
    const textContent = await page.getTextContent();
    const items = textContent.items;

    if (!items || items.length === 0)
    {
        return [];
    }

    const Y_CLUSTER_THRESHOLD = 2;

    /** @type {Map<number, { x: number, items: { str: string, x: number, fontName?: string, width?: number }[] }>} */
    const clusters = new Map();

    /** @type {Map<string, number>} */
    const fontCounts = new Map();

    for (const item of items)
    {
        if (!item.str || item.str.trim() === '') continue;

        const x = item.transform[4];
        if (item.str.trim() === '*') continue;  // revision marker
        const y = item.transform[5];
        const fontName = item.fontName || '';

        if (fontName)
        {
            fontCounts.set(fontName, (fontCounts.get(fontName) || 0) + 1);
        }

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
            cluster.items.push({ str: item.str, x, fontName, width: item.width || 0 });
        }
        else
        {
            clusters.set(y, { x, items: [{ str: item.str, x, fontName, width: item.width || 0 }] });
        }
    }

    let dominantFont = '';
    let maxCount = 0;
    for (const [font, count] of fontCounts)
    {
        if (count > maxCount)
        {
            maxCount = count;
            dominantFont = font;
        }
    }

    const lines = [];
    for (const [y, cluster] of clusters)
    {
        cluster.items.sort((a, b) => a.x - b.x);

        // Detect column splits: groups of items separated by >= DUAL_DIALOGUE_GAP_PT
        const columnGroups = [[]];
        for (let i = 0; i < cluster.items.length; i++)
        {
            const cur = cluster.items[i];
            if (i > 0)
            {
                const prev = cluster.items[i - 1];
                const prevEnd = prev.x + (prev.width || prev.str.length * 5.5);
                const gap = cur.x - prevEnd;
                if (gap >= DUAL_DIALOGUE_GAP_PT && cur.x > 280)
                {
                    columnGroups.push([]);
                }
            }
            columnGroups[columnGroups.length - 1].push(cur);
        }

        for (let col = 0; col < columnGroups.length; col++)
        {
            const group = columnGroups[col];

            // Group consecutive items by style (same fontName = same run)
            // Track per-item positions for partial-run underline detection
            const runs = [];
            for (let i = 0; i < group.length; i++)
            {
                const cur = group[i];
                let segment = '';
                let leadingSpace = false;
                if (i > 0)
                {
                    const prev = group[i - 1];
                    const prevEnd = prev.x + (prev.width || prev.str.length * 5.5);
                    const gap = cur.x - prevEnd;
                    if (gap > 2 && !prev.str.endsWith(' ') && !cur.str.startsWith(' '))
                    {
                        segment = ' ';
                        leadingSpace = true;
                    }
                }
                segment += cur.str;

                const curFont = cur.fontName || '';
                const curEndX = cur.x + (cur.width || cur.str.length * 5.5);
                if (runs.length > 0 && runs[runs.length - 1].fontName === curFont)
                {
                    runs[runs.length - 1].text += segment;
                    runs[runs.length - 1].endX = curEndX;
                    runs[runs.length - 1].items.push({ str: cur.str, x: cur.x, endX: curEndX, leadingSpace });
                }
                else
                {
                    // Attach leading space to previous run if switching font
                    if (segment.startsWith(' ') && runs.length > 0)
                    {
                        runs[runs.length - 1].text += ' ';
                        segment = segment.slice(1);
                        leadingSpace = false;
                    }
                    runs.push({
                        text: segment,
                        fontName: curFont,
                        startX: cur.x,
                        endX: curEndX,
                        items: [{ str: cur.str, x: cur.x, endX: curEndX, leadingSpace }],
                    });
                }
            }

            let text = '';
            for (const run of runs)
            {
                const styled = dominantFont && run.fontName && run.fontName !== dominantFont;

                let isBold = false;
                let isItalic = false;

                if (styled)
                {
                    const fontLower = run.fontName.toLowerCase();
                    isBold = fontLower.includes('bold') || fontLower.includes('heavy') || fontLower.includes('black');
                    isItalic = fontLower.includes('italic') || fontLower.includes('oblique');

                    if (!isBold && !isItalic)
                    {
                        // pdf.js strips font names to anonymized handles like
                        // `g_d2_f1` when font subsetting/embedding obscures the
                        // real font. For those we have no signal about whether
                        // the font is bold/italic, so don't assume — leaving it
                        // plain matches the visual rendering. Only fall back to
                        // "assume bold" when the font name was preserved.
                        if (!/^g_d\d+_f\d+$/.test(run.fontName))
                        {
                            isBold = true;
                        }
                    }
                }

                // Check underline per-item for partial-run detection
                const hasUnderlineRegions = underlineRegions && underlineRegions.length > 0;
                const wholeRunUnderlined = hasUnderlineRegions
                    && isRunUnderlined(run.startX, run.endX, y, underlineRegions);

                if (!styled && !wholeRunUnderlined && !hasUnderlineRegions)
                {
                    text += run.text;
                    continue;
                }

                // If whole run is underlined (or no underline regions), apply uniformly
                if (!hasUnderlineRegions || wholeRunUnderlined)
                {
                    if (!styled && !wholeRunUnderlined)
                    {
                        text += run.text;
                        continue;
                    }

                    const trimmed = run.text.trim();
                    const leadSpace = run.text.startsWith(' ') ? ' ' : '';
                    const trailSpace = run.text.endsWith(' ') ? ' ' : '';

                    let result = trimmed;
                    if (isBold && isItalic) result = '***' + result + '***';
                    else if (isBold) result = '**' + result + '**';
                    else if (isItalic) result = '*' + result + '*';

                    if (wholeRunUnderlined) result = '_' + result + '_';

                    text += leadSpace + result + trailSpace;
                    continue;
                }

                // Partial underline: check each item individually and group into
                // underlined vs non-underlined segments
                const segments = []; // { text, underlined }
                for (const item of run.items)
                {
                    const itemUnderlined = isRunUnderlined(item.x, item.endX, y, underlineRegions);
                    const prefix = item.leadingSpace ? ' ' : '';
                    const str = prefix + item.str;

                    if (segments.length > 0 && segments[segments.length - 1].underlined === itemUnderlined)
                    {
                        segments[segments.length - 1].text += str;
                    }
                    else
                    {
                        segments.push({ text: str, underlined: itemUnderlined });
                    }
                }

                for (const seg of segments)
                {
                    if (!styled && !seg.underlined)
                    {
                        text += seg.text;
                        continue;
                    }

                    const trimmed = seg.text.trim();
                    if (!trimmed) { text += seg.text; continue; }

                    const leadSpace = seg.text.startsWith(' ') ? ' ' : '';
                    const trailSpace = seg.text.endsWith(' ') ? ' ' : '';

                    let result = trimmed;
                    if (isBold && isItalic) result = '***' + result + '***';
                    else if (isBold) result = '**' + result + '**';
                    else if (isItalic) result = '*' + result + '*';

                    if (seg.underlined) result = '_' + result + '_';

                    text += leadSpace + result + trailSpace;
                }
            }

            text = text.trim();
            if (text)
            {
                const line = { x: group[0].x, y, text };
                if (columnGroups.length > 1)
                {
                    line.column = col;
                }
                lines.push(line);
            }
        }
    }

    // Sort: if column splits exist, group column lines into y-proximity blocks
    // so multiple dual-dialogue blocks on one page don't interleave.
    const hasColumns = lines.some(l => l.column !== undefined);
    if (hasColumns)
    {
        const columnLines = lines.filter(l => l.column !== undefined);
        const regularLines = lines.filter(l => l.column === undefined);

        // Group column lines into blocks by y-proximity
        const sorted = [...columnLines].sort((a, b) => b.y - a.y);
        const GAP_THRESHOLD = 40;
        const blocks = [];
        let currentBlock = [sorted[0]];
        for (let i = 1; i < sorted.length; i++)
        {
            const gap = currentBlock[currentBlock.length - 1].y - sorted[i].y;
            if (gap > GAP_THRESHOLD)
            {
                blocks.push(currentBlock);
                currentBlock = [sorted[i]];
            }
            else
            {
                currentBlock.push(sorted[i]);
            }
        }
        blocks.push(currentBlock);

        // Build final order: above → [block-left, block-right] → between → ... → below
        regularLines.sort((a, b) => b.y - a.y);
        lines.length = 0;

        for (let i = 0; i < blocks.length; i++)
        {
            const block = blocks[i];
            const blockYMax = Math.max(...block.map(l => l.y));
            const blockYMin = Math.min(...block.map(l => l.y));

            // Regular lines above this block (and below the previous block)
            const prevYMin = i > 0
                ? Math.min(...blocks[i - 1].map(l => l.y))
                : Infinity;
            const aboveBlock = regularLines.filter(l =>
                l.y <= prevYMin && l.y > blockYMax
            );
            lines.push(...aboveBlock);

            const left = block.filter(l => l.column === 0);
            const right = block.filter(l => l.column === 1);
            left.sort((a, b) => b.y - a.y);
            right.sort((a, b) => b.y - a.y);
            lines.push(...left, ...right);
        }

        // Regular lines below the last block
        const lastBlockYMin = Math.min(...blocks[blocks.length - 1].map(l => l.y));
        const below = regularLines.filter(l => l.y < lastBlockYMin);
        lines.push(...below);
    }
    else
    {
        lines.sort((a, b) => b.y - a.y);
    }

    return lines;
}

const HEADER_FOOTER_EDGE_FRACTION = 0.10;       // top/bottom 10% of page height
const HEADER_FOOTER_PAGE_RATIO = 0.90;          // line must repeat on ≥90% of pages

/**
 * Detect lines that appear repeatedly in the top/bottom edge bands across
 * pages — these are page-headers / page-footers (script title, revision
 * date, page number, etc.) and should not bleed into the screenplay
 * elements. The gate is intentionally strict: a line is only dropped if it
 * appears on ≥90% of pages at the same y-position with the same digit-
 * stripped lowercase text. That excludes legitimate body content that just
 * happens to land near the page edge on one or two pages.
 *
 * @param {PdfLine[]} lines        — all lines, with .pageIndex set
 * @param {number}    pageCount    — total pages walked
 * @param {number}    pageHeight   — pt height of the page viewport
 * @returns {Set<number>}          — set of indices in `lines` to drop
 */
function detectPageHeaderFooterLines(lines, pageCount, pageHeight)
{
    if (pageCount < 3 || pageHeight <= 0) return new Set();

    const topBandY = pageHeight * (1 - HEADER_FOOTER_EDGE_FRACTION);
    const bottomBandY = pageHeight * HEADER_FOOTER_EDGE_FRACTION;
    const minPages = Math.max(1, Math.ceil(pageCount * HEADER_FOOTER_PAGE_RATIO));

    /** @type {Map<string, Set<number>>} */
    const keyToPages = new Map();
    /** @type {Map<string, number[]>} */
    const keyToLineIdx = new Map();

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];
        const text = (line.text || '').trim();
        if (!text) continue;

        // Skip lines that PAGE_NUMBER_RE would already drop downstream
        if (PAGE_NUMBER_RE.test(text)) continue;

        const inEdge = line.y >= topBandY || line.y <= bottomBandY;
        if (!inEdge) continue;

        // Normalise: lowercase, collapse whitespace, strip digits so
        // "May 1 Blue Draft--p.2" / "May 1 Blue Draft--p.3" / ... collapse.
        const normalised = text.toLowerCase().replace(/\s+/g, ' ').replace(/\d+/g, '').trim();
        if (!normalised) continue;

        // Y-bucket to 2pt to allow tiny baseline jitter
        const yBucket = Math.round(line.y / 2) * 2;
        const key = `${yBucket}|${normalised}`;

        if (!keyToPages.has(key))
        {
            keyToPages.set(key, new Set());
            keyToLineIdx.set(key, []);
        }
        keyToPages.get(key).add(line.pageIndex);
        keyToLineIdx.get(key).push(i);
    }

    const dropIdx = new Set();
    for (const [key, pageSet] of keyToPages)
    {
        if (pageSet.size >= minPages)
        {
            for (const idx of keyToLineIdx.get(key)) dropIdx.add(idx);
        }
    }
    return dropIdx;
}

/**
 * Extract all lines from all pages of a PDF document.
 * Computes per-page median line spacing for paragraph detection.
 *
 * @param {Object} pdfDoc - pdf.js document proxy
 * @returns {Promise<{ lines: PdfLine[], pageCount: number, medianLineSpacing: number }>}
 */
async function extractAllLines(pdfDoc)
{
    const pageCount = pdfDoc.numPages;
    /** @type {PdfLine[]} */
    const allLines = [];

    let firstPageHeight = 0;

    for (let i = 1; i <= pageCount; i++)
    {
        const page = await pdfDoc.getPage(i);
        if (i === 1)
        {
            firstPageHeight = page.view ? page.view[3] : 0;
        }
        const underlineRegions = await extractUnderlineRegions(page);
        const pageLines = await extractPageLines(page, underlineRegions);

        for (const line of pageLines)
        {
            line.pageIndex = i - 1;
            allLines.push(line);
        }
    }

    const headerFooterIdx = detectPageHeaderFooterLines(allLines, pageCount, firstPageHeight);
    let filteredLines = allLines;
    if (headerFooterIdx.size > 0)
    {
        filteredLines = allLines.filter((_, idx) => !headerFooterIdx.has(idx));
    }

    // Compute y-gaps between consecutive lines on each page (top-to-bottom = descending y).
    // Grouped by pageIndex; filteredLines preserves source order.
    /** @type {number[]} */
    const allGaps = [];
    let lastPageIdx = -1;
    let prevY = null;
    for (const ln of filteredLines)
    {
        if (ln.pageIndex !== lastPageIdx)
        {
            prevY = null;
            lastPageIdx = ln.pageIndex;
        }
        if (prevY !== null)
        {
            const gap = prevY - ln.y;
            if (gap > 0) allGaps.push(gap);
        }
        prevY = ln.y;
    }

    let medianLineSpacing = 20;
    if (allGaps.length > 0)
    {
        allGaps.sort((a, b) => a - b);
        const mid = Math.floor(allGaps.length / 2);
        medianLineSpacing = allGaps.length % 2 === 0
            ? (allGaps[mid - 1] + allGaps[mid]) / 2
            : allGaps[mid];
    }

    return { lines: filteredLines, pageCount, medianLineSpacing };
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
        // Skip right-column lines so dual-dialogue outliers don't poison the histogram
        if (line.column !== undefined && line.column > 0) continue;
        // Skip slugs carrying a leading scene-number token (e.g. "202 EXT. ...").
        // pdf.js Y-clusters the number into the same line as the slug, shifting
        // line.x left of the action margin. Including these poisons leftMargin.
        const plainForHist = stripEmphasis(line.text);
        if (SCENE_NUMBER_PREFIX_RE.test(plainForHist) && SCENE_HEADING_RE.test(plainForHist)) continue;

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

    // leftMargin should be the leftmost significant x-bucket — action paragraphs
    // are always at the leftmost column in a screenplay. Picking the most-common
    // bucket fails on TV scripts where dialogue lines outnumber action lines.
    const totalLines = sorted.reduce((sum, e) => sum + e[1], 0);
    const maxBucketCount = sorted[0][1];
    const proportionalFloor = Math.round(maxBucketCount * 0.25);
    const minBucketCount = Math.max(10, Math.round(totalLines * 0.01), proportionalFloor);
    const significantSortedByX = sorted
        .filter(([, count]) => count >= minBucketCount)
        .sort((a, b) => a[0] - b[0]);
    const leftMargin = significantSortedByX.length > 0
        ? significantSortedByX[0][0]
        : sorted[0][0];

    const significantBuckets = sorted
        .filter(([x, count]) => x > leftMargin + 15 && count >= minBucketCount)
        .sort((a, b) => b[1] - a[1]);
    const top3 = significantBuckets.slice(0, 3).map(([x]) => x).sort((a, b) => a - b);
    const xValues = top3;

    let dialogueX = leftMargin + 70;
    let parentheticalX = leftMargin + 110;
    let characterX = leftMargin + 160;
    let transitionX = leftMargin + 280;

    if (xValues.length >= 3)
    {
        dialogueX = xValues[0];
        parentheticalX = xValues[1];
        characterX = xValues[2];
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
    if (CONTINUED_HINT_RE.test(text)) return null;
    if (MORE_HINT_RE.test(text)) return null;
    if (SCENE_CONTINUATION_RE.test(text)) return null;

    // Strip bold/italic markdown for classification only (preserves original in output)
    const plainText = stripEmphasis(text);

    if (PAGE_NUMBER_RE.test(plainText)) return null;
    if (CONTINUED_HINT_RE.test(plainText)) return null;
    if (MORE_HINT_RE.test(plainText)) return null;
    if (SCENE_CONTINUATION_RE.test(plainText)) return null;

    // OCR noise: a "line" that, with markdown emphasis stripped and all
    // whitespace removed, contains no letters and no digits is OCR-captured
    // punctuation garbage (stray dashes, dots, parens, slashes, dingbats). It
    // has no meaningful content; emitting it as a centered action would
    // produce `> **/** <` style fountain that breaks downstream parseFountain
    // slug detection.
    const stripped = plainText.replace(/[\s_*]/g, '');
    if (stripped.length > 0 && !/[A-Za-z0-9]/.test(stripped)) return null;

    const xDelta = line.x - profile.leftMargin;

    // Scene-heading classification:
    //  - bypass the xDelta gate when the line carries a scene-number prefix
    //    (e.g. "4 EXT. STREET - DAY") — the prefix shifts line.x left.
    //  - bypass the xDelta gate when the slug regex matches AND content is
    //    short (< 120 chars) AND all-caps — buildMarginProfile can pick the
    //    wrong leftMargin (e.g. dialogue cluster) on TV-script PDFs where
    //    dialogue lines outnumber action lines. False positives are
    //    extremely unlikely: a 120-char all-caps line starting with INT./EXT.
    //    is overwhelmingly a slug.
    const hasScenePrefix = SCENE_NUMBER_PREFIX_RE.test(plainText);
    const matchesSlug = SCENE_HEADING_RE.test(plainText);
    const looksLikeSlug = matchesSlug && plainText.length < 120 && plainText === plainText.toUpperCase();
    if (matchesSlug && (Math.abs(xDelta) < 30 || hasScenePrefix || looksLikeSlug))
    {
        return { type: 'scene_heading', content: stripSceneNumber(stripEmphasis(text)) };
    }

    // TV-act structural marker (e.g. "ACT ONE.", "END OF ACT TWO.")
    // These are centered, not left-margin — relax the x-delta gate.
    if (TV_ACT_MARKER_RE.test(plainText))
    {
        return {
            type: 'scene_heading',
            content: stripEmphasis(text),
            meta: { actBoundary: true }
        };
    }

    // Drop FADE IN: / FADE OUT. / CUT TO BLACK. entirely — parseFountain
    // doesn't recognize these as transitions on the round-trip (it drops
    // FADE IN: and misparses FADE OUT. / CUT TO BLACK. as character cues),
    // so emitting them as transitions inflates transition_count_drift on
    // every PDF that uses them.
    if (FADE_RE.test(plainText)) return null;
    if (TRANSITION_RE.test(plainText))
    {
        return { type: 'transition', content: stripEmphasis(text) };
    }

    const charThreshold = (profile.characterX - profile.dialogueX) / 2 + profile.dialogueX;
    const dialogueThreshold = (profile.dialogueX - profile.leftMargin) / 2 + profile.leftMargin;
    const parenThreshold = dialogueThreshold - 10;

    if (xDelta > charThreshold - profile.leftMargin)
    {
        const withoutExt = plainText.replace(/(\s*\([^)]+\))+\s*$/, '');
        if (CHARACTER_CUE_RE.test(withoutExt) && plainText.length < 50)
        {
            const nextType = nextLine ? classifyLineType(nextLine, profile) : null;
            if (nextType === 'dialogue' || nextType === 'parenthetical' || nextType === 'character')
            {
                const match = text.match(CHARACTER_EXT_RE);
                if (match)
                {
                    const exts = match[2].match(/\(([^)]+)\)/g);
                    const modifier = exts
                        ? exts.map(e => e.slice(1, -1).trim()).join(') (')
                        : match[2].trim().slice(1, -1);
                    return {
                        type: 'character',
                        content: match[1].trim(),
                        meta: { modifier },
                    };
                }
                return { type: 'character', content: text };
            }
        }
    }

    if (/^\(.+\)$/.test(text) && xDelta > parenThreshold - profile.leftMargin)
    {
        return { type: 'parenthetical', content: text };
    }

    // Dual dialogue columns shift margins — classify by content, not position.
    if (line.column !== undefined)
    {
        const withoutExt = plainText.replace(/(\s*\([^)]+\))+\s*$/, '');
        if (CHARACTER_CUE_RE.test(withoutExt) && plainText.length < 50)
        {
            const match = text.match(CHARACTER_EXT_RE);
            if (match)
            {
                const exts = match[2].match(/\(([^)]+)\)/g);
                const modifier = exts
                    ? exts.map(e => e.slice(1, -1).trim()).join(') (')
                    : match[2].trim().slice(1, -1);
                return {
                    type: 'character',
                    content: match[1].trim(),
                    meta: { modifier },
                };
            }
            return { type: 'character', content: text };
        }
        // Cluster A4: a short numbered all-caps line is a shooting-script shot
        // direction, not dialogue. Round-trip parses it as action, so classify as
        // action here for symmetry.
        if (SHOT_DIRECTION_RE.test(plainText) && plainText.length < 50 && plainText === plainText.toUpperCase())
        {
            return { type: 'action', content: stripEmphasis(text) };
        }
        return { type: 'dialogue', content: text };
    }

    if (xDelta > dialogueThreshold - profile.leftMargin && xDelta < charThreshold - profile.leftMargin)
    {
        if (prevLine)
        {
            const prevType = classifyLineType(prevLine, profile);
            if (prevType === 'character' || prevType === 'parenthetical' || prevType === 'dialogue')
            {
                // Cluster A4: a short numbered all-caps line is a shooting-script shot
                // direction, not dialogue. Round-trip parses it as action, so classify as
                // action here for symmetry.
                if (SHOT_DIRECTION_RE.test(plainText) && plainText.length < 50 && plainText === plainText.toUpperCase())
                {
                    return { type: 'action', content: stripEmphasis(text) };
                }
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
        if (plainText.length < 50 && xDelta > profile.transitionX - profile.leftMargin)
        {
            return { type: 'action', content: text, meta: { centered: true } };
        }
        if (prevLine)
        {
            const prevType = classifyLineType(prevLine, profile);
            if (prevType === 'character' || prevType === 'parenthetical' || prevType === 'dialogue')
            {
                // Cluster A4: a short numbered all-caps line is a shooting-script shot
                // direction, not dialogue. Round-trip parses it as action, so classify as
                // action here for symmetry.
                if (SHOT_DIRECTION_RE.test(plainText) && plainText.length < 50 && plainText === plainText.toUpperCase())
                {
                    return { type: 'action', content: stripEmphasis(text) };
                }
                return { type: 'dialogue', content: text };
            }
        }
        return { type: 'action', content: text };
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
    if (CONTINUED_HINT_RE.test(text)) return 'action';
    if (MORE_HINT_RE.test(text)) return 'action';
    if (SCENE_CONTINUATION_RE.test(text)) return 'action';

    // Strip bold/italic markdown for classification only
    const plainText = stripEmphasis(text);

    if (PAGE_NUMBER_RE.test(plainText)) return 'action';
    if (CONTINUED_HINT_RE.test(plainText)) return 'action';
    if (MORE_HINT_RE.test(plainText)) return 'action';
    if (SCENE_CONTINUATION_RE.test(plainText)) return 'action';

    // OCR noise: a "line" that, with markdown emphasis stripped and all
    // whitespace removed, contains no letters and no digits is OCR-captured
    // punctuation garbage (stray dashes, dots, parens, slashes, dingbats). It
    // has no meaningful content; emitting it as a centered action would
    // produce `> **/** <` style fountain that breaks downstream parseFountain
    // slug detection.
    const stripped = plainText.replace(/[\s_*]/g, '');
    if (stripped.length > 0 && !/[A-Za-z0-9]/.test(stripped)) return 'action';

    const xDelta = line.x - profile.leftMargin;
    const charThreshold = (profile.characterX - profile.dialogueX) / 2 + profile.dialogueX;
    const dialogueThreshold = (profile.dialogueX - profile.leftMargin) / 2 + profile.leftMargin;

    {
        const matchesSlug = SCENE_HEADING_RE.test(plainText);
        const hasScenePrefix = SCENE_NUMBER_PREFIX_RE.test(plainText);
        const looksLikeSlug = matchesSlug && plainText.length < 120 && plainText === plainText.toUpperCase();
        if (matchesSlug && (Math.abs(xDelta) < 30 || hasScenePrefix || looksLikeSlug)) return 'scene_heading';
    }
    if (TV_ACT_MARKER_RE.test(plainText)) return 'scene_heading';
    // FADE IN: / FADE OUT. / CUT TO BLACK. are dropped by classifyLine (the
    // round-trip parseFountain doesn't see them as transitions). Mirror that
    // here so lookahead/lookbehind doesn't treat them as transitions.
    if (FADE_RE.test(plainText)) return 'action';
    if (TRANSITION_RE.test(plainText)) return 'transition';

    if (xDelta > charThreshold - profile.leftMargin)
    {
        const withoutExt = plainText.replace(/(\s*\([^)]+\))+\s*$/, '');
        if (CHARACTER_CUE_RE.test(withoutExt) && plainText.length < 50) return 'character';
    }

    if (/^\(.+\)$/.test(plainText)) return 'parenthetical';

    if (line.column !== undefined)
    {
        const withoutExt = plainText.replace(/(\s*\([^)]+\))+\s*$/, '');
        if (CHARACTER_CUE_RE.test(withoutExt) && plainText.length < 50) return 'character';
        return 'dialogue';
    }

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

    const hasSceneHeading = firstPageLines.some(l => SCENE_HEADING_RE.test(l.text.trim().replace(/^\*{1,3}|\*{1,3}$/g, '').trim()));
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
    /** @type {string[]} */
    const extra = [];

    for (const line of centeredLines)
    {
        const text = line.text.trim();
        if (!text) continue;

        if (!foundTitle)
        {
            result.title = stripEmphasis(text);
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
            result.author = stripEmphasis(text);
            continue;
        }

        // Centered metadata that doesn't fit title/credit/author —
        // episode subtitle, source line, draft label, draft date, studio,
        // production co., producer attribution. Preserve verbatim.
        extra.push(stripEmphasis(text));
    }

    if (extra.length > 0) result.extra = extra;

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
// ELEMENT MERGING
// =============================================================================

/**
 * Merge consecutive elements of the same type into single elements.
 * PDF lines map 1:1 to elements, but screenplay elements span multiple
 * PDF lines (e.g. a dialogue block is one element, not three).
 *
 * Mergeable types: action, dialogue. Other types (character, parenthetical,
 * scene_heading, transition, page_break) are never merged.
 *
 * Paragraph-aware: if the y-gap between two consecutive same-type elements
 * exceeds 1.4x the median line spacing, a new element is emitted instead
 * of merging (representing a paragraph break).
 *
 * @param {ScreenplayElement[]} elements
 * @param {number} medianLineSpacing
 * @returns {ScreenplayElement[]}
 */
function mergeConsecutiveElements(elements, medianLineSpacing)
{
    if (elements.length === 0) return elements;

    const MERGEABLE = new Set(['action', 'dialogue']);
    const PARAGRAPH_THRESHOLD = 1.4;
    const result = [elements[0]];

    for (let i = 1; i < elements.length; i++)
    {
        const prev = result[result.length - 1];
        const cur = elements[i];

        if (MERGEABLE.has(cur.type) && cur.type === prev.type)
        {
            // Page boundary always breaks merging
            if (cur._pageIndex !== prev._pageIndex)
            {
                result.push(cur);
                continue;
            }

            // Paragraph break: y-gap exceeds threshold
            const yGap = prev._y - cur._y;
            if (yGap > medianLineSpacing * PARAGRAPH_THRESHOLD)
            {
                result.push(cur);
                continue;
            }

            // Rejoin hyphenated words split across PDF lines: "Kal-" + "El" → "Kal-El"
            const prevContent = prev.content;
            const endsHyphenLetter = /[a-zA-Z]-$/.test(prevContent);
            const startsLetter = /^[a-zA-Z]/.test(cur.content);
            const separator = (endsHyphenLetter && startsLetter) ? '' : ' ';

            prev.content += separator + cur.content;
            prev.sourceLineEnd = cur.sourceLineEnd;
            prev._y = cur._y;
        }
        else
        {
            result.push(cur);
        }
    }

    return result;
}

// =============================================================================
// TEXT NORMALIZATION
// =============================================================================

/**
 * Replace curly/typographic quotes with straight equivalents.
 * Applied to all element types.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeQuotes(text)
{
    return text
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"');
}

/**
 * Normalize dashes: `--` → em-dash, en-dash → em-dash (unless in a number range).
 * Applied only to action and dialogue.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeDashes(text)
{
    // Double-hyphen → em-dash
    text = text.replace(/--/g, '—');
    // En-dash between non-digits → em-dash
    text = text.replace(/(\D)–(\D)/g, '$1—$2');
    return text;
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

    const { lines, pageCount, medianLineSpacing } = await extractAllLines(pdfDoc);

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
        if (titleInfo.extra && titleInfo.extra.length > 0)
        {
            screenplay.titlePageExtra = titleInfo.extra;
        }
    }

    /** @type {ScreenplayElement[]} */
    const elements = [];
    let lineNum = 0;
    const contentLines = titleInfo.isTitlePage
        ? lines.filter(l => l.pageIndex > 0)
        : lines;

    for (let i = 0; i < contentLines.length; i++)
    {
        const line = contentLines[i];
        lineNum++;

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
            _y: line.y,
            _pageIndex: line.pageIndex,
        };

        if (classified.meta)
        {
            element.meta = classified.meta;
        }

        if (line.column !== undefined)
        {
            if (!element.meta) element.meta = {};
            element.meta._column = line.column;
        }

        elements.push(element);
    }

    // Detect dual dialogue: when right-column character cues interleave
    // with left-column sequences, mark them as dual dialogue.
    for (let i = 0; i < elements.length; i++)
    {
        const el = elements[i];
        if (el.type === 'character' && el.meta?._column === 1)
        {
            let hasLeftColumn = false;
            for (let j = Math.max(0, i - 2); j <= Math.min(elements.length - 1, i + 2); j++)
            {
                if (j !== i && (elements[j].meta?._column === 0 || (elements[j].meta?._column === undefined && elements[j].type === 'character')))
                {
                    hasLeftColumn = true;
                    break;
                }
            }
            if (hasLeftColumn)
            {
                if (!el.meta) el.meta = {};
                el.meta.dualDialogue = true;
            }
        }
    }

    const merged = mergeConsecutiveElements(elements, medianLineSpacing);

    // Cluster E: a dialogue element whose content is fully wrapped in
    // parens AND whose predecessor is a character cue is structurally a
    // parenthetical. This can't be detected pre-merge because the raw PDF
    // often splits multi-line parens (e.g. "(brightening--" + "a new topic)")
    // across two lines — both halves are classified as dialogue and only
    // become paren-shaped after mergeConsecutiveElements joins them.
    for (let i = 0; i < merged.length; i++)
    {
        const el = merged[i];
        if (el.type !== 'dialogue') continue;
        const c = (el.content || '').trim();
        if (!/^\(.+\)$/s.test(c)) continue;
        const prev = i > 0 ? merged[i - 1] : null;
        if (prev && prev.type === 'character')
        {
            el.type = 'parenthetical';
        }
    }

    const DASH_NORMALIZABLE = new Set(['action', 'dialogue']);
    for (const el of merged)
    {
        el.content = normalizeQuotes(el.content);
        if (DASH_NORMALIZABLE.has(el.type))
        {
            el.content = normalizeDashes(el.content);
        }
    }

    const bodyStartIdx = merged.findIndex(el =>
    {
        return el.type === 'scene_heading' || el.type === 'transition'
            || /^FADE\s*IN/i.test(stripEmphasis(el.content).trim());
    });
    if (bodyStartIdx > 0 && merged[bodyStartIdx]._pageIndex !== merged[bodyStartIdx - 1]._pageIndex)
    {
        merged.splice(bodyStartIdx, 0, {
            type: 'page_break',
            content: '',
            sourceLineStart: 0,
            sourceLineEnd: 0,
            _y: 0,
            _pageIndex: merged[bodyStartIdx - 1]._pageIndex,
        });
    }

    let renumLine = 1;
    for (const el of merged)
    {
        const lineCount = el.content.split('\n').length;
        el.sourceLineStart = renumLine;
        el.sourceLineEnd = renumLine + lineCount - 1;
        renumLine += lineCount;
    }

    screenplay.scenes = groupIntoScenes(merged);
    const contentPages = new Set(lines.filter(l => l.text.trim()).map(l => l.pageIndex));
    screenplay.printedPageCount = contentPages.size;

    return screenplay;
}
