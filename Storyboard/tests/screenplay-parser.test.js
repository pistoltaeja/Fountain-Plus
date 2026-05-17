/**
 * Screenplay Parser Tests
 * Validates screenplay conversion via Fountain pipeline
 */

import { describe, test, expect } from 'bun:test';
import { parseScript } from '../core/parser/fountain-plus-mangaplay-parser.js';
import {
    astToScreenplay,
    parseTitleCard,
    screenplayToJson,
    renderScreenplayToHtml
} from '../core/parser/screenplay-parser.js';
import { mangaplayToFountain } from '../core/parser/fountain-writer.js';
import { parseFountain } from '../core/parser/fountain-parser.js';

// =============================================================================
// HELPER: build screenplay from a single-page markdown snippet
// =============================================================================

/**
 * Convert a single-page markdown snippet to screenplay and return first scene
 * @param {string} markdown
 * @returns {import('../core/parser/screenplay-parser.js').ScreenplayScene}
 */
function singlePageToScene(markdown)
{
    const ast = parseScript(markdown);
    const screenplay = astToScreenplay(ast);
    return screenplay.scenes[0];
}

// =============================================================================
// SINGLE PAGE CONVERSION (via full pipeline)
// =============================================================================

describe('single page screenplay conversion', () =>
{
    test('should convert a basic page to screenplay scene', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 1 INT. OFFICE - DAY
    Panel 1
    A busy office environment.`);

        expect(scene.heading).toBe('INT. OFFICE - DAY');
        expect(scene.sceneNumber).toBe(1);
        expect(scene.elements.length).toBeGreaterThanOrEqual(1);
        const action = scene.elements.find(e => e.type === 'action');
        expect(action).toBeDefined();
        expect(action?.content).toBe('A busy office environment.');
    });

    test('should convert dialogue to screenplay format', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 1
    Panel 1
        HERO
        We must act now!`);

        const charEl = scene.elements.find(e => e.type === 'character');
        const dialogueEl = scene.elements.find(e => e.type === 'dialogue');

        expect(charEl).toBeDefined();
        expect(charEl?.content).toBe('HERO');
        expect(dialogueEl).toBeDefined();
        expect(dialogueEl?.content).toBe('We must act now!');
    });

    test('should add V.O. modifier for thought dialogue', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 1
    Panel 1
        HERO
        (thought)
        What should I do?`);

        const charEl = scene.elements.find(e => e.type === 'character');
        expect(charEl?.meta?.modifier).toBe('V.O.');
    });

    test('should add V.O. modifier for caption dialogue', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 1
    Panel 1
        NARRATOR
        (caption)
        The city slept.`);

        const charEl = scene.elements.find(e => e.type === 'character');
        expect(charEl?.meta?.modifier).toBe('V.O.');
    });

    test('should add O.S. modifier for off-panel dialogue', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 1
    Panel 1
        HERO (O.P.)
        Is anyone there?`);

        const charEl = scene.elements.find(e => e.type === 'character');
        expect(charEl?.meta?.modifier).toBe('O.S.');
    });

    test('should add parenthetical for whisper dialogue', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 1
    Panel 1
        VILLAIN
        (whisper)
        Follow me.`);

        const elements = scene.elements;
        const charEl = elements.find(e => e.type === 'character');
        const parenEl = elements.find(e => e.type === 'parenthetical');
        const dialogueEl = elements.find(e => e.type === 'dialogue');

        expect(charEl).toBeDefined();
        expect(parenEl).toBeDefined();
        expect(parenEl?.content).toBe('whispering');
        expect(dialogueEl).toBeDefined();
    });

    test('should convert SFX to sfx elements', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 1
    Panel 1
    An explosion.
    SFX: BOOM!
    SFX: CRASH!`);

        const sfxElements = scene.elements.filter(e => e.type === 'sfx');

        expect(sfxElements).toHaveLength(2);
        expect(sfxElements[0].content).toBe('BOOM!');
        expect(sfxElements[1].content).toBe('CRASH!');
    });

    test('should convert title cards to title_card elements', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 1
    Panel 1
    TITLE: DOROTHY | Age 44`);

        const titleCard = scene.elements.find(e => e.type === 'title_card');

        expect(titleCard).toBeDefined();
        expect(titleCard?.content).toBe('DOROTHY');
        expect(titleCard?.meta?.age).toBe('Age 44');
    });

    test('should handle page without location', () =>
    {
        const scene = singlePageToScene(`Title: Test

# PAGE 5
    Panel 1
    Action continues.`);

        expect(scene.heading).toBe('');
        expect(scene.elements.length).toBeGreaterThanOrEqual(1);
    });
});

// =============================================================================
// AST TO SCREENPLAY CONVERSION
// =============================================================================

describe('astToScreenplay', () =>
{
    test('should convert full AST to screenplay', () =>
    {
        const markdown = `Title: Test Manga

Author: Test Author

# PAGE 1 INT. OFFICE - DAY
    Panel 1
    Scene description.
        HERO
        Hello world!`;

        const ast = parseScript(markdown);
        const screenplay = astToScreenplay(ast);

        expect(screenplay.title).toBe('Test Manga');
        expect(screenplay.author).toBe('Test Author');
        expect(screenplay.scenes).toHaveLength(1);
        expect(screenplay.scenes[0].heading).toBe('INT. OFFICE - DAY');
    });

    test('should merge pages without location into previous scene', () =>
    {
        const markdown = `Title: Test

# PAGE 1 INT. ROOM - NIGHT
    Panel 1
    First scene.

# PAGE 2
    Panel 1
    Continues first scene.

# PAGE 3 EXT. STREET - DAY
    Panel 1
    New scene.`;

        const ast = parseScript(markdown);
        const screenplay = astToScreenplay(ast);

        expect(screenplay.scenes).toHaveLength(2);
        expect(screenplay.scenes[0].heading).toBe('INT. ROOM - NIGHT');
        expect(screenplay.scenes[1].heading).toBe('EXT. STREET - DAY');
    });

    test('should handle multiple scenes', () =>
    {
        const markdown = `Title: Multi Scene Test

# PAGE 1 INT. HOUSE - DAY
    Panel 1
    Interior scene.

# PAGE 2 EXT. GARDEN - DUSK
    Panel 1
    Exterior scene.

# PAGE 3 INT. BASEMENT - NIGHT
    Panel 1
    Dark scene.`;

        const ast = parseScript(markdown);
        const screenplay = astToScreenplay(ast);

        expect(screenplay.scenes).toHaveLength(3);
        expect(screenplay.scenes[0].sceneNumber).toBe(1);
        expect(screenplay.scenes[1].sceneNumber).toBe(2);
        expect(screenplay.scenes[2].sceneNumber).toBe(3);
    });

    test('should handle empty pages array', () =>
    {
        const ast = {
            metadata: { title: 'Empty Test' },
            pages: []
        };

        const screenplay = astToScreenplay(ast);

        expect(screenplay.title).toBe('Empty Test');
        expect(screenplay.scenes).toHaveLength(0);
    });
});

// =============================================================================
// SCREENPLAY TO JSON
// =============================================================================

describe('screenplayToJson', () =>
{
    test('should convert screenplay to clean JSON object', () =>
    {
        const screenplay = {
            title: 'Test',
            author: 'Author',
            scenes: [
                {
                    heading: 'INT. ROOM - DAY',
                    sceneNumber: 1,
                    pageId: '1',
                    elements: [
                        {
                            type: 'action',
                            content: 'A room.'
                        },
                        {
                            type: 'character',
                            content: 'HERO',
                            meta: { modifier: 'V.O.' }
                        }
                    ]
                }
            ]
        };

        const json = screenplayToJson(screenplay);

        expect(json.title).toBe('Test');
        expect(json.author).toBe('Author');
        expect(json.scenes).toHaveLength(1);
        expect(json.scenes[0].elements).toHaveLength(2);
        expect(json.scenes[0].elements[1].meta.modifier).toBe('V.O.');
    });

    test('should omit empty meta objects', () =>
    {
        const screenplay = {
            title: 'Test',
            scenes: [
                {
                    heading: '',
                    sceneNumber: 1,
                    elements: [
                        {
                            type: 'action',
                            content: 'Action line.',
                            meta: {}
                        }
                    ]
                }
            ]
        };

        const json = screenplayToJson(screenplay);

        expect(json.scenes[0].elements[0]).not.toHaveProperty('meta');
    });
});

// =============================================================================
// RENDER TO HTML
// =============================================================================

describe('renderScreenplayToHtml', () =>
{
    test('should render basic screenplay to HTML', () =>
    {
        const screenplay = {
            title: 'Test Movie',
            author: 'Test Author',
            scenes: [
                {
                    heading: 'INT. ROOM - DAY',
                    sceneNumber: 1,
                    elements: [
                        {
                            type: 'action',
                            content: 'A small room.'
                        }
                    ]
                }
            ]
        };

        const html = renderScreenplayToHtml(screenplay);

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('Test Movie');
        expect(html).toContain('Test Author');
        expect(html).toContain('INT. ROOM - DAY');
        expect(html).toContain('A small room.');
    });

    test('should render title cards with proper structure', () =>
    {
        const screenplay = {
            title: 'Test',
            scenes: [
                {
                    heading: '',
                    sceneNumber: 1,
                    elements: [
                        {
                            type: 'title_card',
                            content: 'DOROTHY',
                            meta: {
                                epithet: 'Enemy Of The State',
                                subheader: 'Executive Class',
                                age: 'Age 44'
                            }
                        }
                    ]
                }
            ]
        };

        const html = renderScreenplayToHtml(screenplay);

        expect(html).toContain('title-card');
        expect(html).toContain('title-card-epithet');
        expect(html).toContain('title-card-subheader');
        expect(html).toContain('title-card-name');
        expect(html).toContain('title-card-age');
        expect(html).toContain('Enemy Of The State');
        expect(html).toContain('Executive Class');
        expect(html).toContain('DOROTHY');
        expect(html).toContain('Age 44');
    });

    test('should exclude title cards when includeTitles is false', () =>
    {
        const screenplay = {
            title: 'Test',
            scenes: [
                {
                    heading: '',
                    sceneNumber: 1,
                    elements: [
                        {
                            type: 'title_card',
                            content: 'DOROTHY',
                            meta: { age: 'Age 44' }
                        }
                    ]
                }
            ]
        };

        const html = renderScreenplayToHtml(screenplay, { includeTitles: false });

        expect(html).not.toContain('class="title-card"');
        expect(html).not.toContain('>DOROTHY<');
    });

    test('should render dialogue with modifier', () =>
    {
        const screenplay = {
            title: 'Test',
            scenes: [
                {
                    heading: '',
                    sceneNumber: 1,
                    elements: [
                        {
                            type: 'character',
                            content: 'HERO',
                            meta: { modifier: 'V.O.' }
                        },
                        {
                            type: 'dialogue',
                            content: 'Inner thoughts.'
                        }
                    ]
                }
            ]
        };

        const html = renderScreenplayToHtml(screenplay);

        expect(html).toContain('HERO (V.O.)');
        expect(html).toContain('Inner thoughts.');
    });

    test('should render SFX elements', () =>
    {
        const screenplay = {
            title: 'Test',
            scenes: [
                {
                    heading: '',
                    sceneNumber: 1,
                    elements: [
                        {
                            type: 'sfx',
                            content: 'BOOM!'
                        }
                    ]
                }
            ]
        };

        const html = renderScreenplayToHtml(screenplay);

        expect(html).toContain('class="sfx"');
        expect(html).toContain('BOOM!');
    });

    test('should escape HTML special characters', () =>
    {
        const screenplay = {
            title: 'Test <script>alert("xss")</script>',
            scenes: [
                {
                    heading: '',
                    sceneNumber: 1,
                    elements: [
                        {
                            type: 'action',
                            content: 'User says "hello" & waves <hand>.'
                        }
                    ]
                }
            ]
        };

        const html = renderScreenplayToHtml(screenplay);

        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&amp;');
        expect(html).toContain('&quot;');
        expect(html).toContain('&lt;hand&gt;');
    });

    test('should include Impact font styling', () =>
    {
        const screenplay = {
            title: 'Test',
            scenes: []
        };

        const html = renderScreenplayToHtml(screenplay);

        expect(html).toContain("font-family: Impact");
        expect(html).toContain("@font-face");
    });
});

// =============================================================================
// FOUNTAIN WRITER TESTS
// =============================================================================

describe('mangaplayToFountain', () =>
{
    test('should produce title page from metadata', () =>
    {
        const ast = {
            metadata: { title: 'My Script', author: 'Test Author' },
            pages: []
        };

        const fountain = mangaplayToFountain(ast);

        expect(fountain).toContain('Title: My Script');
        expect(fountain).toContain('Author: Test Author');
    });

    test('should produce scene headings from page locations', () =>
    {
        const ast = parseScript(`Title: Test

# PAGE 1 INT. OFFICE - DAY
    Panel 1
    Description.`);

        const fountain = mangaplayToFountain(ast);

        expect(fountain).toContain('INT. OFFICE - DAY');
    });

    test('should produce dialogue blocks', () =>
    {
        const ast = parseScript(`Title: Test

# PAGE 1
    Panel 1
        HERO
        Hello world!`);

        const fountain = mangaplayToFountain(ast);

        expect(fountain).toContain('HERO');
        expect(fountain).toContain('Hello world!');
    });

    test('should produce SFX notes', () =>
    {
        const ast = parseScript(`Title: Test

# PAGE 1
    Panel 1
    SFX: BOOM`);

        const fountain = mangaplayToFountain(ast);

        expect(fountain).toContain('[[SFX: BOOM]]');
    });

    test('should produce source annotations', () =>
    {
        const ast = parseScript(`Title: Test

# PAGE 1
    Panel 1
    Some action.`);

        const fountain = mangaplayToFountain(ast);

        expect(fountain).toMatch(/\[\[_src:\d+-\d+\]\]/);
    });

    test('should produce TITLE_CARD notes', () =>
    {
        const ast = parseScript(`Title: Test

# PAGE 1
    Panel 1
    TITLE: DOROTHY | Age 44`);

        const fountain = mangaplayToFountain(ast);

        expect(fountain).toContain('[[TITLE_CARD:');
        expect(fountain).toContain('DOROTHY');
    });
});

// =============================================================================
// FOUNTAIN PARSER TESTS
// =============================================================================

describe('parseFountain', () =>
{
    test('should parse title page', () =>
    {
        const fountain = `Title: My Script
Author: Writer

INT. ROOM - DAY

A room.`;

        const screenplay = parseFountain(fountain);

        expect(screenplay.title).toBe('My Script');
        expect(screenplay.author).toBe('Writer');
    });

    test('should parse scene headings', () =>
    {
        const fountain = `Title: Test

INT. OFFICE - DAY

Action here.

EXT. PARK - NIGHT

More action.`;

        const screenplay = parseFountain(fountain);

        expect(screenplay.scenes).toHaveLength(2);
        expect(screenplay.scenes[0].heading).toBe('INT. OFFICE - DAY');
        expect(screenplay.scenes[1].heading).toBe('EXT. PARK - NIGHT');
    });

    test('should parse character and dialogue', () =>
    {
        const fountain = `Title: Test

INT. ROOM - DAY

HERO
Hello world!`;

        const screenplay = parseFountain(fountain);
        const elements = screenplay.scenes[0].elements;
        const charEl = elements.find(e => e.type === 'character');
        const dialogueEl = elements.find(e => e.type === 'dialogue');

        expect(charEl?.content).toBe('HERO');
        expect(dialogueEl?.content).toBe('Hello world!');
    });

    test('should parse character with V.O. modifier', () =>
    {
        const fountain = `Title: Test

INT. ROOM - DAY

HERO (V.O.)
Thinking aloud.`;

        const screenplay = parseFountain(fountain);
        const charEl = screenplay.scenes[0].elements.find(e => e.type === 'character');

        expect(charEl?.content).toBe('HERO');
        expect(charEl?.meta?.modifier).toBe('V.O.');
    });

    test('should parse parenthetical', () =>
    {
        const fountain = `Title: Test

INT. ROOM - DAY

VILLAIN
(whispering)
Follow me.`;

        const screenplay = parseFountain(fountain);
        const parenEl = screenplay.scenes[0].elements.find(e => e.type === 'parenthetical');

        expect(parenEl?.content).toBe('whispering');
    });

    test('should parse TITLE_CARD notes', () =>
    {
        const fountain = `Title: Test

[[TITLE_CARD: DOROTHY | Age 44]]`;

        const screenplay = parseFountain(fountain);
        const tc = screenplay.scenes[0].elements.find(e => e.type === 'title_card');

        expect(tc?.content).toBe('DOROTHY');
        expect(tc?.meta?.age).toBe('Age 44');
    });

    test('should parse SFX notes', () =>
    {
        const fountain = `Title: Test

[[SFX: BOOM!]]`;

        const screenplay = parseFountain(fountain);
        const sfx = screenplay.scenes[0].elements.find(e => e.type === 'sfx');

        expect(sfx?.content).toBe('BOOM!');
    });

    test('should parse source annotations', () =>
    {
        const fountain = `Title: Test

INT. ROOM - DAY

Some action.
[[_src:5-7]]`;

        const screenplay = parseFountain(fountain);
        const action = screenplay.scenes[0].elements.find(e => e.type === 'action');

        expect(action?.sourceLineStart).toBe(5);
        expect(action?.sourceLineEnd).toBe(7);
    });
});

// =============================================================================
// ROUND-TRIP INTEGRATION TEST
// =============================================================================

describe('Fountain round-trip', () =>
{
    test('should produce same screenplay elements through Fountain pipeline', () =>
    {
        const markdown = `Title: Hero's Journey

Author: Epic Writer
Format: Manga

# PAGE 1 INT. TEMPLE - DAWN
    Panel 1 [SPLASH]
    Ancient temple interior bathed in morning light.
    TITLE: ORACLE | Age Unknown

    Panel 2
    The ORACLE speaks.
        ORACLE
        (thought)
        The hero approaches.
    SFX: footsteps

# PAGE 2
    Panel 1
    HERO enters the temple.
        HERO
        I seek guidance.
        ORACLE
        You have come far.`;

        const ast = parseScript(markdown);
        const screenplay = astToScreenplay(ast);
        const json = screenplayToJson(screenplay);

        // Basic structure
        expect(json.title).toBe("Hero's Journey");
        expect(json.author).toBe('Epic Writer');

        // Scenes (page 2 has no location, merges with page 1)
        expect(json.scenes).toHaveLength(1);
        expect(json.scenes[0].heading).toBe('INT. TEMPLE - DAWN');

        // Elements
        const elements = json.scenes[0].elements;
        const titleCard = elements.find(e => e.type === 'title_card');
        const action = elements.find(e => e.type === 'action');
        const sfx = elements.find(e => e.type === 'sfx');
        const voiceOver = elements.find(e => e.type === 'character' && e.meta?.modifier === 'V.O.');

        expect(titleCard).toBeDefined();
        expect(titleCard?.content).toBe('ORACLE');
        expect(action).toBeDefined();
        expect(sfx).toBeDefined();
        expect(sfx?.content).toBe('footsteps');
        expect(voiceOver).toBeDefined();
    });

    test('should handle dorothy sample without errors', () =>
    {
        const fs = require('fs');
        const samplePath = require('path').join(__dirname, '..', 'sample', 'production', 'dorothy.mangaplay');
        if (!fs.existsSync(samplePath)) { console.warn('[skip] dorothy.mangaplay not found'); return; }
        const markdown = fs.readFileSync(samplePath, 'utf8');

        const ast = parseScript(markdown);
        const screenplay = astToScreenplay(ast);

        expect(screenplay.title).toBe('A BOY NAMED DOROTHY');
        expect(screenplay.scenes.length).toBeGreaterThan(0);

        // Verify all element types are valid
        for (const scene of screenplay.scenes)
        {
            for (const el of scene.elements)
            {
                expect(['action', 'character', 'dialogue', 'parenthetical', 'sfx', 'title_card', 'transition', 'soundtrack']).toContain(el.type);
            }
        }
    });
});
