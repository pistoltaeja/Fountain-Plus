import { describe, test, expect } from 'bun:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('bundle size', () =>
{
    test('index.js + analyzers.js combined < 16KB minified', async () =>
    {
        const result = await Bun.build({
            entrypoints: [join(__dirname, '..', 'index.js')],
            minify: true,
            target: 'browser'
        });

        expect(result.success).toBe(true);
        expect(result.outputs.length).toBeGreaterThan(0);

        const output = result.outputs[0];
        const text = await output.text();
        const sizeBytes = text.length;
        const sizeKB = sizeBytes / 1024;

        console.log(`\n--- Bundle Size ---`);
        console.log(`  Minified: ${sizeBytes} bytes (${sizeKB.toFixed(2)} KB)`);

        expect(sizeKB).toBeLessThan(16);
    });
});
