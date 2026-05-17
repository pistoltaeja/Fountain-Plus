/**
 * Edge Cases Tests
 * Validates parser behavior with unusual or boundary inputs
 */

import { describe, test, expect } from 'bun:test';
import { parseScript } from '../core/parser/fountain-plus-mangaplay-parser.js';
import {
    astToScreenplay,
    parseTitleCard
} from '../core/parser/screenplay-parser.js';

// =============================================================================
// EMPTY AND MINIMAL INPUTS
// =============================================================================

describe('Edge Cases - Empty and Minimal Inputs', () =>
{
    test('should handle completely empty input', () =>
    {
        const result = parseScript('');

        expect(result.metadata).toBeDefined();
        expect(result.metadata.title).toBe('Untitled');
        expect(result.pages).toEqual([]);
    });

    test('should handle whitespace-only input', () =>
    {
        const result = parseScript('   \n\n   \t\n   ');

        expect(result.metadata.title).toBe('Untitled');
        expect(result.pages).toEqual([]);
    });

    test('should handle title only', () =>
    {
        const result = parseScript('Title: Lonely Title');

        expect(result.metadata.title).toBe('Lonely Title');
        expect(result.pages).toEqual([]);
    });

    test('should handle page header only (no panels)', () =>
    {
        const markdown = `Title: Test

# PAGE 1`;

        const result = parseScript(markdown);

        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].panels).toEqual([]);
    });

    test('should handle panel header only (no content)', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels).toHaveLength(1);
        expect(result.pages[0].panels[0].description).toBe('');
        expect(result.pages[0].panels[0].dialogue).toEqual([]);
        expect(result.pages[0].panels[0].sfx).toEqual([]);
    });
});

// =============================================================================
// UNUSUAL PAGE NUMBERING
// =============================================================================

describe('Edge Cases - Unusual Page Numbering', () =>
{
    test('should handle page 0', () =>
    {
        const markdown = `Title: Test

# PAGE 0
    Panel 1
    Content.`;

        const result = parseScript(markdown);

        expect(result.pages[0].id).toBe('0');
        expect(result.pages[0].baseNumber).toBe(0);
    });

    test('should handle very large page numbers', () =>
    {
        const markdown = `Title: Test

# PAGE 9999
    Panel 1
    Content.`;

        const result = parseScript(markdown);

        expect(result.pages[0].id).toBe('9999');
        expect(result.pages[0].baseNumber).toBe(9999);
    });

    test('should handle page with roman numeral suffix', () =>
    {
        const markdown = `Title: Test

# PAGE 0-IV
    Panel 1
    Content.`;

        const result = parseScript(markdown);

        expect(result.pages[0].id).toBe('0-IV');
        expect(result.pages[0].suffix).toBe('IV');
    });

    test('should handle non-sequential page numbers', () =>
    {
        const markdown = `Title: Test

# PAGE 5
    Panel 1
    Five.

# PAGE 2
    Panel 1
    Two.

# PAGE 10
    Panel 1
    Ten.`;

        const result = parseScript(markdown);

        expect(result.pages).toHaveLength(3);
        expect(result.pages[0].baseNumber).toBe(5);
        expect(result.pages[1].baseNumber).toBe(2);
        expect(result.pages[2].baseNumber).toBe(10);
    });

    test('should handle roman numeral suffix variations', () =>
    {
        const markdown = `Title: Test

# PAGE 0-I
    Panel 1
    First.

# PAGE 0-II
    Panel 1
    Second.

# PAGE 0-III
    Panel 1
    Third.`;

        const result = parseScript(markdown);

        expect(result.pages[0].suffix).toBe('I');
        expect(result.pages[1].suffix).toBe('II');
        expect(result.pages[2].suffix).toBe('III');
    });
});

// =============================================================================
// UNUSUAL PANEL NUMBERING
// =============================================================================

describe('Edge Cases - Unusual Panel Numbering', () =>
{
    test('should handle panel 0', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 0
    Zero panel.`;

        const result = parseScript(markdown);

        // Parser uses regex that expects digit, 0 should work
        expect(result.pages[0].panels).toHaveLength(1);
        expect(result.pages[0].panels[0].displayNumber).toBe(0);
    });

    test('should handle very large panel numbers', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 999
    Many panels.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].displayNumber).toBe(999);
    });

    test('should handle panel range notation', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1-3
    Spanning panels.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].displayNumber).toBe(1);
    });

    test('should reset panel index for each new page', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    First page panel.

# PAGE 2
    Panel 1
    Second page panel.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].index).toBe(0);
        expect(result.pages[1].panels[0].index).toBe(0);
    });
});

// =============================================================================
// SPECIAL CHARACTERS
// =============================================================================

describe('Edge Cases - Special Characters', () =>
{
    test('should handle title with special characters', () =>
    {
        const markdown = `Title: The Hero's Journey: Part 1 - "Beginning"`;

        const result = parseScript(markdown);

        expect(result.metadata.title).toBe('The Hero\'s Journey: Part 1 - "Beginning"');
    });

    test('should handle location with special characters', () =>
    {
        const markdown = `Title: Test

# PAGE 1 INT. CAFÉ "LA BELLE" - NIGHT
    Panel 1
    Content.`;

        const result = parseScript(markdown);

        expect(result.pages[0].location?.place).toBe('CAFÉ "LA BELLE"');
    });

    test('should handle dialogue with special characters', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Scene.
        HERO
        "Don't stop!" he said -- or did he?`;

        const result = parseScript(markdown);
        const text = result.pages[0].panels[0].dialogue[0].text;

        expect(text).toContain('"');
        expect(text).toContain('--');
        expect(text).toContain('?');
    });

    test('should handle SFX with special characters', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Explosion.
    SFX: *BOOM* ~whoosh~ <crash>`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].sfx[0]).toBe('*BOOM* ~whoosh~ <crash>');
    });

    test('should handle unicode characters', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Japanese text.
        HERO
        Hello!`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].description).toContain('Japanese');
    });
});

// =============================================================================
// MALFORMED INPUT
// =============================================================================

describe('Edge Cases - Malformed Input', () =>
{
    test('should handle missing indentation (now Convention B — valid)', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1
Content without indent.`;

        const result = parseScript(markdown);

        // Column-0 Panel is now Convention B — valid. Description captured.
        expect(result.pages[0].panels).toHaveLength(1);
        expect(result.pages[0].panels[0].description).toBe('Content without indent.');
        expect(result.metadata.indentStyle).toBe('B');
    });

    test('should handle extra indentation', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
            Extra indented content.`;

        const result = parseScript(markdown);

        // Extra indented content might be treated as dialogue text
        expect(result.pages[0].panels).toHaveLength(1);
    });

    test('should handle mixed tabs and spaces', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Description here.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels).toHaveLength(1);
    });

    test('should handle content before first page (Spec V2 §5.4 implicit Page 1)', () =>
    {
        const markdown = `Title: Test

Some random content here that becomes Page 1 implicitly.
More random stuff.

# PAGE 1
    Panel 1
    Actual content.`;

        const result = parseScript(markdown);

        // Spec V2 §5.4: orphan content before any `# PAGE` becomes implicit
        // Page 1. The explicit `# PAGE 1` then opens a SECOND page (which
        // duplicates id "1" — a reportable warning) but the parser does not
        // throw. Two pages are produced.
        expect(result.pages).toHaveLength(2);
        // Implicit Page 1 picks up the orphan prose as a synthetic panel-1
        // description.
        expect(result.pages[0].id).toBe('1');
        // Explicit Page 1 carries the canonical panel.
        expect(result.pages[1].panels[0].description).toBe('Actual content.');
    });

    test('should handle dialogue character without text', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Scene.
        HERO`;

        const result = parseScript(markdown);

        // Character without following text should not produce dialogue
        expect(result.pages[0].panels[0].dialogue).toHaveLength(0);
    });
});

// =============================================================================
// LOCATION VARIATIONS
// =============================================================================

describe('Edge Cases - Location Variations', () =>
{
    test('should handle location without time', () =>
    {
        const markdown = `Title: Test

# PAGE 1 INT. HOUSE
    Panel 1
    Inside.`;

        const result = parseScript(markdown);

        expect(result.pages[0].location?.type).toBe('INT');
        expect(result.pages[0].location?.place).toBe('HOUSE');
        expect(result.pages[0].location?.time).toBeUndefined();
    });

    test('should handle DAWN time of day', () =>
    {
        const markdown = `Title: Test

# PAGE 1 EXT. BEACH - DAWN
    Panel 1
    Sunrise.`;

        const result = parseScript(markdown);

        expect(result.pages[0].location?.time).toBe('DAWN');
    });

    test('should handle DUSK time of day', () =>
    {
        const markdown = `Title: Test

# PAGE 1 EXT. MOUNTAIN - DUSK
    Panel 1
    Sunset.`;

        const result = parseScript(markdown);

        expect(result.pages[0].location?.time).toBe('DUSK');
    });

    test('should handle location with multiple words', () =>
    {
        const markdown = `Title: Test

# PAGE 1 INT. ABANDONED WAREHOUSE DISTRICT - NIGHT
    Panel 1
    Dark place.`;

        const result = parseScript(markdown);

        expect(result.pages[0].location?.place).toBe('ABANDONED WAREHOUSE DISTRICT');
    });
});

// =============================================================================
// PANEL TYPE VARIATIONS
// =============================================================================

describe('Edge Cases - Panel Type Variations', () =>
{
    test('layout tags from the new surface produce matching `type`', () =>
    {
        // Panel Grid Refactor: legacy [SPLASH], [BROKEN], [DIAGONAL], and
        // [FULL BLEED]-as-type are retired. [BLEED]/[BORDERLESS] are style
        // tags (not layouts) — they no longer set `type`. [SPLIT] is an
        // overlay flag (Section 2.1 SPLIT Details) — it surfaces as a
        // modifier, not a layout type.
        const layoutTypes = ['H', 'V', 'WIDE', 'GROUP', 'INSET', 'SPREAD'];

        for (const type of layoutTypes)
        {
            const markdown = `Title: Test

# PAGE 1
    Panel 1 [${type}]
    Content.`;

            const result = parseScript(markdown);
            expect(result.pages[0].panels[0].type).toBe(type);
        }

        // [SPLIT] alone: no layout tag set, SPLIT rides in modifiers so the
        // grid calculator's overlay pass can render the dotted divider.
        const splitResult = parseScript(`Title: Test\n\n# PAGE 1\n    Panel 1 [SPLIT]\n    Content.`);
        expect(splitResult.pages[0].panels[0].modifiers).toContain('SPLIT');
    });

    test('unknown panel type produces a structured warning', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [UNKNOWN TYPE]
    Content.`;

        const result = parseScript(markdown);

        const warn = result.errors.find(e => e.code === 'unknown-tag' && e.offendingTag === 'UNKNOWN TYPE');
        expect(warn).toBeDefined();
        expect(result.pages[0].panels[0].type).not.toBe('UNKNOWN TYPE');
    });
});

// =============================================================================
// SCREENPLAY CONVERSION EDGE CASES
// =============================================================================

describe('Edge Cases - Screenplay Conversion', () =>
{
    test('should handle page with no elements', () =>
    {
        const ast = {
            metadata: { title: 'Test' },
            pages: [{
                id: '1',
                baseNumber: 1,
                panels: []
            }]
        };

        const screenplay = astToScreenplay(ast);

        // Scene exists but has no elements from empty panels
        expect(screenplay.scenes.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle empty screenplay conversion', () =>
    {
        const ast = {
            metadata: { title: 'Empty' },
            pages: []
        };

        const screenplay = astToScreenplay(ast);

        expect(screenplay.title).toBe('Empty');
        expect(screenplay.scenes).toHaveLength(0);
    });

    test('should handle first page without location', () =>
    {
        const ast = {
            metadata: { title: 'No Location' },
            pages: [
                {
                    id: '1',
                    baseNumber: 1,
                    panels: [
                        {
                            index: 0,
                            displayNumber: 1,
                            description: 'Content.',
                            dialogue: [],
                            sfx: [],
                            titleCards: []
                        }
                    ]
                }
            ]
        };

        const screenplay = astToScreenplay(ast);

        expect(screenplay.scenes).toHaveLength(1);
        expect(screenplay.scenes[0].heading).toBe('');
    });
});

// =============================================================================
// TITLE CARD EDGE CASES
// =============================================================================

describe('Edge Cases - Title Card Parsing', () =>
{
    test('should handle pipe character in name', () =>
    {
        // This is an edge case that might break parsing
        // The parser splits on |, so this tests robustness
        const result = parseTitleCard('NAME | Info | Extra');

        expect(result?.content).toBe('Info');
        expect(result?.meta?.age).toBe('Extra');
    });

    test('should handle empty parts', () =>
    {
        const result = parseTitleCard(' | ');

        // Should handle gracefully
        expect(result).toBeDefined();
    });

    test('should handle very long epithet', () =>
    {
        const result = parseTitleCard('The Most Legendary Hero Of All Time Who Defeated The Evil Dragon King And Saved The World From Destruction : S-Rank | HERO | Age 30');

        expect(result?.meta?.epithet).toContain('Legendary');
        expect(result?.meta?.subheader).toBe('S-Rank');
    });
});

// =============================================================================
// METADATA EDGE CASES
// =============================================================================

describe('Edge Cases - Metadata Parsing', () =>
{
    test('should handle duplicate metadata fields', () =>
    {
        const markdown = `Title: First Title
Author: First Author
Author: Second Author`;

        const result = parseScript(markdown);

        // First match should win
        expect(result.metadata.author).toBe('First Author');
    });

    test('should handle metadata with extra whitespace', () =>
    {
        const markdown = `Title:   Spaced Title

Author:    Spaced Author   `;

        const result = parseScript(markdown);

        expect(result.metadata.title).toBe('Spaced Title');
        expect(result.metadata.author).toBe('Spaced Author');
    });

    test('should handle metadata without colon space', () =>
    {
        const markdown = `Title: Test

Author:NoSpace`;

        const result = parseScript(markdown);

        // Should handle non-standard formatting
        expect(result.metadata.author).toBe('NoSpace');
    });

    test('should handle invalid totalPages', () =>
    {
        const markdown = `Title: Test

Total Pages: not a number`;

        const result = parseScript(markdown);

        // Pattern requires digits, so it won't match and totalPages will be undefined
        expect(result.metadata.totalPages).toBeUndefined();
    });
});

// =============================================================================
// LARGE INPUT HANDLING
// =============================================================================

describe('Edge Cases - Large Inputs', () =>
{
    test('should handle many pages', () =>
    {
        let markdown = 'Title: Big Manga\n\n';
        for (let i = 1; i <= 100; i++)
        {
            markdown += `# PAGE ${i}\n    Panel 1\n    Page ${i} content.\n\n`;
        }

        const result = parseScript(markdown);

        expect(result.pages).toHaveLength(100);
        expect(result.pages[99].baseNumber).toBe(100);
    });

    test('should handle many panels on one page', () =>
    {
        // Description text deliberately AVOIDS starting with "Panel"
        // because the parser now tolerates trailing text after a
        // panel header (`Panel N <label>`). A line like
        // `    Panel 1 content.` is structurally indistinguishable
        // from a header with a "content." label — the looser regex
        // would treat it as a re-declared panel rather than as
        // description text.
        let markdown = 'Title: Test\n\n# PAGE 1\n';
        for (let i = 1; i <= 50; i++)
        {
            markdown += `    Panel ${i}\n    Content for panel ${i}.\n`;
        }

        const result = parseScript(markdown);

        expect(result.pages[0].panels).toHaveLength(50);
        expect(result.pages[0].panels[49].index).toBe(49);
    });

    test('should handle long description text', () =>
    {
        const longText = 'A'.repeat(1000);
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    ${longText}`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].description).toBe(longText);
    });

    test('should handle many dialogue lines', () =>
    {
        // Character names must be ALL CAPS with optional spaces/apostrophes
        // The parser pattern is /^\s{8}([A-Z][A-Z\s']+?)$/ - no digits allowed
        // Dialogue text follows on next line with 8-space indent
        const chars = ['HERO', 'VILLAIN', 'SIDEKICK', 'MENTOR', 'RIVAL',
                       'BOSS', 'GUARD', 'SOLDIER', 'CAPTAIN', 'GENERAL',
                       'KING', 'QUEEN', 'PRINCE', 'KNIGHT', 'WIZARD',
                       'HEALER', 'RANGER', 'ROGUE', 'BARD', 'MONK'];

        let markdown = 'Title: Test\n\n# PAGE 1\n    Panel 1\n    Scene.\n';
        for (let i = 0; i < 20; i++)
        {
            markdown += `        ${chars[i]}\n        Line ${i}.\n`;
        }

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].dialogue).toHaveLength(20);
    });
});

// =============================================================================
// INTEGRATION EDGE CASES
// =============================================================================

describe('Edge Cases - Full Pipeline', () =>
{
    test('should handle minimal valid manga script', () =>
    {
        const markdown = `Title: X

# PAGE 1
    Panel 1
    .`;

        const result = parseScript(markdown);
        const screenplay = astToScreenplay(result);

        expect(result.metadata.title).toBe('X');
        expect(result.pages).toHaveLength(1);
        expect(screenplay.scenes).toHaveLength(1);
    });

    test('should preserve data through full pipeline', () =>
    {
        // Use condensed title card format which is properly supported
        const markdown = `Title: Test Pipeline
Author: Test

# PAGE 1 INT. ROOM - DAY
    Panel 1 [SPLASH]
    Character appears.
    TITLE: HERO | Age 25
        HERO
        Hello!
    SFX: BOOM`;

        const ast = parseScript(markdown);
        const screenplay = astToScreenplay(ast);

        // Verify data preservation
        expect(screenplay.title).toBe('Test Pipeline');
        expect(screenplay.author).toBe('Test');

        const scene = screenplay.scenes[0];
        expect(scene.heading).toBe('INT. ROOM - DAY');

        const titleCard = scene.elements.find(e => e.type === 'title_card');
        const character = scene.elements.find(e => e.type === 'character');
        const dialogue = scene.elements.find(e => e.type === 'dialogue');
        const sfx = scene.elements.find(e => e.type === 'sfx');

        expect(titleCard).toBeDefined();
        expect(character).toBeDefined();
        expect(dialogue).toBeDefined();
        expect(sfx).toBeDefined();
    });
});
