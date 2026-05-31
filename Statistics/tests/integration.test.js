import { describe, test, expect } from 'bun:test';
import { computeStatistics } from '../index.js';
import { simpleTokenize } from './test-tokenizer.js';

describe('integration: multi-scene fountain document', () =>
{
    const doc = `INT. COFFEE SHOP - MORNING

Alice sits at a table, staring at her phone.

ALICE
(worried)
Have you seen the news? They're shutting down the whole district.

BOB
That can't be right. I was just there yesterday.

> CUT TO:

EXT. CITY STREET - NIGHT

Rain falls heavily on the empty sidewalk.

ALICE
We need to find shelter. Now.

BOB ^
I know a place. Follow me.`;

    const tokens = simpleTokenize(doc, false);
    const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });

    test('two characters found', () =>
    {
        expect(stats.characters.length).toBe(2);
    });

    test('Alice has 2 speaking parts', () =>
    {
        const alice = stats.characters.find(c => c.name === 'ALICE');
        expect(alice.speakingParts).toBe(2);
    });

    test('Bob has 2 speaking parts', () =>
    {
        const bob = stats.characters.find(c => c.name === 'BOB');
        expect(bob.speakingParts).toBe(2);
    });

    test('two locations found', () =>
    {
        expect(stats.locations.length).toBe(2);
    });

    test('total duration > 0', () =>
    {
        expect(stats.duration.totalSeconds).toBeGreaterThan(0);
    });

    test('2 scenes counted', () =>
    {
        expect(stats.length.scenes).toBe(2);
    });

    test('no unexpected warnings', () =>
    {
        const unexpected = stats.warnings.filter(
            w => w.code !== 'NO_SCENES' && w.code !== 'EMPTY_INPUT'
        );
        expect(unexpected.length).toBe(0);
    });
});

describe('integration: mangaplay document', () =>
{
    const doc = `Title: Test
Author: Test
Format: Manga

# PAGE 1

Panel 1
A dark alley stretches into the distance.

HERO
This is where it all began.

Panel 2
The hero draws their sword.

VILLAIN
You dare challenge me? After everything I've done for this kingdom?

# PAGE 2

INT. CASTLE THRONE ROOM - DAY

Panel 1
The throne room is vast and empty.

KING
Leave us. All of you.`;

    const tokens = simpleTokenize(doc, true);
    const stats = computeStatistics(tokens, { isMangaplay: true, hasTitlePage: false });

    test('at least 3 panels', () =>
    {
        expect(stats.length.panels).toBeGreaterThanOrEqual(3);
    });

    test('at least 3 characters', () =>
    {
        expect(stats.characters.length).toBeGreaterThanOrEqual(3);
    });

    test('total duration > 0', () =>
    {
        expect(stats.duration.totalSeconds).toBeGreaterThan(0);
    });

    test('outline has sections', () =>
    {
        const sections = stats.outline.filter(n => n.type === 'section');
        expect(sections.length).toBeGreaterThanOrEqual(2);
    });
});

describe('integration: warnings produced correctly', () =>
{
    test('empty array -> EMPTY_INPUT', () =>
    {
        const stats = computeStatistics([], { isMangaplay: false, hasTitlePage: false });
        expect(stats.warnings.some(w => w.code === 'EMPTY_INPUT')).toBe(true);
    });

    test('orphan dialogue -> ORPHAN_DIALOGUE', () =>
    {
        const tokens = [
            { type: 'dialogue', text: 'Hello there', line: 1 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        expect(stats.warnings.some(w => w.code === 'ORPHAN_DIALOGUE')).toBe(true);
    });

    test('no scene headings -> NO_SCENES', () =>
    {
        const tokens = [
            { type: 'character', text: 'BOB', line: 1 },
            { type: 'dialogue', text: 'Hello', line: 2 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        expect(stats.warnings.some(w => w.code === 'NO_SCENES')).toBe(true);
    });
});
