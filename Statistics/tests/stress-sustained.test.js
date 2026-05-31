import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStatistics } from '../index.js';
import { simpleTokenize } from './test-tokenizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

function runSustainedTest(tokens, options, label)
{
    // Warmup: 20 iterations to fully stabilize JIT + hidden classes
    for (let i = 0; i < 20; i++) { computeStatistics(tokens, options); }

    // Batch 1: 5 seconds — establish steady-state heap
    Bun.gc(true);
    Bun.gc(true);
    let iterations1 = 0;
    const start1 = performance.now();
    while (performance.now() - start1 < 5_000)
    {
        computeStatistics(tokens, options);
        iterations1++;
    }
    Bun.gc(true);
    Bun.gc(true);
    const heapAfterBatch1 = process.memoryUsage().heapUsed;

    // Batch 2: another 5 seconds — if no leak, heap shouldn't grow
    let iterations2 = 0;
    const start2 = performance.now();
    while (performance.now() - start2 < 5_000)
    {
        computeStatistics(tokens, options);
        iterations2++;
    }
    const elapsed = (performance.now() - start1);
    const totalIterations = iterations1 + iterations2;
    Bun.gc(true);
    Bun.gc(true);
    const heapAfterBatch2 = process.memoryUsage().heapUsed;

    const effectiveCharsPerSecond = (500_000 * totalIterations) / (elapsed / 1000);
    const avgTimePerIteration = elapsed / totalIterations;
    const growthRatio = heapAfterBatch2 / heapAfterBatch1;

    console.log(`\n--- ${label} Sustained (10s) ---`);
    console.log(`  Total iterations: ${totalIterations} (batch1: ${iterations1}, batch2: ${iterations2})`);
    console.log(`  Effective chars/sec: ${(effectiveCharsPerSecond / 1_000_000).toFixed(2)}M`);
    console.log(`  Avg ms/iteration: ${avgTimePerIteration.toFixed(2)}`);
    console.log(`  Heap after batch 1: ${(heapAfterBatch1 / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Heap after batch 2: ${(heapAfterBatch2 / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Growth ratio (batch2/batch1): ${growthRatio.toFixed(4)}`);

    return { totalIterations, effectiveCharsPerSecond, avgTimePerIteration, growthRatio, heapAfterBatch1, heapAfterBatch2 };
}

describe('stress-sustained 500k x 10s', () =>
{
    test('fountain 500k sustained — no unbounded leak', () =>
    {
        const raw = readFileSync(join(FIXTURES, 'stress-fountain-500k.fountain'), 'utf8');
        const tokens = simpleTokenize(raw, false);

        const { growthRatio, heapAfterBatch2 } = runSustainedTest(tokens, { isMangaplay: false, hasTitlePage: false }, 'Fountain 500k');

        // Heap should not grow between batch1 and batch2 (proves no leak)
        // Allow 20% tolerance for GC timing jitter
        expect(growthRatio).toBeLessThanOrEqual(1.20);

        // Absolute cap: heap should never exceed 200MB for 500k doc processing
        expect(heapAfterBatch2 / (1024 * 1024)).toBeLessThan(200);
    }, 30_000);

    test('mangaplay 500k sustained — no unbounded leak', () =>
    {
        const raw = readFileSync(join(FIXTURES, 'stress-mangaplay-500k.mangaplay.md'), 'utf8');
        const tokens = simpleTokenize(raw, true);

        const { growthRatio, heapAfterBatch2 } = runSustainedTest(tokens, { isMangaplay: true, hasTitlePage: false }, 'Mangaplay 500k');

        // Heap should not grow between batch1 and batch2 (proves no leak)
        expect(growthRatio).toBeLessThanOrEqual(1.20);

        // Absolute cap
        expect(heapAfterBatch2 / (1024 * 1024)).toBeLessThan(200);
    }, 30_000);
});
