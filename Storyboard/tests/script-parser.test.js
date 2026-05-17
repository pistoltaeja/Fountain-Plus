/**
 * Script Parser Tests
 * Validates the core script parsing functionality
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseScript } from '../core/parser/fountain-plus-mangaplay-parser.js';
import { formatMangaplay } from '../core/formatter/mangaplay-formatter.js';
import { detectFormat } from '../core/format-detector.js';

// =============================================================================
// MARKDOWN METADATA PARSING
// =============================================================================

describe('parseScript - Markdown Metadata', () =>
{
    test('should parse full metadata (all fields present)', () =>
    {
        const markdown = `Title: Enemy of the State: The Boy Named Dorothy

Author: Pistol Taeja
Genre: Seinen, Dark Fantasy
Format: Manga
Pages: 66
Status: In Progress

# PAGE 1
    Panel 1
    Test content.`;

        const result = parseScript(markdown);

        expect(result.metadata.title).toBe('Enemy of the State: The Boy Named Dorothy');
        expect(result.metadata.author).toBe('Pistol Taeja');
        expect(result.metadata.genre).toBe('Seinen, Dark Fantasy');
        expect(result.metadata.format).toBe('Manga');
        expect(result.metadata.totalPages).toBe(66);
        expect(result.metadata.status).toBe('In Progress');
    });

    test('should parse partial metadata (some fields missing, defaults applied)', () =>
    {
        const markdown = `Title: My Manga

Author: Jane Doe

# PAGE 1
    Panel 1
    Test.`;

        const result = parseScript(markdown);

        expect(result.metadata.title).toBe('My Manga');
        expect(result.metadata.author).toBe('Jane Doe');
        expect(result.metadata.genre).toBeUndefined();
        expect(result.metadata.format).toBeUndefined();
        expect(result.metadata.totalPages).toBe(1); // auto-counted
        expect(result.metadata.status).toBeUndefined();
    });

    test('should parse no metadata at all (just page content)', () =>
    {
        const markdown = `# PAGE 1
    Panel 1
    Content without metadata.`;

        const result = parseScript(markdown);

        expect(result.metadata.title).toBe('Untitled');
        expect(result.metadata.author).toBeUndefined();
        expect(result.metadata.totalPages).toBe(1); // auto-counted
        expect(result.pages).toHaveLength(1);
    });

    test('should parse empty file without errors', () =>
    {
        const result = parseScript('');

        expect(result.metadata.title).toBe('Untitled');
        expect(result.metadata.author).toBeUndefined();
        expect(result.metadata.genre).toBeUndefined();
        expect(result.metadata.format).toBeUndefined();
        expect(result.metadata.totalPages).toBeUndefined();
        expect(result.metadata.status).toBeUndefined();
        expect(result.pages).toHaveLength(0);
        expect(result.readingDirection).toBe('LTR');
    });

    test('should auto-count pages when Pages field omitted', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    First.

# PAGE 2
    Panel 1
    Second.

# PAGE 3
    Panel 1
    Third.`;

        const result = parseScript(markdown);

        expect(result.metadata.totalPages).toBe(3);
    });

    test('should use explicit Pages value over auto-count', () =>
    {
        const markdown = `Title: Test

Pages: 66

# PAGE 1
    Panel 1
    First.`;

        const result = parseScript(markdown);

        expect(result.metadata.totalPages).toBe(66);
    });

    test('should handle metadata only (no pages)', () =>
    {
        const markdown = `Title: Just A Title

Author: Someone`;

        const result = parseScript(markdown);

        expect(result.metadata.title).toBe('Just A Title');
        expect(result.metadata.author).toBe('Someone');
        expect(result.pages).toHaveLength(0);
    });
});

// =============================================================================
// READING DIRECTION
// =============================================================================

describe('parseScript - Reading Direction', () =>
{
    test('should derive RTL from Manga format', () =>
    {
        const markdown = `Title: Test
Format: Manga`;

        const result = parseScript(markdown);

        expect(result.metadata.format).toBe('Manga');
        expect(result.readingDirection).toBe('RTL');
    });

    test('should derive LTR from Comic format', () =>
    {
        const markdown = `Title: Test
Format: Comic`;

        const result = parseScript(markdown);

        expect(result.metadata.format).toBe('Comic');
        expect(result.readingDirection).toBe('LTR');
    });

    test('should default to LTR when format unspecified', () =>
    {
        const markdown = `Title: Test`;

        const result = parseScript(markdown);

        expect(result.readingDirection).toBe('LTR');
    });
});

// =============================================================================
// PAGE PARSING
// =============================================================================

describe('parseScript - Pages', () =>
{
    test('should parse a single page', () =>
    {
        const markdown = `Title: Test Manga

# PAGE 1
    Panel 1
    A character stands alone.`;

        const result = parseScript(markdown);

        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].id).toBe('1');
        expect(result.pages[0].baseNumber).toBe(1);
    });

    test('should parse page with location', () =>
    {
        const markdown = `Title: Test

# PAGE 1 INT. COFFEE SHOP - DAY
    Panel 1
    Interior of a coffee shop.`;

        const result = parseScript(markdown);

        expect(result.pages[0].location).toBeDefined();
        expect(result.pages[0].location?.type).toBe('INT');
        expect(result.pages[0].location?.place).toBe('COFFEE SHOP');
        expect(result.pages[0].location?.time).toBe('DAY');
    });

    test('should parse page with exterior location', () =>
    {
        const markdown = `Title: Test

# PAGE 2 EXT. CITY STREET - NIGHT
    Panel 1
    Dark city street.`;

        const result = parseScript(markdown);

        expect(result.pages[0].location?.type).toBe('EXT');
        expect(result.pages[0].location?.place).toBe('CITY STREET');
        expect(result.pages[0].location?.time).toBe('NIGHT');
    });

    test('should parse page with suffix (page 10-1)', () =>
    {
        const markdown = `Title: Test

# PAGE 10-1
    Panel 1
    First panel.`;

        const result = parseScript(markdown);

        expect(result.pages[0].id).toBe('10-1');
        expect(result.pages[0].baseNumber).toBe(10);
        expect(result.pages[0].suffix).toBe('1');
    });

    test('should parse cover page (0-COVER)', () =>
    {
        const markdown = `Title: Test

# PAGE 0-COVER
    Panel 1
    Cover image.`;

        const result = parseScript(markdown);

        expect(result.pages[0].id).toBe('0-COVER');
        expect(result.pages[0].baseNumber).toBe(0);
        expect(result.pages[0].suffix).toBe('COVER');
    });

    test('should parse roman numeral page (0-I)', () =>
    {
        const markdown = `Title: Test

# PAGE 0-I
    Panel 1
    Intro page.`;

        const result = parseScript(markdown);

        expect(result.pages[0].id).toBe('0-I');
        expect(result.pages[0].baseNumber).toBe(0);
        expect(result.pages[0].suffix).toBe('I');
    });

    test('should parse multiple pages', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Page one content.

# PAGE 2
    Panel 1
    Page two content.

# PAGE 3
    Panel 1
    Page three content.`;

        const result = parseScript(markdown);

        expect(result.pages).toHaveLength(3);
        expect(result.pages[0].id).toBe('1');
        expect(result.pages[1].id).toBe('2');
        expect(result.pages[2].id).toBe('3');
    });
});

// =============================================================================
// PANEL PARSING
// =============================================================================

describe('parseScript - Panels', () =>
{
    test('should parse a single panel', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    A hero stands ready.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels).toHaveLength(1);
        expect(result.pages[0].panels[0].index).toBe(0);
        expect(result.pages[0].panels[0].displayNumber).toBe(1);
        expect(result.pages[0].panels[0].description).toBe('A hero stands ready.');
    });

    test('should parse multiple panels', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    First panel description.

    Panel 2
    Second panel description.

    Panel 3
    Third panel description.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels).toHaveLength(3);
        expect(result.pages[0].panels[0].index).toBe(0);
        expect(result.pages[0].panels[1].index).toBe(1);
        expect(result.pages[0].panels[2].index).toBe(2);
    });

    test('should parse panel with type [SPLASH]', () =>
    {
        // Panel Grid Refactor: [SPLASH] removed — [SPREAD] is canonical.
        // Parser now treats [SPLASH] as an unknown tag with a suggestion to
        // use [SPREAD]. See TODO/PANEL_GRID_REFACTOR.md Section 5.1.
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [SPLASH]
    Full page splash panel.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].type).not.toBe('SPLASH');
        const unknown = result.errors.find(e => e.code === 'unknown-tag' && e.offendingTag === 'SPLASH');
        expect(unknown).toBeDefined();
        expect(unknown.suggestion).toBe('SPREAD');
    });

    test('should parse panel with type [SPREAD]', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [SPREAD]
    Wide panel across the page.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].type).toBe('SPREAD');
    });

    test('should parse panel with type [INSET]', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [INSET]
    Small inset panel.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].type).toBe('INSET');
    });

    test('should parse panel with type [FULL BLEED] (alias of [BLEED])', () =>
    {
        // Panel Grid Refactor: [FULL BLEED] is a silent alias of [BLEED].
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [FULL BLEED]
    Panel extends to page edge.`;

        const result = parseScript(markdown);

        // Canonicalised to BLEED; no longer surfaces the original alias.
        const panel = result.pages[0].panels[0];
        expect(panel.modifiers).toContain('BLEED');
    });

    test('should parse multi-line panel description', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    A warrior stands at the edge of a cliff.
    The wind blows through their hair.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].description).toContain('warrior stands');
        expect(result.pages[0].panels[0].description).toContain('wind blows');
    });

    test('should correctly assign sequential index even with duplicate display numbers', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    First panel.

    Panel 1
    Duplicate panel number.

    Panel 3
    Gap in numbering.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels).toHaveLength(3);
        expect(result.pages[0].panels[0].index).toBe(0);
        expect(result.pages[0].panels[0].displayNumber).toBe(1);
        expect(result.pages[0].panels[1].index).toBe(1);
        expect(result.pages[0].panels[1].displayNumber).toBe(1);
        expect(result.pages[0].panels[2].index).toBe(2);
        expect(result.pages[0].panels[2].displayNumber).toBe(3);
    });
});

// =============================================================================
// PANEL HEADERS WITH TRAILING TEXT
// =============================================================================

describe('parseScript - Panel header trailing text (natural-writing labels)', () =>
{
    /**
     * Real .mangaplay files are hand-written; users sometimes type
     * labels next to the panel number as a comment to themselves —
     * `Panel 1 Stacked`, `Panel 1 EXT. Room`, `Panel 1 HELLO WORLD`.
     * Pre-fix the parser rejected these as malformed and dropped the
     * panel entirely (only 2 of 3 panels would render). The regex now
     * tolerates trailing freeform text after the (optional) tag block;
     * the trailing text is silently discarded — it's not surfaced in
     * the AST since it has no documented semantics.
     */

    test('Panel 1 Stacked — bare trailing word does not break parsing', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1 Stacked
    Description for one.
Panel 2
    Description for two.
Panel 3
    Description for three.`;
        const result = parseScript(markdown);
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].panels).toHaveLength(3);
        expect(result.pages[0].panels[0].displayNumber).toBe(1);
        expect(result.pages[0].panels[1].displayNumber).toBe(2);
        expect(result.pages[0].panels[2].displayNumber).toBe(3);
        expect(result.pages[0].panels[0].description).toContain('Description for one');
    });

    test('Panel 1 EXT. Room — screenplay-style scene heading is tolerated', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1 EXT. Room
    A wide establishing shot.
Panel 2
    Tighter.`;
        const result = parseScript(markdown);
        expect(result.pages[0].panels).toHaveLength(2);
        expect(result.pages[0].panels[0].displayNumber).toBe(1);
        expect(result.pages[0].panels[0].description).toContain('A wide establishing shot');
    });

    test('Panel 1 HELLO WORLD — all-caps trailing text is tolerated', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1 HELLO WORLD
    Greeting panel.`;
        const result = parseScript(markdown);
        expect(result.pages[0].panels).toHaveLength(1);
        expect(result.pages[0].panels[0].description).toBe('Greeting panel.');
    });

    test('Panel 1 [H] EXT. Room — tag block + trailing text both parse', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1 [H] EXT. Room
    Wide establishing shot.`;
        const result = parseScript(markdown);
        expect(result.pages[0].panels).toHaveLength(1);
        const p = result.pages[0].panels[0];
        expect(p.displayNumber).toBe(1);
        // Tag still classifies as horizontal — trailing text doesn't
        // disturb the structured tag parse.
        expect(p.type).toBe('H');
    });

    test('Panel 1 [BLEED] [H] Stacked — multi-tag + trailing text', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1 [BLEED] [H] Stacked
    Action.`;
        const result = parseScript(markdown);
        expect(result.pages[0].panels).toHaveLength(1);
        expect(result.pages[0].panels[0].type).toBe('H');
        expect(result.pages[0].panels[0].modifiers).toContain('BLEED');
    });

    test('all three panels with trailing text — none are dropped', () =>
    {
        // The user-reported regression: Panel 1 with trailing text
        // dropped the panel and re-numbered the rest. With the fix,
        // all three should land in the AST.
        const markdown = `Title: Test

# PAGE 1
Panel 1 Stacked
    First.
Panel 2 Centered
    Second.
Panel 3 EXT. Beach
    Third.`;
        const result = parseScript(markdown);
        expect(result.pages[0].panels).toHaveLength(3);
        expect(result.pages[0].panels.map(p => p.description.split('\n')[0])).toEqual([
            'First.', 'Second.', 'Third.'
        ]);
    });

    test('Panel 1 [BAD — broken bracket still surfaces malformed error', () =>
    {
        // Defensive: real syntax mistakes (unclosed bracket) must
        // continue to error rather than being silently swallowed by
        // the trailing-text branch.
        const markdown = `Title: Test

# PAGE 1
Panel 1 [BAD
    Description.`;
        const result = parseScript(markdown);
        const malformed = result.errors?.find(e => /[Mm]alformed panel/.test(e.message || ''));
        expect(malformed).toBeDefined();
    });
});

// =============================================================================
// DIALOGUE PARSING
// =============================================================================

describe('parseScript - Dialogue', () =>
{
    test('should parse basic dialogue', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Two characters face each other.
        HERO
        I will defeat you!`;

        const result = parseScript(markdown);
        const dialogue = result.pages[0].panels[0].dialogue;

        expect(dialogue).toHaveLength(1);
        expect(dialogue[0].character).toBe('HERO');
        expect(dialogue[0].type).toBe('speech');
        expect(dialogue[0].text).toBe('I will defeat you!');
    });

    test('should parse thought dialogue', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    A character thinks.
        HERO
        (thought)
        What should I do?`;

        const result = parseScript(markdown);
        const dialogue = result.pages[0].panels[0].dialogue;

        expect(dialogue[0].type).toBe('thought');
        expect(dialogue[0].text).toBe('What should I do?');
    });

    test('should parse whisper dialogue', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    A character whispers.
        VILLAIN
        (whisper)
        They cannot hear us here.`;

        const result = parseScript(markdown);
        const dialogue = result.pages[0].panels[0].dialogue;

        expect(dialogue[0].type).toBe('whisper');
    });

    test('should parse caption dialogue', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    A cityscape.
        NARRATOR
        (caption)
        The city never sleeps.`;

        const result = parseScript(markdown);
        const dialogue = result.pages[0].panels[0].dialogue;

        expect(dialogue[0].type).toBe('caption');
    });

    test('should parse off-panel dialogue (O.P.)', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    An empty room.
        HERO (O.P.)
        Is anyone there?`;

        const result = parseScript(markdown);
        const dialogue = result.pages[0].panels[0].dialogue;

        expect(dialogue[0].offPanel).toBe(true);
    });

    test('should parse multiple dialogue lines', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Two characters argue.
        HERO
        You are wrong!
        VILLAIN
        No, you are!`;

        const result = parseScript(markdown);
        const dialogue = result.pages[0].panels[0].dialogue;

        expect(dialogue).toHaveLength(2);
        expect(dialogue[0].character).toBe('HERO');
        expect(dialogue[1].character).toBe('VILLAIN');
    });

    test('should parse character names with apostrophes', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Dialogue scene.
        O'BRIEN
        Top of the morning!`;

        const result = parseScript(markdown);
        const dialogue = result.pages[0].panels[0].dialogue;

        expect(dialogue[0].character).toBe("O'BRIEN");
    });
});

// =============================================================================
// SFX PARSING
// =============================================================================

describe('parseScript - SFX', () =>
{
    test('should parse single SFX', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    An explosion occurs.
    SFX: BOOM!`;

        const result = parseScript(markdown);
        const sfx = result.pages[0].panels[0].sfx;

        expect(sfx).toHaveLength(1);
        expect(sfx[0]).toBe('BOOM!');
    });

    test('should parse multiple SFX', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    A fight scene.
    SFX: CRASH!
    SFX: BANG!
    SFX: POW!`;

        const result = parseScript(markdown);
        const sfx = result.pages[0].panels[0].sfx;

        expect(sfx).toHaveLength(3);
        expect(sfx[0]).toBe('CRASH!');
        expect(sfx[1]).toBe('BANG!');
        expect(sfx[2]).toBe('POW!');
    });

    test('should handle SFX with various text', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Various sounds.
    SFX: whoooosh
    SFX: *drip drip*
    SFX: KABOOM!!!`;

        const result = parseScript(markdown);
        const sfx = result.pages[0].panels[0].sfx;

        expect(sfx).toHaveLength(3);
        expect(sfx[0]).toBe('whoooosh');
        expect(sfx[1]).toBe('*drip drip*');
        expect(sfx[2]).toBe('KABOOM!!!');
    });

    // =============================================================================
    // SFX without colon (canonical keyword form) — verbatim content, any case.
    // =============================================================================

    test('"SFX SHREEEEK" parses as SFX node, no warning, no ambiguous-caps fallout', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    A truck approaches.
    SFX SHREEEEK`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.sfx).toEqual(['SHREEEEK']);
        // No ambiguous-caps warning should fire on the SFX line.
        const ambiguous = result.errors.filter(e => e.messageKey === 'parser.ambiguousCharacter');
        expect(ambiguous).toEqual([]);
        const sfxCase = result.errors.filter(e => e.messageKey === 'parser.sfxKeywordCase');
        expect(sfxCase).toEqual([]);
    });

    test('"SFX Hello" (mixed-case content) parses verbatim with no warning', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1
A scene.

    SFX Hello`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.sfx).toEqual(['Hello']);
        const sfxCase = result.errors.filter(e => e.messageKey === 'parser.sfxKeywordCase');
        expect(sfxCase).toEqual([]);
    });

    test('"SFX HELP ME" (multi-word content) parses verbatim', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1
A scene.

    SFX HELP ME`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.sfx).toEqual(['HELP ME']);
        const sfxCase = result.errors.filter(e => e.messageKey === 'parser.sfxKeywordCase');
        expect(sfxCase).toEqual([]);
    });

    test('"Sfx BOOM" (Title-cased keyword) parses + emits case warning', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1
A scene.

    Sfx BOOM`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.sfx).toEqual(['BOOM']);
        const sfxCase = result.errors.filter(e => e.messageKey === 'parser.sfxKeywordCase');
        expect(sfxCase).toHaveLength(1);
        expect(sfxCase[0].severity).toBe('warning');
        expect(sfxCase[0].message).toContain('SFX');
        expect(sfxCase[0].message).toContain('Sfx');
    });

    test('"sfx boom" (lowercase keyword + lowercase content) parses + emits case warning', () =>
    {
        const markdown = `Title: Test

# PAGE 1
Panel 1
A scene.

    sfx boom`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.sfx).toEqual(['boom']);
        const sfxCase = result.errors.filter(e => e.messageKey === 'parser.sfxKeywordCase');
        expect(sfxCase).toHaveLength(1);
        expect(sfxCase[0].severity).toBe('warning');
        expect(sfxCase[0].message).toContain('sfx');
    });

    test('salaryman page 3 panel 1 — "SFX SHREEEEK" no longer triggers ambiguous-caps warning', () =>
    {
        const text = readFileSync(
            new URL('../extension-mangaplay-spec/mangaplay/sample/salaryman.mangaplay', import.meta.url),
            'utf8'
        );
        const ast = parseScript(text);

        const page3 = ast.pages.find(p => p.id === '3');
        expect(page3).toBeDefined();
        const panel1 = page3.panels.find(pp => pp.displayNumber === 1);
        expect(panel1).toBeDefined();
        expect(panel1.sfx).toEqual(['SHREEEEK']);

        // The salaryman SHREEEEK line must NOT produce the ambiguous-caps warning.
        const ambiguous = ast.errors.filter(e =>
            e.messageKey === 'parser.ambiguousCharacter'
            && /SHREEEEK/i.test(text.split('\n')[e.line] || ''));
        expect(ambiguous).toEqual([]);
    });
});

// =============================================================================
// TITLE CARD PARSING
// =============================================================================

describe('parseScript - Title Cards', () =>
{
    test('should parse condensed title card', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Quick introduction.
    TITLE: DOROTHY | Age 44`;

        const result = parseScript(markdown);
        const titleCards = result.pages[0].panels[0].titleCards;

        expect(titleCards).toHaveLength(1);
        expect(titleCards[0].type).toBe('TITLE');
        expect(titleCards[0].name).toBe('DOROTHY');
        expect(titleCards[0].info).toBe('Age 44');
    });

    test('should parse condensed title card with three parts', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Character reveal.
    TITLE: Executive Class | DOROTHY | Age 44`;

        const result = parseScript(markdown);
        const titleCards = result.pages[0].panels[0].titleCards;

        expect(titleCards[0].type).toBe('Executive Class');
        expect(titleCards[0].name).toBe('DOROTHY');
        expect(titleCards[0].info).toBe('Age 44');
    });

    test('should parse multiple condensed title cards', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Team introduction.
    TITLE: HERO | Age 25
    TITLE: SIDEKICK | Age 18`;

        const result = parseScript(markdown);
        const titleCards = result.pages[0].panels[0].titleCards;

        expect(titleCards).toHaveLength(2);
        expect(titleCards[0].name).toBe('HERO');
        expect(titleCards[1].name).toBe('SIDEKICK');
    });

    test('should parse title card with epithet and class', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    Epic introduction.
    TITLE: Enemy Of The State : Executive Class | DOROTHY | Age 44`;

        const result = parseScript(markdown);
        const titleCards = result.pages[0].panels[0].titleCards;

        expect(titleCards).toHaveLength(1);
        expect(titleCards[0].name).toBe('DOROTHY');
        expect(titleCards[0].info).toBe('Age 44');
    });
});

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('parseScript - Integration', () =>
{
    test('should parse a complete manga page', () =>
    {
        const markdown = `Title: Battle Manga

Author: Test Author
Format: Manga
Genre: Action

# PAGE 1 INT. ARENA - DAY
    Panel 1 [SPREAD]
    DOROTHY (55, suited, eyepatched) stands in the center of the arena.
    TITLE: Executive Class | DOROTHY | Age 55

    Panel 2
    Close-up on her face.
        DOROTHY
        Let the battle begin!
    SFX: ROAR OF THE CROWD

    Panel 3
    Her opponent enters.
        VILLAIN (O.P.)
        (whisper)
        You will fall.
    SFX: THUD`;

        const result = parseScript(markdown);

        // Metadata
        expect(result.metadata.title).toBe('Battle Manga');
        expect(result.metadata.author).toBe('Test Author');
        expect(result.metadata.format).toBe('Manga');
        // Page
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].location?.type).toBe('INT');
        expect(result.pages[0].location?.place).toBe('ARENA');

        // Panels
        expect(result.pages[0].panels).toHaveLength(3);
        expect(result.pages[0].panels[0].type).toBe('SPREAD');

        // Title cards
        expect(result.pages[0].panels[0].titleCards).toHaveLength(1);

        // Dialogue
        expect(result.pages[0].panels[1].dialogue).toHaveLength(1);
        expect(result.pages[0].panels[1].dialogue[0].character).toBe('DOROTHY');
        expect(result.pages[0].panels[2].dialogue[0].offPanel).toBe(true);
        expect(result.pages[0].panels[2].dialogue[0].type).toBe('whisper');

        // SFX
        expect(result.pages[0].panels[1].sfx).toHaveLength(1);
        expect(result.pages[0].panels[2].sfx).toHaveLength(1);
    });

    test('should handle empty input', () =>
    {
        const result = parseScript('');

        expect(result.metadata.title).toBe('Untitled');
        expect(result.pages).toHaveLength(0);
    });

    test('should handle metadata only', () =>
    {
        const markdown = `Title: Just A Title

Author: Someone`;

        const result = parseScript(markdown);

        expect(result.metadata.title).toBe('Just A Title');
        expect(result.metadata.author).toBe('Someone');
        expect(result.pages).toHaveLength(0);
    });

    test('should handle whitespace-only input', () =>
    {
        const result = parseScript('   \n\n   ');

        expect(result.metadata.title).toBe('Untitled');
        expect(result.pages).toHaveLength(0);
    });
});

// =============================================================================
// MULTI-TAG PANEL PARSING
// =============================================================================

describe('parseScript - Multi-Tag Panels', () =>
{
    test('should parse Panel 1 [BLEED] [H] as type H with modifier BLEED', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [BLEED] [H]
    Full-width bleed panel.`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.type).toBe('H');
        expect(panel.modifiers).toEqual(['BLEED']);
    });

    test('should parse Panel with [BORDERLESS] [V] as type V with modifier BORDERLESS', () =>
    {
        // Panel Grid Refactor: [V-2] removed — use [V][L] for tall.
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [BORDERLESS] [V]
    Tall borderless panel.`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.type).toBe('V');
        expect(panel.modifiers).toEqual(['BORDERLESS']);
    });

    test('[SPREAD] + unknown [DIAGONAL] produces SPREAD with a warning', () =>
    {
        // Panel Grid Refactor: [DIAGONAL] removed — no modern equivalent.
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [DIAGONAL] [SPREAD]
    Diagonal spread panel.`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.type).toBe('SPREAD');
        expect(panel.modifiers).not.toContain('DIAGONAL');
        const warning = result.errors.find(e => e.code === 'unknown-tag' && e.offendingTag === 'DIAGONAL');
        expect(warning).toBeDefined();
    });

    test('single [BLEED] tag produces no layout and carries BLEED as a style modifier', () =>
    {
        // Panel Grid Refactor: BLEED is a STYLE tag, not a layout tag. It
        // no longer promotes to `type` when used alone.
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [BLEED]
    Bleed panel.`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        // No layout tag means `type` falls back to the parser's default
        // ('A' for untagged panels). The BLEED style ends up in modifiers.
        expect(panel.modifiers).toContain('BLEED');
    });

    test('should parse single [H] tag normally', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [H]
    Horizontal panel.`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        expect(panel.type).toBe('H');
        expect(panel.modifiers).toEqual([]);
    });

    test('[BLEED] + unknown [DIAGONAL] + unknown [H-2/3] — classifier surfaces per-tag warnings', () =>
    {
        // Panel Grid Refactor: [DIAGONAL] and sized [H-N/M] both removed.
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [BLEED] [DIAGONAL] [H-2/3]
    Complex panel.`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        // BLEED still lands as a style modifier; the unknown tags warn.
        expect(panel.modifiers).toContain('BLEED');
        const diag = result.errors.find(e => e.code === 'unknown-tag' && e.offendingTag === 'DIAGONAL');
        const sized = result.errors.find(e => e.code === 'unknown-tag' && e.offendingTag === 'H-2/3');
        expect(diag).toBeDefined();
        expect(sized).toBeDefined();
    });

    test('should warn when multiple layout tags present', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1 [H] [V]
    Conflicting layout.`;

        const result = parseScript(markdown);
        const panel = result.pages[0].panels[0];

        // Panel Grid Refactor Section 2.5: FIRST layout tag wins.
        expect(panel.type).toBe('H');
        expect(result.errors.some(e => e.code === 'stack-multiple-layout')).toBe(true);
    });

    test('should default type when no tags present', () =>
    {
        const markdown = `Title: Test

# PAGE 1
    Panel 1
    No tags.
    Panel 2
    Second panel.`;

        const result = parseScript(markdown);

        expect(result.pages[0].panels[0].type).toBe('A');  // untagged stays untagged
        expect(result.pages[0].panels[0].modifiers).toEqual([]);
        expect(result.pages[0].panels[1].type).toBe('A');  // rest default
        expect(result.pages[0].panels[1].modifiers).toEqual([]);
    });
});

// =============================================================================
// CASE-INSENSITIVE PAGE HEADER
// =============================================================================

describe('parseScript - Case-insensitive PAGE header', () =>
{
    test('should parse "# Page 1" (mixed case) as page header', () =>
    {
        const markdown = `Title: Being Salaryman
Author: Pistol Taeja

# Page 1

Panel 1

    BADDIE
    That's nice,

# Page 2

Panel 1

    BADDIE
    This fine trinket really suits your jawline.`;

        const result = parseScript(markdown);

        expect(result.pages).toHaveLength(2);
        expect(result.pages[0].id).toBe('1');
        expect(result.pages[1].id).toBe('2');
    });

    test('should parse "# page 1" (lowercase) as page header', () =>
    {
        const markdown = `Title: Test

# page 1
    Panel 1
    Lowercase page keyword.`;

        const result = parseScript(markdown);

        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].id).toBe('1');
    });

    test('should parse location on mixed-case page header', () =>
    {
        const markdown = `Title: Test

# Page 1 INT. COFFEE SHOP - DAY
    Panel 1
    Interior scene.`;

        const result = parseScript(markdown);

        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].location?.type).toBe('INT');
        expect(result.pages[0].location?.place).toBe('COFFEE SHOP');
        expect(result.pages[0].location?.time).toBe('DAY');
    });

    test('should parse the salaryman sample excerpt (mixed-case headers, zero-indent panels)', () =>
    {
        // Minimal repro: file uses "# Page N" headers + unindented "Panel N" lines
        const markdown = `Title: Being Salaryman
Author: Pistol Taeja
Genre: Isekai
Format: Manga
Status: One Shot

# Page 1

Panel 1

    BADDIE
    That's nice,

Panel 2

    BADDIE
    Cid

# Page 2

Panel 1

    BADDIE
    I'm just saying.`;

        const result = parseScript(markdown);

        expect(result.pages.length).toBeGreaterThan(0);
        expect(result.pages[0].id).toBe('1');
        expect(result.metadata.title).toBe('Being Salaryman');
        expect(result.metadata.format).toBe('Manga');
        expect(result.readingDirection).toBe('RTL');
    });
});

// =============================================================================
// TAB INDENTATION SUPPORT
// =============================================================================

describe('parseScript - Tab indentation support', () =>
{
    test('should parse panels indented with tabs', () =>
    {
        const md = `Title: Test\n\n# PAGE 1\n\tPanel 1\n\tA hero stands.\n\t\tHERO\n\t\tHello world`;
        const result = parseScript(md);
        expect(result.pages.length).toBe(1);
        expect(result.pages[0].panels.length).toBe(1);
        expect(result.pages[0].panels[0].dialogue.length).toBeGreaterThan(0);
    });

    test('should produce info message when tabs detected', () =>
    {
        const md = `Title: Test\n\n# PAGE 1\n\tPanel 1`;
        const result = parseScript(md);
        const tabMsg = result.errors.find(e => e.messageKey === 'parser.tabsConverted');
        expect(tabMsg).toBeTruthy();
        expect(tabMsg.severity).toBe('info');
    });
});

// =============================================================================
// FLEXIBLE INDENTATION (Convention A + Convention B + mixed)
// =============================================================================

describe('parseScript - Flexible Indentation', () =>
{
    // Case 1: Convention A regression — indentStyle tagged 'A'.
    test('Convention A pure — indentStyle is A', () =>
    {
        const md = `Title: Test

# PAGE 1
    Panel 1
    Description here.
        HERO
        Hello world.
    SFX: BOOM`;

        const result = parseScript(md);

        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].panels).toHaveLength(1);
        expect(result.pages[0].panels[0].description).toBe('Description here.');
        expect(result.pages[0].panels[0].dialogue[0].character).toBe('HERO');
        expect(result.pages[0].panels[0].dialogue[0].text).toBe('Hello world.');
        expect(result.pages[0].panels[0].sfx).toEqual(['BOOM']);
        expect(result.metadata.indentStyle).toBe('A');
    });

    // Case 2: Convention B pure — indentStyle is 'B'.
    test('Convention B pure — column-0 panel, 4-space dialogue', () =>
    {
        const md = `Title: Test

# Page 1

Panel 1
A character stands.

    HERO
    I greet you.

Panel 2
Second panel description.

    HERO
    More words.`;

        const result = parseScript(md);

        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].panels).toHaveLength(2);
        expect(result.pages[0].panels[0].description).toBe('A character stands.');
        expect(result.pages[0].panels[0].dialogue).toHaveLength(1);
        expect(result.pages[0].panels[0].dialogue[0].character).toBe('HERO');
        expect(result.pages[0].panels[0].dialogue[0].text).toBe('I greet you.');
        expect(result.pages[0].panels[1].dialogue[0].text).toBe('More words.');
        expect(result.metadata.indentStyle).toBe('B');
    });

    // Case 3: Convention B — character at 4 spaces, followed by text.
    test('Convention B — ALL-CAPS at 4 spaces followed by text is character', () =>
    {
        const md = `Title: Test

# Page 1

Panel 1

    BADDIE
    That's nice.`;

        const result = parseScript(md);

        expect(result.pages[0].panels[0].dialogue).toHaveLength(1);
        expect(result.pages[0].panels[0].dialogue[0].character).toBe('BADDIE');
        expect(result.pages[0].panels[0].dialogue[0].text).toBe("That's nice.");
    });

    // Case 4: Convention B — ALL-CAPS at 4 spaces followed by blank + next panel is description.
    test('Convention B — ALL-CAPS at 4 spaces followed by blank/new panel is description', () =>
    {
        const md = `Title: Test

# Page 1

Panel 1

    BAM

Panel 2
Next panel.`;

        const result = parseScript(md);

        expect(result.pages[0].panels).toHaveLength(2);
        // BAM should be captured as description (fallback), not as a character name.
        expect(result.pages[0].panels[0].description).toContain('BAM');
        expect(result.pages[0].panels[0].dialogue).toHaveLength(0);
        // Warning emitted for ambiguity.
        expect(result.errors.some(e => e.messageKey === 'parser.ambiguousCharacter')).toBe(true);
    });

    // Case 5: Convention B — SFX at panel band (column 0).
    // Architectural rule (plan Section 2/3): SFX lives on the panel band, so
    // in Convention B it appears at column 0 alongside `Panel` and description.
    test('Convention B — SFX at panel band under column-0 Panel', () =>
    {
        const md = `Title: Test

# Page 1

Panel 1
Explosion occurs.

SFX: BOOM`;

        const result = parseScript(md);

        expect(result.pages[0].panels[0].sfx).toEqual(['BOOM']);
    });

    // Case 6: Convention B — title cards at panel band.
    test('Convention B — condensed title card at panel band', () =>
    {
        const md = `Title: Test

# Page 1

Panel 1
Character reveal.

TITLE: Executive Class | DOROTHY | Age 44`;

        const result = parseScript(md);
        const cards = result.pages[0].panels[0].titleCards;

        expect(cards).toHaveLength(1);
        expect(cards[0].type).toBe('Executive Class');
        expect(cards[0].name).toBe('DOROTHY');
        expect(cards[0].info).toBe('Age 44');
    });

    test('Convention B — block title card at panel band', () =>
    {
        const md = `Title: Test

# Page 1

Panel 1
Reveal.

(CHAPTER TITLE)
DOROTHY
(Age 44)`;

        const result = parseScript(md);
        const cards = result.pages[0].panels[0].titleCards;

        expect(cards).toHaveLength(1);
        expect(cards[0].type).toBe('CHAPTER TITLE');
        expect(cards[0].name).toBe('DOROTHY');
        expect(cards[0].info).toBe('Age 44');
    });

    // Case 7: Convention B — transitions, centered, synopsis, lyrics, forced action, notes at panel band.
    test('Convention B — transitions, centered, synopsis, lyrics, forced action, notes at panel band', () =>
    {
        const md = `Title: Test

# Page 1

Panel 1
Base description.

[[a production note]]

CUT TO:

>centered text<

= short synopsis

~lyric line

!forced action here`;

        const result = parseScript(md);
        const panel = result.pages[0].panels[0];

        expect(panel.notes).toEqual(['a production note']);
        expect(panel.transitions).toContain('CUT TO:');
        expect(panel.centered).toEqual(['centered text']);
        expect(panel.synopsis).toBe('short synopsis');
        expect(panel.lyrics).toEqual(['lyric line']);
        expect(panel.description).toContain('forced action here');
    });

    // Case 8: Mixed A+B file (salaryman replica).
    test('Mixed A+B file — pages 1-2 Convention B, pages 3-4 Convention A', () =>
    {
        const md = `Title: Mixed
Format: Manga

# Page 1

Panel 1

    BADDIE
    First B page dialogue.

# Page 2

Panel 1

    BADDIE
    Second B page dialogue.

# PAGE 3

    Panel 1
    A-style description.
        HERO
        First A page dialogue.

# PAGE 4

    Panel 1
        HERO
        Fourth page dialogue.`;

        const result = parseScript(md);

        expect(result.pages).toHaveLength(4);
        // Every page has panels > 0.
        for (const page of result.pages)
        {
            expect(page.panels.length).toBeGreaterThan(0);
        }
        // All character names captured.
        expect(result.pages[0].panels[0].dialogue[0].character).toBe('BADDIE');
        expect(result.pages[1].panels[0].dialogue[0].character).toBe('BADDIE');
        expect(result.pages[2].panels[0].dialogue[0].character).toBe('HERO');
        expect(result.pages[3].panels[0].dialogue[0].character).toBe('HERO');
        // Dialogue text intact.
        expect(result.pages[0].panels[0].dialogue[0].text).toBe('First B page dialogue.');
        expect(result.pages[2].panels[0].dialogue[0].text).toBe('First A page dialogue.');
        expect(result.metadata.indentStyle).toBe('mixed');
    });

    // Case 9: Mixed within-page.
    test('Mixed within-page — Panel 1 column-0, Panel 2 at 4 spaces', () =>
    {
        const md = `Title: Test

# Page 1

Panel 1
Column-0 panel.

    HERO
    First.

    Panel 2
    Four-space panel.
        HERO
        Second.`;

        const result = parseScript(md);

        expect(result.pages[0].panels).toHaveLength(2);
        expect(result.pages[0].panels[0].description).toBe('Column-0 panel.');
        expect(result.pages[0].panels[0].dialogue[0].text).toBe('First.');
        expect(result.pages[0].panels[1].description).toBe('Four-space panel.');
        expect(result.pages[0].panels[1].dialogue[0].text).toBe('Second.');
    });

    // Case 10: Tab normalization works for Convention B-compatible input.
    test('Tab-indented content expands to 4 spaces (Convention B-compatible)', () =>
    {
        // `Panel` at column 0 followed by `\tHERO\n\tHello` expands to 4 spaces → Convention B.
        const md = `Title: Test\n\n# Page 1\n\nPanel 1\n\n\tHERO\n\tHello.`;
        const result = parseScript(md);

        expect(result.pages[0].panels).toHaveLength(1);
        expect(result.pages[0].panels[0].dialogue).toHaveLength(1);
        expect(result.pages[0].panels[0].dialogue[0].character).toBe('HERO');
        expect(result.pages[0].panels[0].dialogue[0].text).toBe('Hello.');
        expect(result.metadata.indentStyle).toBe('B');
    });

    // Case 11: Malformed indent (2 spaces) snaps to nearest and warns.
    test('Malformed indent (2 spaces) snaps to 0 with warning', () =>
    {
        const md = `Title: Test

# Page 1

  Panel 1
A description.`;

        const result = parseScript(md);

        expect(result.pages[0].panels.length).toBe(1);
        expect(result.errors.some(e => /Unusual panel indent/.test(e.message))).toBe(true);
    });

    test('Malformed indent (6 spaces) snaps to 4 with warning', () =>
    {
        const md = `Title: Test

# PAGE 1

      Panel 1
    A description.`;

        const result = parseScript(md);

        expect(result.pages[0].panels.length).toBe(1);
        expect(result.errors.some(e => /Unusual panel indent/.test(e.message))).toBe(true);
    });

    // Case 12: Round-trip Convention A.
    test('Round-trip Convention A — parse → format → parse yields stable AST', () =>
    {
        const md = `Title: Round Trip A
Author: Tester
Format: Comic

# PAGE 1
    Panel 1 [SPLASH]
    Hero stands alone.
        HERO
        Ready!
    SFX: BOOM`;

        const first = parseScript(md);
        const formatted = formatMangaplay(first);
        const second = parseScript(formatted);

        expect(second.metadata.title).toBe(first.metadata.title);
        expect(second.pages).toHaveLength(first.pages.length);
        expect(second.pages[0].panels).toHaveLength(first.pages[0].panels.length);
        expect(second.pages[0].panels[0].description).toBe(first.pages[0].panels[0].description);
        expect(second.pages[0].panels[0].dialogue[0].character).toBe('HERO');
        expect(second.pages[0].panels[0].dialogue[0].text).toBe('Ready!');
        expect(second.pages[0].panels[0].sfx).toEqual(['BOOM']);
    });

    // Case 13: Round-trip Convention B.
    test('Round-trip Convention B — parse → format(B) → parse yields stable AST', () =>
    {
        const md = `Title: Round Trip B

# Page 1

Panel 1
First description.

    HERO
    Ready!

SFX: BOOM`;

        const first = parseScript(md);
        expect(first.metadata.indentStyle).toBe('B');

        const formatted = formatMangaplay(first, { indentStyle: 'B' });
        const second = parseScript(formatted);

        expect(second.metadata.indentStyle).toBe('B');
        expect(second.pages).toHaveLength(first.pages.length);
        expect(second.pages[0].panels[0].description).toBe('First description.');
        expect(second.pages[0].panels[0].dialogue[0].character).toBe('HERO');
        expect(second.pages[0].panels[0].dialogue[0].text).toBe('Ready!');
        expect(second.pages[0].panels[0].sfx).toEqual(['BOOM']);
    });

    // Case 14: Round-trip salaryman.mangaplay.
    test('Round-trip salaryman.mangaplay — format(default A) then re-parse preserves content', () =>
    {
        const text = readFileSync(
            new URL('../extension-mangaplay-spec/mangaplay/sample/salaryman.mangaplay', import.meta.url),
            'utf8'
        );
        const first = parseScript(text);

        expect(first.pages).toHaveLength(10);
        for (const page of first.pages)
        {
            expect(page.panels.length).toBeGreaterThan(0);
        }
        expect(first.metadata.indentStyle).toBe('mixed');

        const formatted = formatMangaplay(first); // Default A
        const second = parseScript(formatted);

        expect(second.pages.length).toBe(first.pages.length);
        for (let p = 0; p < first.pages.length; p++)
        {
            expect(second.pages[p].panels.length).toBe(first.pages[p].panels.length);
        }
        // After re-format as A, re-parse yields canonical A.
        expect(second.metadata.indentStyle).toBe('A');
    });

    // Case 15: format-detector regression for Convention B mangaplay.
    test('detectFormat — Convention B mangaplay file still detects as mangaplay', () =>
    {
        const md = `Title: Test
Author: Someone
Format: Manga

# Page 1

Panel 1

    HERO
    Line one.

Panel 2

    HERO
    Line two.`;

        expect(detectFormat(md)).toBe('mangaplay');
    });
});

// =============================================================================
// [ROW] TAG — removed in Panel Grid Refactor (Section 5.1). Replaced by [GROUP].
// The tests below verify the REMOVAL: [ROW] produces an unknown-tag warning
// that suggests [GROUP], and [GROUP] parses as the new canonical layout.
// =============================================================================

describe('parseScript - [ROW] removal + [GROUP] replacement', () =>
{
    test('[ROW] is no longer recognised — warns with suggestion [GROUP]', () =>
    {
        const md = `# PAGE 1
    Panel 1 [ROW]
    First.

    Panel 2
    Second.`;
        const result = parseScript(md);
        const warn = result.errors.find(e => e.code === 'unknown-tag' && e.offendingTag === 'ROW');
        expect(warn).toBeDefined();
        expect(warn.suggestion).toBe('GROUP');
    });

    test('[GROUP] parses as a layout tag', () =>
    {
        const md = `# PAGE 1
    Panel 1 [GROUP]
    First.

    Panel 2
    Second.`;
        const result = parseScript(md);
        expect(result.pages[0].panels[0].type).toBe('GROUP');
    });
});

// =============================================================================
// STATUS FREE-TEXT (Issue 1 regression)
//
// Status: is accepted as free text — any value parses without an error. The
// previous enum (Draft / In Progress / Complete / Published) is retired; real
// scripts use values like "One Shot".
// =============================================================================

describe('parseScript - Status free-text', () =>
{
    test('accepts "One Shot" without emitting an invalid-status error', () =>
    {
        const md = `Title: Test\nStatus: One Shot\n\n# PAGE 1\n    Panel 1\n    A scene.`;
        const result = parseScript(md);
        expect(result.metadata.status).toBe('One Shot');
        const statusErrors = result.errors.filter(e => /Invalid status/i.test(e.message));
        expect(statusErrors).toHaveLength(0);
    });

    test('accepts arbitrary status text (e.g. "Pitch Ready")', () =>
    {
        const md = `Title: Test\nStatus: Pitch Ready\n\n# PAGE 1\n    Panel 1\n    A scene.`;
        const result = parseScript(md);
        expect(result.metadata.status).toBe('Pitch Ready');
        const statusErrors = result.errors.filter(e => /Invalid status/i.test(e.message));
        expect(statusErrors).toHaveLength(0);
    });

    test('still accepts the classic enum values', () =>
    {
        for (const status of ['Draft', 'In Progress', 'Complete', 'Published'])
        {
            const md = `Title: Test\nStatus: ${status}\n\n# PAGE 1\n    Panel 1\n    Body.`;
            const result = parseScript(md);
            expect(result.metadata.status).toBe(status);
            const statusErrors = result.errors.filter(e => /Invalid status/i.test(e.message));
            expect(statusErrors).toHaveLength(0);
        }
    });
});

// =============================================================================
// INDENTATION REGRESSION TESTS (Issue 6)
//
// These cover Convention A vs Convention B with matched content, mixed-order
// transitions, tab expansion, and the salaryman-vs-salaryman_format_2
// structural-equivalence regression.
//
// Helper `normalizePages` strips positional metadata (lineNumber, lineNumberEnd,
// _panelIndent) so two parses of the "same story" but different indentation
// compare equal at the content level.
// =============================================================================

describe('parseScript - Indentation regression (Issue 6)', () =>
{
    /**
     * @param {ReturnType<typeof parseScript>} ast
     */
    const normalizePages = (ast) => ast.pages.map(page => ({
        id: page.id,
        panels: page.panels.map(panel => ({
            displayNumber: panel.displayNumber,
            type: panel.type,
            // Collapse internal whitespace (newlines vs spaces) so two
            // sources that differ only in line-wrapping of description
            // text compare equal.
            description: panel.description
                ? panel.description.replace(/\s+/g, ' ').trim()
                : panel.description,
            dialogue: panel.dialogue,
            sfx: panel.sfx,
            titleCards: panel.titleCards,
            rowStart: panel.rowStart,
            modifiers: panel.modifiers
        }))
    }));

    // --- Matched-content pairs ---

    const contentConventionA = `Title: Indent Test

# PAGE 1
    Panel 1 [H]
    A hero stands defiant.
        HERO
        I am here.
    SFX: BOOM

    Panel 2
    TITLE: Chapter Title | HERO | Age 21
        HERO
        (thought)
        I will prevail.
`;

    const contentConventionB = `Title: Indent Test

# PAGE 1
Panel 1 [H]
A hero stands defiant.

    HERO
    I am here.

SFX: BOOM

Panel 2
TITLE: Chapter Title | HERO | Age 21

    HERO
    (thought)
    I will prevail.
`;

    test('Convention A and Convention B produce content-equivalent ASTs', () =>
    {
        const a = parseScript(contentConventionA);
        const b = parseScript(contentConventionB);
        expect(normalizePages(a)).toEqual(normalizePages(b));
        expect(a.metadata.indentStyle).toBe('A');
        expect(b.metadata.indentStyle).toBe('B');
    });

    // --- Mixed-in-one-file, both orderings ---

    test('Mixed A-then-B file — both halves parse, no content loss', () =>
    {
        const md = `Title: Mixed

# PAGE 1
    Panel 1
    A-side description.
        HERO
        First.

# PAGE 2

Panel 1
B-side description.

    HERO
    Second.`;
        const result = parseScript(md);
        expect(result.metadata.indentStyle).toBe('mixed');
        expect(result.pages).toHaveLength(2);
        expect(result.pages[0].panels[0].description).toBe('A-side description.');
        expect(result.pages[0].panels[0].dialogue[0].text).toBe('First.');
        expect(result.pages[1].panels[0].description).toBe('B-side description.');
        expect(result.pages[1].panels[0].dialogue[0].text).toBe('Second.');
    });

    test('Mixed B-then-A file — both halves parse, no content loss', () =>
    {
        const md = `Title: Mixed

# PAGE 1

Panel 1
B-side description.

    HERO
    First.

# PAGE 2
    Panel 1
    A-side description.
        HERO
        Second.`;
        const result = parseScript(md);
        expect(result.metadata.indentStyle).toBe('mixed');
        expect(result.pages).toHaveLength(2);
        expect(result.pages[0].panels[0].description).toBe('B-side description.');
        expect(result.pages[0].panels[0].dialogue[0].text).toBe('First.');
        expect(result.pages[1].panels[0].description).toBe('A-side description.');
        expect(result.pages[1].panels[0].dialogue[0].text).toBe('Second.');
    });

    // --- Tabs equivalence ---

    test('Tabs expanded to 4 spaces parse identically to Convention A', () =>
    {
        const spaceForm = `Title: Tab Test\n\n# PAGE 1\n    Panel 1\n    A hero stands.\n        HERO\n        Hello world\n    SFX: BOOM`;
        const tabForm = `Title: Tab Test\n\n# PAGE 1\n\tPanel 1\n\tA hero stands.\n\t\tHERO\n\t\tHello world\n\tSFX: BOOM`;
        const a = parseScript(spaceForm);
        const b = parseScript(tabForm);
        expect(normalizePages(a)).toEqual(normalizePages(b));
        expect(a.metadata.indentStyle).toBe('A');
        expect(b.metadata.indentStyle).toBe('A');
    });

    // --- salaryman Convention-B vs synthetic Convention-A regression ---
    //
    // salaryman currently ships as Convention B for page 1 (panel headers at col 0).
    // Build an in-memory Convention A variant (panel headers +4, body +8) and
    // assert structural/content equivalence.

    test('salaryman.mangaplay and a Convention-A page-1 variant produce equivalent ASTs', () =>
    {
        const textA = readFileSync(
            new URL('../extension-mangaplay-spec/mangaplay/sample/salaryman.mangaplay', import.meta.url),
            'utf8'
        );
        const lines = textA.split('\n');
        let inPageOne = false;
        const transformed = lines.map((line) =>
        {
            if (/^#\s*Page\s*1\b/i.test(line))
            {
                inPageOne = true;
                return line;
            }
            if (/^#\s*Page\s*2\b/i.test(line))
            {
                inPageOne = false;
                return line;
            }
            if (!inPageOne)
            {
                return line;
            }
            if (/^Panel\s+\d+\b/i.test(line))
            {
                return '    ' + line;
            }
            if (/^ {4}\S/.test(line))
            {
                return '    ' + line;
            }
            return line;
        });
        const textB = transformed.join('\n');

        const a = parseScript(textA);
        const b = parseScript(textB);

        // Same page count.
        expect(a.pages.length).toBe(b.pages.length);
        expect(a.pages.length).toBeGreaterThan(0);

        // Same panel count per page.
        for (let i = 0; i < a.pages.length; i++)
        {
            expect(b.pages[i].panels.length).toBe(a.pages[i].panels.length);
        }

        // Total dialogue count.
        const countDialogue = (r) => r.pages.reduce(
            (total, page) => total + page.panels.reduce((s, p) => s + p.dialogue.length, 0),
            0
        );
        expect(countDialogue(b)).toBe(countDialogue(a));

        // Content-equivalent at the normalized-AST level.
        expect(normalizePages(b)).toEqual(normalizePages(a));
    });
});

describe('parseScript - All-caps dialogue text after CHARACTER', () =>
{
    test('short ALL-CAPS dialogue ("FFS") after CHARACTER + (thought) is parsed as dialogue, not a second character', () =>
    {
        const text = [
            '# PAGE 1',
            '',
            'Panel 1',
            '    Description here.',
            '',
            '    CID',
            '    (thought)',
            '    FFS',
            '',
            '    CID',
            '    It\'s the real one?!',
            ''
        ].join('\n');

        const ast = parseScript(text);

        // No "ambiguous character" / speaker-miscase warnings should fire.
        const offending = ast.errors.filter(e =>
            e.messageKey === 'parser.ambiguousCharacter'
            || e.messageKey === 'parser.dialogueSpeakerNotCaps'
            || /no dialogue follows/i.test(e.message || '')
        );
        expect(offending).toEqual([]);

        const panel = ast.pages[0].panels[0];
        expect(panel.dialogue).toHaveLength(2);

        expect(panel.dialogue[0]).toMatchObject({
            character: 'CID',
            type: 'thought',
            text: 'FFS'
        });

        expect(panel.dialogue[1]).toMatchObject({
            character: 'CID',
            type: 'speech',
            text: 'It\'s the real one?!'
        });
    });

    test('various short all-caps dialogue lines are accepted silently', () =>
    {
        const samples = ['FFS', 'WTF', 'OK!', 'NO', 'WAIT...', 'HEY!'];
        for (const utterance of samples)
        {
            const text = [
                '# PAGE 1',
                '',
                'Panel 1',
                '    Beat.',
                '',
                '    BOB',
                `    ${utterance}`,
                ''
            ].join('\n');

            const ast = parseScript(text);
            const offending = ast.errors.filter(e =>
                e.messageKey === 'parser.ambiguousCharacter'
                || e.messageKey === 'parser.dialogueSpeakerNotCaps'
            );
            expect(offending).toEqual([]);

            const panel = ast.pages[0].panels[0];
            expect(panel.dialogue).toHaveLength(1);
            expect(panel.dialogue[0]).toMatchObject({
                character: 'BOB',
                type: 'speech',
                text: utterance
            });
        }
    });

    test('Convention A (4-space panel indent): all-caps dialogue still parsed as dialogue', () =>
    {
        const text = [
            '# PAGE 1',
            '',
            '    Panel 1',
            '        Beat.',
            '',
            '            CID',
            '            (thought)',
            '            FFS',
            ''
        ].join('\n');

        const ast = parseScript(text);
        const offending = ast.errors.filter(e =>
            e.messageKey === 'parser.ambiguousCharacter'
            || e.messageKey === 'parser.dialogueSpeakerNotCaps'
        );
        expect(offending).toEqual([]);

        const panel = ast.pages[0].panels[0];
        expect(panel.dialogue).toHaveLength(1);
        expect(panel.dialogue[0]).toMatchObject({
            character: 'CID',
            type: 'thought',
            text: 'FFS'
        });
    });
});

// =============================================================================
// TITLE keyword variants (TITLE / TITLE: / case-insensitive)
// =============================================================================

describe('parseScript - TITLE keyword variants', () =>
{
    test('canonical "TITLE:" with colon parses into panel.titleCards', () =>
    {
        const text = [
            '# PAGE 1',
            '',
            'Panel 1',
            '    A description.',
            '',
            '    TITLE: DOROTHY | Age 44',
            ''
        ].join('\n');

        const ast = parseScript(text);
        const panel = ast.pages[0].panels[0];

        expect(panel.titleCards).toHaveLength(1);
        expect(panel.titleCards[0]).toMatchObject({
            type: 'TITLE',
            name: 'DOROTHY',
            info: 'Age 44'
        });
        // No case warning when keyword is canonical.
        const caseWarnings = ast.errors.filter(e => e.messageKey === 'parser.titleCardKeywordCase');
        expect(caseWarnings).toEqual([]);
    });

    test('"TITLE" without colon parses into panel.titleCards (no warning)', () =>
    {
        const text = [
            '# PAGE 1',
            '',
            'Panel 1',
            '    A description.',
            '',
            '    TITLE DOROTHY | Age 44',
            ''
        ].join('\n');

        const ast = parseScript(text);
        const panel = ast.pages[0].panels[0];

        expect(panel.titleCards).toHaveLength(1);
        expect(panel.titleCards[0]).toMatchObject({
            type: 'TITLE',
            name: 'DOROTHY',
            info: 'Age 44'
        });
        const caseWarnings = ast.errors.filter(e => e.messageKey === 'parser.titleCardKeywordCase');
        expect(caseWarnings).toEqual([]);
    });

    test('"Title" (Title-cased keyword) parses + emits case warning', () =>
    {
        const text = [
            '# PAGE 1',
            '',
            'Panel 1',
            '    A description.',
            '',
            '    Title Cincinnati Cid | (19)',
            ''
        ].join('\n');

        const ast = parseScript(text);
        const panel = ast.pages[0].panels[0];

        expect(panel.titleCards).toHaveLength(1);
        expect(panel.titleCards[0]).toMatchObject({
            type: 'TITLE',
            name: 'Cincinnati Cid',
            info: '(19)'
        });
        // Description should NOT swallow the Title line.
        expect(panel.description).not.toMatch(/Title /i);

        const caseWarnings = ast.errors.filter(e => e.messageKey === 'parser.titleCardKeywordCase');
        expect(caseWarnings).toHaveLength(1);
        expect(caseWarnings[0].severity).toBe('warning');
        expect(caseWarnings[0].message).toContain('TITLE');
        expect(caseWarnings[0].message).toContain('Title');
        expect(caseWarnings[0].line).toBe(5); // 0-based; line index of "    Title ..."
    });

    test('"title" (lowercase) parses + emits case warning', () =>
    {
        const text = [
            '# PAGE 1',
            '',
            'Panel 1',
            '    title DOROTHY | Age 44',
            ''
        ].join('\n');

        const ast = parseScript(text);
        const panel = ast.pages[0].panels[0];

        expect(panel.titleCards).toHaveLength(1);
        expect(panel.titleCards[0].name).toBe('DOROTHY');
        const caseWarnings = ast.errors.filter(e => e.messageKey === 'parser.titleCardKeywordCase');
        expect(caseWarnings).toHaveLength(1);
        expect(caseWarnings[0].message).toMatch(/'title'/);
    });

    test('"TiTle" (mixed case) parses + emits case warning', () =>
    {
        const text = [
            '# PAGE 1',
            '',
            'Panel 1',
            '    TiTle: Minnesota Baddie | (19)',
            ''
        ].join('\n');

        const ast = parseScript(text);
        const panel = ast.pages[0].panels[0];

        expect(panel.titleCards).toHaveLength(1);
        expect(panel.titleCards[0]).toMatchObject({
            name: 'Minnesota Baddie',
            info: '(19)'
        });
        const caseWarnings = ast.errors.filter(e => e.messageKey === 'parser.titleCardKeywordCase');
        expect(caseWarnings).toHaveLength(1);
        expect(caseWarnings[0].message).toMatch(/'TiTle'/);
    });

    test('Convention B (panel at column 0) — TITLE without colon at column 0', () =>
    {
        const text = [
            '# PAGE 1',
            '',
            'Panel 1',
            'A description.',
            '',
            'TITLE Cincinnati Cid | (19)',
            ''
        ].join('\n');

        const ast = parseScript(text);
        const panel = ast.pages[0].panels[0];

        expect(panel.titleCards).toHaveLength(1);
        expect(panel.titleCards[0]).toMatchObject({
            name: 'Cincinnati Cid',
            info: '(19)'
        });
    });
});

// =============================================================================
// Salaryman sample regression — Title cards on Page 1 panels 3 + 4
// =============================================================================

describe('parseScript - salaryman.mangaplay Title card lines', () =>
{
    test('Page 1, Panel 3: "Title Cincinnati Cid | (19)" lands on titleCards', () =>
    {
        const text = readFileSync(
            new URL('../extension-mangaplay-spec/mangaplay/sample/salaryman.mangaplay', import.meta.url),
            'utf8'
        );
        const ast = parseScript(text);

        const page1 = ast.pages.find(p => p.id === '1');
        expect(page1).toBeDefined();
        const panel3 = page1.panels.find(pp => pp.displayNumber === 3);
        expect(panel3).toBeDefined();

        expect(panel3.titleCards).toHaveLength(1);
        expect(panel3.titleCards[0]).toMatchObject({
            type: 'TITLE',
            name: 'Cincinnati Cid',
            info: '(19)'
        });
        // Description must NOT contain the raw Title line.
        expect(panel3.description || '').not.toMatch(/Cincinnati Cid \| \(19\)/);
    });

    test('Page 1, Panel 4: "Title Minnesota Baddie | (19)" lands on titleCards', () =>
    {
        const text = readFileSync(
            new URL('../extension-mangaplay-spec/mangaplay/sample/salaryman.mangaplay', import.meta.url),
            'utf8'
        );
        const ast = parseScript(text);

        const page1 = ast.pages.find(p => p.id === '1');
        const panel4 = page1.panels.find(pp => pp.displayNumber === 4);
        expect(panel4).toBeDefined();

        expect(panel4.titleCards).toHaveLength(1);
        expect(panel4.titleCards[0]).toMatchObject({
            type: 'TITLE',
            name: 'Minnesota Baddie',
            info: '(19)'
        });
        expect(panel4.description || '').not.toMatch(/Minnesota Baddie \| \(19\)/);

        // salaryman now uses canonical uppercase TITLE; no case warnings expected.
        const caseWarnings = ast.errors.filter(e => e.messageKey === 'parser.titleCardKeywordCase');
        expect(caseWarnings).toEqual([]);
    });
});

describe('parseScript - Panel before "# PAGE" header (implicit Page 1)', () =>
{
    // Spec V2 §5.4 / Plan Phase 2 task 7: content before the first `# PAGE`
    // header is now assigned to a synthesised Page 1 with a warning (not a
    // hard error). The panelWithoutPage messageKey is retired.

    test('single panel before any page header → implicit Page 1 with warning', () =>
    {
        const md = `Panel 1\n    This is panel 1\n`;
        const ast = parseScript(md, { format: 'mangaplay' });
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].id).toBe('1');
        expect(ast.pages[0].panels).toHaveLength(1);
        const warns = ast.warnings.filter(w => w.code === 'WARN_IMPLICIT_PAGE_1');
        expect(warns).toHaveLength(1);
        expect(warns[0].severity).toBe('warning');
    });

    test('multiple panels before any page header → all attach to implicit Page 1', () =>
    {
        const md = `Panel 1\n    Body 1\nPanel 2\n    Body 2\nPanel 3\n    Body 3\n`;
        const ast = parseScript(md, { format: 'mangaplay' });
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].panels).toHaveLength(3);
        const warns = ast.warnings.filter(w => w.code === 'WARN_IMPLICIT_PAGE_1');
        expect(warns).toHaveLength(1);
    });

    test('exact user repro: panels with no page header → implicit Page 1', () =>
    {
        const md = `Panel 1 [V][L]\nPanel 2\nThis is panel 2\nPanel 3\nThis is panel 3\nPanel 4 [H][G]\nThis is the final panel\n`;
        const ast = parseScript(md, { format: 'mangaplay' });
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].panels).toHaveLength(4);
        const warns = ast.warnings.filter(w => w.code === 'WARN_IMPLICIT_PAGE_1');
        expect(warns).toHaveLength(1);
    });

    test('malformed page header followed by panels — malformed error + implicit Page 1 warn', () =>
    {
        const md = `# PAGE\nPanel 1\n    Body 1\n`;
        const ast = parseScript(md, { format: 'mangaplay' });
        const malformed = ast.errors.find(e => e.message && e.message.includes('Malformed page header'));
        const implicit = ast.warnings.find(w => w.code === 'WARN_IMPLICIT_PAGE_1');
        expect(malformed).toBeDefined();
        expect(implicit).toBeDefined();
    });

    test('proper page header + [G] modifier → no errors, [G] visible in modifiers', () =>
    {
        const md = `# PAGE 1\n    Panel 1 [V][L]\n    Body 1\n    Panel 2 [H][G]\n    Body 2\n`;
        const ast = parseScript(md, { format: 'mangaplay' });
        const errs = ast.errors.filter(e =>
            e.messageKey === 'parser.panelWithoutPage' || e.code === 'unknown-tag'
        );
        expect(errs).toEqual([]);
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].panels).toHaveLength(2);
        const p2 = ast.pages[0].panels[1];
        expect(p2.type).toBe('H');
        expect(p2.modifiers).toContain('G');
    });

    test('user repro with leading "# PAGE 1" parses cleanly, panel 4 carries [G]', () =>
    {
        const md = `# PAGE 1\n    Panel 1 [V][L]\n    Panel 2\n    This is panel 2\n    Panel 3\n    This is panel 3\n    Panel 4 [H][G]\n    This is the final panel\n`;
        const ast = parseScript(md, { format: 'mangaplay' });
        const errs = ast.errors.filter(e => e.severity === 'error');
        expect(errs).toEqual([]);
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].panels).toHaveLength(4);
        const p4 = ast.pages[0].panels[3];
        expect(p4.type).toBe('H');
        expect(p4.modifiers).toContain('G');
    });
});
