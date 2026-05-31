/**
 * Critical Report Engine — Auto-Fix Pipeline.
 *
 * Classifies parser/stats/tag warnings as auto-fixable or manual-review,
 * then applies in-place token fixes for auto-fixable warnings.
 *
 * @typedef {{ type: string, text: string, line: number }} Token
 *
 * @typedef {{
 *     code: string,
 *     source: string,
 *     message: string,
 *     line: number|null,
 *     sceneIdx: number|null,
 *     elementIdx: number|null,
 *     autoFixable: boolean,
 *     status: 'fixed'|'manual',
 *     original: string|null,
 *     fixed: string|null,
 *     suggestion?: string
 * }} ClassifiedWarning
 *
 * @typedef {{
 *     tokens: Token[],
 *     fixedCount: number,
 *     manualCount: number,
 *     fixes: ClassifiedWarning[]
 * }} AutoFixResult
 */

/**
 * Warning codes that can be auto-fixed by the engine.
 * @type {Set<string>}
 */
const AUTO_FIXABLE_PARSER = new Set([
    'WARN_PAGE_LOWERCASE',
    'WARN_PAGE_MISSING_HASH',
    'WARN_ACTION_INDENTED',
    'WARN_LEGACY_PANEL',
    'WARN_IMPLICIT_PAGE_1',
]);

const AUTO_FIXABLE_STATS = new Set([
    'UNKNOWN_TOKEN_TYPE',
]);

/**
 * Classify a single parser warning.
 * @param {object} w - raw warning from the parser
 * @returns {ClassifiedWarning}
 */
function classifyParserWarning(w)
{
    const autoFixable = AUTO_FIXABLE_PARSER.has(w.code);
    return {
        code: w.code,
        source: 'parser',
        message: w.message || w.code,
        line: w.line ?? null,
        sceneIdx: w.sceneIdx ?? null,
        elementIdx: w.elementIdx ?? null,
        autoFixable,
        status: autoFixable ? 'fixed' : 'manual',
        original: null,
        fixed: null,
    };
}

/**
 * Classify a single statistics warning.
 * @param {object} w - raw warning from statistics
 * @returns {ClassifiedWarning}
 */
function classifyStatsWarning(w)
{
    const autoFixable = AUTO_FIXABLE_STATS.has(w.code);
    return {
        code: w.code,
        source: 'statistics',
        message: w.message || w.code,
        line: w.line ?? null,
        sceneIdx: w.sceneIdx ?? null,
        elementIdx: w.elementIdx ?? null,
        autoFixable,
        status: autoFixable ? 'fixed' : 'manual',
        original: null,
        fixed: null,
    };
}

/**
 * Classify a single tag warning.
 * @param {object} w - raw warning from the tag classifier
 * @returns {ClassifiedWarning}
 */
function classifyTagWarning(w)
{
    const autoFixable = w.code === 'unknown-tag' && !!w.suggestion;
    const classified = {
        code: w.code,
        source: 'tag',
        message: w.message || w.code,
        line: w.line ?? null,
        sceneIdx: w.sceneIdx ?? null,
        elementIdx: w.elementIdx ?? null,
        autoFixable,
        status: autoFixable ? 'fixed' : 'manual',
        original: null,
        fixed: null,
    };
    if (w.suggestion)
    {
        classified.suggestion = w.suggestion;
    }
    return classified;
}


// ── Public API ──────────────────────────────────────────────────────

/**
 * Classify warnings from all three sources into auto-fixable / manual.
 *
 * @param {object[]} parserWarnings  - warnings from the parser
 * @param {object[]} statsWarnings   - warnings from statistics
 * @param {object[]} tagWarnings     - warnings from the tag classifier
 * @returns {ClassifiedWarning[]}
 */
export function classifyWarnings(parserWarnings = [], statsWarnings = [], tagWarnings = [], formatFixes = [])
{
    const classified = [];
    for (const w of parserWarnings)
    {
        classified.push(classifyParserWarning(w));
    }
    for (const w of statsWarnings)
    {
        classified.push(classifyStatsWarning(w));
    }
    for (const w of tagWarnings)
    {
        classified.push(classifyTagWarning(w));
    }
    for (const f of formatFixes)
    {
        classified.push({
            code: f.code,
            source: f.source || 'format',
            message: f.message || f.code,
            line: f.line ?? null,
            sceneIdx: f.sceneIdx ?? null,
            elementIdx: f.elementIdx ?? null,
            autoFixable: false,
            status: f.status || 'fixed',
            original: f.original ?? null,
            fixed: f.fixed ?? null,
            count: f.count || undefined,
        });
    }
    return classified;
}

/**
 * Apply auto-fixes to tokens in-place. Updates warning status fields.
 *
 * @param {Token[]} tokens   - parsed token array (mutated in-place)
 * @param {ClassifiedWarning[]} warnings - classified warnings from classifyWarnings()
 * @returns {AutoFixResult}
 */
export function applyAutoFixes(tokens, warnings)
{
    let fixedCount = 0;
    let manualCount = 0;

    for (const w of warnings)
    {
        if (!w.autoFixable)
        {
            if (w.source !== 'format')
            {
                w.status = 'manual';
            }
            if (w.status === 'manual')
            {
                manualCount++;
            }
            else
            {
                fixedCount++;
            }
            continue;
        }

        let applied = false;

        switch (w.code)
        {
            case 'WARN_PAGE_LOWERCASE':
            {
                const tok = tokens.find(t => t.line === w.line && t.type === 'scene_heading');
                if (tok)
                {
                    w.original = tok.text;
                    tok.text = tok.text.replace(/^#\s*page\b/i, '# Page');
                    w.fixed = tok.text;
                    applied = true;
                }
                break;
            }

            case 'WARN_PAGE_MISSING_HASH':
            {
                const tok = tokens.find(t => t.line === w.line && t.type === 'scene_heading');
                if (tok)
                {
                    w.original = tok.text;
                    tok.text = '# ' + tok.text;
                    w.fixed = tok.text;
                    applied = true;
                }
                break;
            }

            case 'WARN_ACTION_INDENTED':
            {
                const tok = tokens.find(t => t.line === w.line && t.type === 'action');
                if (tok)
                {
                    w.original = tok.text;
                    tok.text = tok.text.replace(/^\s+/, '');
                    w.fixed = tok.text;
                    applied = true;
                }
                break;
            }

            case 'WARN_LEGACY_PANEL':
            {
                const tok = tokens.find(t => t.line === w.line && t.type === 'panel');
                if (tok)
                {
                    w.original = tok.text;
                    tok.text = tok.text.replace(/^#\s*/, '');
                    w.fixed = tok.text;
                    applied = true;
                }
                break;
            }

            case 'WARN_IMPLICIT_PAGE_1':
            {
                const synthetic = { type: 'scene_heading', text: '# Page 1', line: 0 };
                tokens.unshift(synthetic);
                w.original = null;
                w.fixed = '# Page 1';
                applied = true;
                break;
            }

            case 'UNKNOWN_TOKEN_TYPE':
            {
                const tok = tokens.find(t => t.line === w.line);
                if (tok)
                {
                    w.original = tok.type;
                    tok.type = 'action';
                    w.fixed = 'action';
                    applied = true;
                }
                break;
            }

            case 'unknown-tag':
            {
                if (w.suggestion)
                {
                    const tok = tokens.find(t => t.line === w.line && t.type === 'panel');
                    if (tok)
                    {
                        // Extract the unknown tag from the message or warning
                        // Warning message format: "Unknown tag: [VERT]" or similar
                        const tagMatch = w.message.match(/\[([^\]]+)\]/);
                        if (tagMatch)
                        {
                            w.original = tok.text;
                            tok.text = tok.text.replace(
                                '[' + tagMatch[1] + ']',
                                '[' + w.suggestion + ']'
                            );
                            w.fixed = tok.text;
                            applied = true;
                        }
                    }
                }
                break;
            }
        }

        w.status = applied ? 'fixed' : 'manual';
        if (applied)
        {
            fixedCount++;
        }
        else
        {
            manualCount++;
        }
    }

    return {
        tokens,
        fixedCount,
        manualCount,
        fixes: warnings,
    };
}
