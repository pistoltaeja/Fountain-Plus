/**
 * SuperScript (.sup) Binary Reader
 *
 * Reads .sup files (ZIP archive containing script.json with a Quill-Delta
 * document) and returns plain-text SuperScript source (.sup.md form) suitable
 * for `parseSuperscript`. One-way conversion: .sup → .sup.md only.
 *
 * Quill Delta primer:
 *   - The document is an array of `ops`. Each op is either a text-run
 *     `{insert: "text", attributes?: {bold?: true, …}}` or a newline op
 *     `{insert: "\n" (or "\n\n" …), attributes?: {…block attrs…}}`.
 *   - Block attributes (`header`, `blockquote`, `frontmatter`) live on
 *     newline ops and apply to the LINE ABOVE the newline.
 *   - Inline `\n`s embedded inside a text-run insert (e.g.
 *     `"para 1\n\npara 2"`) are paragraph breaks with NO block attributes.
 *
 * Algorithm (op walk):
 *   - Maintain `buffer` (the in-progress line's text) and `out` (the lines
 *     we've emitted so far).
 *   - For each op:
 *       • If insert is a pure-newline string ("\n", "\n\n", …): emit
 *         `buffer` formatted by op.attributes block type, clear buffer,
 *         then emit one empty line per additional `\n` in the op.
 *       • Else: split insert by `\n`. For each non-last segment, append
 *         (wrapped in `**…**` if op has `bold: true`) to buffer and emit
 *         buffer as a plain (no-block-attr) line, clear buffer. The last
 *         segment stays in buffer for the next op to consume.
 *
 * Block-type formatting:
 *   - `frontmatter`           → buffer as-is
 *   - `header: 1`             → buffer as-is (already "PAGE N")
 *   - `header: 2`             → buffer as-is (already "Panel N")
 *   - `header: 3`             → buffer as-is (already "SPEAKER:")
 *   - `blockquote: true`      → "  " + trimmed buffer (canonical 2-space
 *                               indent; source text has inconsistent
 *                               leading whitespace across samples)
 *   - (no relevant attribute) → buffer as-is
 *
 * Inline attribute: `bold: true` on a text run → wrap the run in `**…**`.
 *
 * @module core/import/superscript-reader
 */

import JSZip from 'jszip';

/**
 * @typedef {Object} DeltaOp
 * @property {string|object} insert
 * @property {{ bold?: boolean, header?: number, blockquote?: boolean, frontmatter?: string }} [attributes]
 */

/**
 * Wrap a text fragment in `**…**` when the op's inline `bold` attribute is set.
 * @param {string} text
 * @param {{ bold?: boolean }} [attrs]
 * @returns {string}
 */
function applyInline(text, attrs)
{
    if (!attrs || !attrs.bold) return text;
    if (text.length === 0) return text;
    return '**' + text + '**';
}

/**
 * Apply the block-type formatting that the trailing newline carries.
 * @param {string} buffer
 * @param {{ header?: number, blockquote?: boolean, frontmatter?: string }} [attrs]
 * @returns {string}
 */
function formatBlock(buffer, attrs)
{
    if (!attrs) return buffer;
    if (attrs.blockquote === true)
    {
        // SuperScript dialogueCont expects 2-space indent. Source text has
        // inconsistent leading whitespace, so strip and re-add canonically.
        return '  ' + buffer.replace(/^\s+/, '');
    }
    // header 1/2/3 and frontmatter all emit the buffer text as-is; the
    // surface syntax (PAGE N, Panel N, SPEAKER:) is already in the buffer.
    return buffer;
}

/**
 * Convert a Quill Delta `ops` array into plain-text SuperScript source.
 * @param {DeltaOp[]} ops
 * @returns {string}
 */
function deltaToText(ops)
{
    /** @type {string[]} */
    const out = [];
    let buffer = '';

    for (const op of ops)
    {
        if (typeof op.insert !== 'string')
        {
            // Embeds (images, etc.) — ignore. SuperScript samples don't use
            // them but the Delta format permits object inserts.
            continue;
        }

        const text = op.insert;

        // Pure-newline op carries block attributes for the line above.
        if (/^\n+$/.test(text))
        {
            out.push(formatBlock(buffer, op.attributes));
            buffer = '';
            // Each additional `\n` is a blank line.
            for (let i = 1; i < text.length; i++)
            {
                out.push('');
            }
            continue;
        }

        // Text run, possibly with embedded `\n`s (which are plain paragraph
        // breaks — no block attrs).
        const segments = text.split('\n');
        for (let i = 0; i < segments.length; i++)
        {
            buffer += applyInline(segments[i], op.attributes);
            if (i < segments.length - 1)
            {
                // The `\n` between segments is a plain paragraph break.
                out.push(buffer);
                buffer = '';
            }
        }
    }

    // Flush any trailing unterminated buffer.
    if (buffer.length > 0)
    {
        out.push(buffer);
    }

    return out.join('\n');
}

/**
 * Read a `.sup` ZIP archive and return its document as plain-text SuperScript
 * source (consumable by `parseSuperscript`).
 *
 * @param {ArrayBuffer | Uint8Array} zipBytes - Raw .sup file contents
 * @returns {Promise<string>}
 */
export async function readSuperscriptBinary(zipBytes)
{
    let zip;
    try
    {
        zip = await JSZip.loadAsync(zipBytes);
    }
    catch (e)
    {
        throw new Error('Not a valid SuperScript file (ZIP load failed): ' + e.message);
    }

    const scriptFile = zip.file('script.json');
    if (!scriptFile)
    {
        throw new Error('No script.json found in SuperScript archive');
    }

    const json = await scriptFile.async('string');
    let data;
    try
    {
        data = JSON.parse(json);
    }
    catch (e)
    {
        throw new Error('script.json is not valid JSON: ' + e.message);
    }

    const ops = data && data.delta && Array.isArray(data.delta.ops) ? data.delta.ops : null;
    if (!ops)
    {
        throw new Error('script.json missing delta.ops array');
    }

    return deltaToText(ops);
}
