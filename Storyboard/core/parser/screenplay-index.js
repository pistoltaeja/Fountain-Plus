/**
 * Mangaplay Screenplay Index
 * Bidirectional mapping between Mangaplay source lines and screenplay elements
 *
 * @module core/parser/screenplay-index
 */

/** @typedef {import('./screenplay-parser.js').Screenplay} Screenplay */
/** @typedef {import('./screenplay-parser.js').ScreenplayScene} ScreenplayScene */
/** @typedef {import('./screenplay-parser.js').ScreenplayElement} ScreenplayElement */
/** @typedef {import('../types.js').ScriptAST} ScriptAST */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Entry mapping a screenplay element to source lines
 * @typedef {Object} ElementMapping
 * @property {number} index - Global element index in flattened screenplay
 * @property {number} lineStart - Source line start (0-based)
 * @property {number} lineEnd - Source line end (0-based)
 * @property {number} sceneIndex - Scene index this element belongs to
 * @property {number} elementIndex - Element index within scene
 */

/**
 * Bidirectional index between source lines and screenplay elements
 * @typedef {Object} ScreenplayIndex
 * @property {ElementMapping[]} elements - All element mappings
 * @property {Map<number, number>} lineToElement - Map source line -> global element index
 */

// =============================================================================
// INDEX BUILDER
// =============================================================================

/**
 * Build bidirectional index from screenplay and AST
 *
 * The index maps:
 * - elements[i] -> { lineStart, lineEnd } for scrolling screenplay to line
 * - lineToElement.get(line) -> element index for scrolling line to screenplay
 *
 * @param {Screenplay} screenplay - Parsed screenplay
 * @param {ScriptAST} ast - Source AST with line numbers
 * @returns {ScreenplayIndex}
 */
export function buildScreenplayIndex(screenplay, ast)
{
    /** @type {ElementMapping[]} */
    const elements = [];

    /** @type {Map<number, number>} */
    const lineToElement = new Map();

    let globalIndex = 0;

    for (let sceneIdx = 0; sceneIdx < screenplay.scenes.length; sceneIdx++)
    {
        const scene = screenplay.scenes[sceneIdx];

        for (let elemIdx = 0; elemIdx < scene.elements.length; elemIdx++)
        {
            const element = scene.elements[elemIdx];

            // Get source line range from element metadata
            const lineStart = element.sourceLineStart ?? 0;
            const lineEnd = element.sourceLineEnd ?? lineStart;

            const mapping = {
                index: globalIndex,
                lineStart,
                lineEnd,
                sceneIndex: sceneIdx,
                elementIndex: elemIdx
            };

            elements.push(mapping);

            // Map all lines in range to this element
            for (let line = lineStart; line <= lineEnd; line++)
            {
                // Only set if not already mapped (first element wins for overlaps)
                if (!lineToElement.has(line))
                {
                    lineToElement.set(line, globalIndex);
                }
            }

            globalIndex++;
        }
    }

    return { elements, lineToElement };
}

// =============================================================================
// LOOKUP FUNCTIONS
// =============================================================================

/**
 * Find screenplay element index by source line number
 *
 * @param {ScreenplayIndex} index - The screenplay index
 * @param {number} line - Source line number (0-based)
 * @returns {number} Element index, or -1 if not found
 */
export function findElementByLine(index, line)
{
    // Direct lookup first
    const direct = index.lineToElement.get(line);
    if (direct !== undefined)
    {
        return direct;
    }

    // Find nearest element before this line
    let nearestIndex = -1;
    let nearestLine = -1;

    for (const mapping of index.elements)
    {
        if (mapping.lineStart <= line && mapping.lineStart > nearestLine)
        {
            nearestLine = mapping.lineStart;
            nearestIndex = mapping.index;
        }
    }

    return nearestIndex;
}

/**
 * Find source line number by screenplay element index
 *
 * @param {ScreenplayIndex} index - The screenplay index
 * @param {number} elementIndex - Global element index
 * @returns {number} Source line number, or -1 if not found
 */
export function findLineByElement(index, elementIndex)
{
    if (elementIndex < 0 || elementIndex >= index.elements.length)
    {
        return -1;
    }

    return index.elements[elementIndex].lineStart;
}

/**
 * Get element mapping by index
 *
 * @param {ScreenplayIndex} index - The screenplay index
 * @param {number} elementIndex - Global element index
 * @returns {ElementMapping | null}
 */
export function getElementMapping(index, elementIndex)
{
    if (elementIndex < 0 || elementIndex >= index.elements.length)
    {
        return null;
    }

    return index.elements[elementIndex];
}

/**
 * Get total element count
 *
 * @param {ScreenplayIndex} index - The screenplay index
 * @returns {number}
 */
export function getElementCount(index)
{
    return index.elements.length;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
    buildScreenplayIndex,
    findElementByLine,
    findLineByElement,
    getElementMapping,
    getElementCount
};
