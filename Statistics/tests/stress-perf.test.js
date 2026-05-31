import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStatistics, computeOutline, computeCharacters, computeLocations, computeDuration, computeLength, computeReadability } from '../index.js';
import { simpleTokenize } from './test-tokenizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

const SIZES = ['50k', '100k', '500k'];
const BUDGETS = {
    '50k': { timeMs: 50, heapDeltaMB: 10 },
    '100k': { timeMs: 100, heapDeltaMB: 20 },
    '500k': { timeMs: 500, heapDeltaMB: 80 }
};

const FUNCTIONS = [
    { name: 'computeStatistics', fn: computeStatistics },
    { name: 'computeOutline', fn: computeOutline },
    { name: 'computeCharacters', fn: computeCharacters },
    { name: 'computeLocations', fn: computeLocations },
    { name: 'computeDuration', fn: computeDuration },
    { name: 'computeLength', fn: computeLength },
    { name: 'computeReadability', fn: computeReadability }
];

for (const size of SIZES)
{
    describe(`stress-perf ${size}`, () =>
    {
        describe('fountain', () =>
        {
            const raw = readFileSync(join(FIXTURES, `stress-fountain-${size}.fountain`), 'utf8');
            const tokens = simpleTokenize(raw, false);
            const hasTitlePage = /^[A-Za-z]+\s*:/.test(raw.split('\n')[0] || '');

            const results = [];

            for (const { name, fn } of FUNCTIONS)
            {
                test(name, () =>
                {
                    Bun.gc(true);
                    const heapBefore = process.memoryUsage().heapUsed;
                    const t0 = performance.now();

                    const result = fn(tokens, { isMangaplay: false, hasTitlePage });

                    const t1 = performance.now();
                    const heapAfter = process.memoryUsage().heapUsed;

                    const timeMs = t1 - t0;
                    const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

                    results.push({ name, timeMs: timeMs.toFixed(2), heapDeltaMB: heapDeltaMB.toFixed(2) });

                    expect(result).toBeDefined();

                    // Budget assertions only for computeStatistics
                    if (name === 'computeStatistics')
                    {
                        const budget = BUDGETS[size];
                        expect(timeMs).toBeLessThan(budget.timeMs);
                        expect(heapDeltaMB).toBeLessThan(budget.heapDeltaMB);
                    }
                });
            }

            test('summary table (fountain)', () =>
            {
                console.log(`\n--- Fountain ${size} Performance ---`);
                console.table(results);
            });
        });

        describe('mangaplay', () =>
        {
            const raw = readFileSync(join(FIXTURES, `stress-mangaplay-${size}.mangaplay.md`), 'utf8');
            const tokens = simpleTokenize(raw, true);
            const hasTitlePage = /^[A-Za-z]+\s*:/.test(raw.split('\n')[0] || '');

            const results = [];

            for (const { name, fn } of FUNCTIONS)
            {
                test(name, () =>
                {
                    const options = { isMangaplay: true, hasTitlePage };
                    Bun.gc(true);
                    const heapBefore = process.memoryUsage().heapUsed;
                    const t0 = performance.now();

                    const result = fn(tokens, options);

                    const t1 = performance.now();
                    const heapAfter = process.memoryUsage().heapUsed;

                    const timeMs = t1 - t0;
                    const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

                    results.push({ name, timeMs: timeMs.toFixed(2), heapDeltaMB: heapDeltaMB.toFixed(2) });

                    expect(result).toBeDefined();

                    // Budget assertions only for computeStatistics
                    if (name === 'computeStatistics')
                    {
                        const budget = BUDGETS[size];
                        expect(timeMs).toBeLessThan(budget.timeMs);
                        expect(heapDeltaMB).toBeLessThan(budget.heapDeltaMB);
                    }
                });
            }

            test('summary table (mangaplay)', () =>
            {
                console.log(`\n--- Mangaplay ${size} Performance ---`);
                console.table(results);
            });
        });
    });
}
