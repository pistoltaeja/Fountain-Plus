/**
 * Dorothy Sample - Line Number Tests
 * Verifies that parser errors report line numbers matching the source file.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseScript } from '../core/parser/fountain-plus-mangaplay-parser.js';
import { formatMangaplay } from '../core/formatter/mangaplay-formatter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = join(__dirname, '..', 'extension-mangaplay-spec', 'mangaplay', 'sample', 'dorothy.mangaplay');

describe('Dorothy sample - parser line numbers', () =>
{
    const content = readFileSync(SAMPLE_PATH, 'utf-8');
    const lines = content.split('\n');

    // Panel Grid Refactor: [SMALL] retired in favour of [S]. The sample file
    // is rewritten by the [SAMPLES] worker (see TODO/PANEL_GRID_REFACTOR.md
    // Section 5.3). Until then, the sample still contains [SMALL] and the
    // parser correctly surfaces unknown-tag warnings for it.
    test('[SMALL] is reported as unknown with suggestion [S]', () =>
    {
        const result = parseScript(content);
        const smallWarnings = (result.errors || []).filter(
            e => e.code === 'unknown-tag' && e.offendingTag === 'SMALL'
        );

        const actualSmallLines = [];
        lines.forEach((line, idx) =>
        {
            if (line.includes('[SMALL]')) actualSmallLines.push(idx);
        });

        if (actualSmallLines.length > 0)
        {
            expect(smallWarnings.length).toBe(actualSmallLines.length);
            for (const w of smallWarnings) expect(w.suggestion).toBe('S');
        }
    });

    test('every reported error line points to content matching its message', () =>
    {
        const result = parseScript(content);

        for (const err of (result.errors || []))
        {
            const sourceLine = lines[err.line];
            expect(sourceLine).toBeDefined();

            // Extract the bracketed tag from the message if present
            const tagMatch = err.message.match(/\[([^\]]+)\]/);
            if (tagMatch)
            {
                const tag = tagMatch[0]; // includes brackets
                expect(
                    sourceLine.includes(tag),
                    `Error at line ${err.line} reports "${err.message}" but source line is: "${sourceLine}"`
                ).toBe(true);
            }
        }
    });

    test('line indexes stay 0-based and within bounds', () =>
    {
        const result = parseScript(content);

        for (const err of (result.errors || []))
        {
            expect(err.line).toBeGreaterThanOrEqual(0);
            expect(err.line).toBeLessThan(lines.length);
        }
    });

});
