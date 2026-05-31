import { describe, test, expect } from 'bun:test';
import { computeStatistics } from '../index.js';
import { simpleTokenize } from './test-tokenizer.js';

/**
 * Generate a large fountain document by repeating scenes until target char count.
 * @param {number} targetChars
 * @returns {string}
 */
function generateLargeDoc(targetChars)
{
    let doc = '';
    let i = 0;
    const chars = ['ALICE', 'BOB', 'CHARLIE', 'DIANA', 'ETHAN'];
    const dialogue = "I never thought we would end up here. After everything that happened, it feels like a lifetime ago. You don't get to decide that for me anymore.";

    while (doc.length < targetChars)
    {
        doc += `INT. LOCATION ${i} - DAY\n\n`;
        doc += `A tense silence fills the room.\n\n`;
        for (let d = 0; d < 5; d++)
        {
            doc += `${chars[d]}\n${dialogue}\n\n`;
        }
        i++;
    }
    return doc;
}

/**
 * Generate a large mangaplay document by repeating pages/panels until target char count.
 * @param {number} targetChars
 * @returns {string}
 */
function generateLargeMangaplay(targetChars)
{
    let doc = '';
    let page = 0;
    const chars = ['ALICE', 'BOB', 'CHARLIE', 'DIANA', 'ETHAN'];
    const dialogue = "I never thought we would end up here. After everything that happened, it feels like a lifetime ago. You don't get to decide that for me anymore.";

    while (doc.length < targetChars)
    {
        page++;
        doc += `# PAGE ${page}\n\n`;
        doc += `INT. LOCATION ${page} - DAY\n\n`;
        for (let p = 1; p <= 4; p++)
        {
            doc += `Panel ${p}\n\n`;
            doc += `A tense silence fills the room.\n\n`;
            const c = chars[p % chars.length];
            doc += `${c}\n${dialogue}\n\n`;
        }
    }
    return doc;
}

describe('stress-extreme 1M characters', () =>
{
    test('fountain 1M', () =>
    {
        const doc = generateLargeDoc(1_000_000);
        expect(doc.length).toBeGreaterThanOrEqual(1_000_000);

        const tokens = simpleTokenize(doc, false);

        Bun.gc(true);
        const heapBefore = process.memoryUsage().heapUsed;
        const t0 = performance.now();

        const result = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });

        const t1 = performance.now();
        const heapAfter = process.memoryUsage().heapUsed;

        const timeMs = t1 - t0;
        const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

        console.log(`\n--- Fountain 1M Extreme ---`);
        console.log(`  Tokens: ${tokens.length}`);
        console.log(`  Time: ${timeMs.toFixed(2)} ms`);
        console.log(`  Heap delta: ${heapDeltaMB.toFixed(2)} MB`);

        expect(timeMs).toBeLessThan(1500);
        expect(heapDeltaMB).toBeLessThan(150);

        // Verify result structure
        expect(result.outline).toBeArray();
        expect(result.characters).toBeArray();
        expect(result.characters.length).toBeGreaterThan(0);
        expect(result.locations).toBeArray();
        expect(result.locations.length).toBeGreaterThan(0);
        expect(result.duration).toBeDefined();
        expect(result.duration.totalSeconds).toBeGreaterThan(0);
        expect(result.length).toBeDefined();
        expect(result.length.words).toBeGreaterThan(0);
        expect(result.readability).toBeDefined();
    });

    test('mangaplay 1M', () =>
    {
        const doc = generateLargeMangaplay(1_000_000);
        expect(doc.length).toBeGreaterThanOrEqual(1_000_000);

        const tokens = simpleTokenize(doc, true);

        Bun.gc(true);
        const heapBefore = process.memoryUsage().heapUsed;
        const t0 = performance.now();

        const result = computeStatistics(tokens, { isMangaplay: true, hasTitlePage: false });

        const t1 = performance.now();
        const heapAfter = process.memoryUsage().heapUsed;

        const timeMs = t1 - t0;
        const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

        console.log(`\n--- Mangaplay 1M Extreme ---`);
        console.log(`  Tokens: ${tokens.length}`);
        console.log(`  Time: ${timeMs.toFixed(2)} ms`);
        console.log(`  Heap delta: ${heapDeltaMB.toFixed(2)} MB`);

        expect(timeMs).toBeLessThan(1500);
        expect(heapDeltaMB).toBeLessThan(150);

        // Verify result structure
        expect(result.outline).toBeArray();
        expect(result.characters).toBeArray();
        expect(result.characters.length).toBeGreaterThan(0);
        expect(result.locations).toBeArray();
        expect(result.locations.length).toBeGreaterThan(0);
        expect(result.duration).toBeDefined();
        expect(result.duration.totalSeconds).toBeGreaterThan(0);
        expect(result.length).toBeDefined();
        expect(result.length.panels).toBeGreaterThan(0);
        expect(result.readability).toBeDefined();
    });
});
