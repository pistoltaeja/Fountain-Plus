import { describe, test, expect } from 'bun:test';
import {
    countWords, countSyllables, countSentences, stripInlineNotes,
    estimateDialogueDuration, estimateActionDuration, slugify,
    normalizeTime, parseSceneHeading, resolveIntExt, normalizeCharacterFallback
} from '../analyzers.js';

describe('countWords', () =>
{
    test('two words', () =>
    {
        expect(countWords('hello world')).toBe(2);
    });

    test('empty string', () =>
    {
        expect(countWords('')).toBe(0);
    });

    test('multiple spaces', () =>
    {
        expect(countWords('  multiple   spaces  ')).toBe(2);
    });

    test('single word', () =>
    {
        expect(countWords('one')).toBe(1);
    });
});

describe('countSyllables', () =>
{
    test('hello = 2', () =>
    {
        expect(countSyllables('hello')).toBe(2);
    });

    test('beautiful = 3', () =>
    {
        expect(countSyllables('beautiful')).toBe(3);
    });

    test('the = 1 (short word rule)', () =>
    {
        expect(countSyllables('the')).toBe(1);
    });

    test('ale = 1', () =>
    {
        expect(countSyllables('ale')).toBe(1);
    });

    test('bottle = 2', () =>
    {
        expect(countSyllables('bottle')).toBe(2);
    });

    test('create = 1 (silent-e heuristic)', () =>
    {
        expect(countSyllables('create')).toBe(1);
    });

    test('extraordinary >= 4', () =>
    {
        expect(countSyllables('extraordinary')).toBeGreaterThanOrEqual(4);
    });

    test('empty string = 1', () =>
    {
        expect(countSyllables('')).toBe(1);
    });
});

describe('countSentences', () =>
{
    test('two sentences', () =>
    {
        expect(countSentences('Hello. World!')).toBe(2);
    });

    test('no punctuation = minimum 1', () =>
    {
        expect(countSentences('No punctuation here')).toBe(1);
    });

    test('three sentences', () =>
    {
        expect(countSentences('One. Two. Three.')).toBe(3);
    });
});

describe('stripInlineNotes', () =>
{
    test('removes inline note', () =>
    {
        expect(stripInlineNotes('Before [[note]] after')).toBe('Before  after');
    });

    test('no notes unchanged', () =>
    {
        expect(stripInlineNotes('No notes here')).toBe('No notes here');
    });

    test('full note becomes empty', () =>
    {
        expect(stripInlineNotes('[[full note]]')).toBe('');
    });
});

describe('estimateDialogueDuration', () =>
{
    test('short phrase > 0 and < 5', () =>
    {
        const result = estimateDialogueDuration('Hello world.');
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThan(5);
    });

    test('empty string = 0', () =>
    {
        expect(estimateDialogueDuration('')).toBe(0);
    });

    test('long sentence > 5 seconds', () =>
    {
        const result = estimateDialogueDuration(
            'This is a very long sentence that should take more than five seconds to speak aloud in a normal conversational cadence.'
        );
        expect(result).toBeGreaterThan(5);
    });
});

describe('estimateActionDuration', () =>
{
    test('short text', () =>
    {
        expect(estimateActionDuration('Short.')).toBe(6 / 20);
    });

    test('strips inline notes before measuring', () =>
    {
        const result = estimateActionDuration('Text [[with note]] end');
        const expected = 'Text  end'.length / 20;
        expect(result).toBe(expected);
    });
});

describe('slugify', () =>
{
    test('COFFEE SHOP', () =>
    {
        expect(slugify('COFFEE SHOP')).toBe('coffee-shop');
    });

    test('Bob\'s Diner with whitespace', () =>
    {
        expect(slugify("  Bob's Diner  ")).toBe('bobs-diner');
    });

    test('INT. OFFICE', () =>
    {
        expect(slugify('INT. OFFICE')).toBe('int-office');
    });
});

describe('normalizeTime', () =>
{
    test('DAY -> day', () =>
    {
        expect(normalizeTime('DAY')).toBe('day');
    });

    test('EARLY MORNING -> morning', () =>
    {
        expect(normalizeTime('EARLY MORNING')).toBe('morning');
    });

    test('THE FOLLOWING NIGHT -> night', () =>
    {
        expect(normalizeTime('THE FOLLOWING NIGHT')).toBe('night');
    });

    test('NEXT DAY -> day', () =>
    {
        expect(normalizeTime('NEXT DAY')).toBe('day');
    });

    test('CONTINUOUS -> continuous', () =>
    {
        expect(normalizeTime('CONTINUOUS')).toBe('continuous');
    });

    test('DUSK. -> dusk', () =>
    {
        expect(normalizeTime('DUSK.')).toBe('dusk');
    });
});

describe('parseSceneHeading', () =>
{
    test('INT. OFFICE - DAY', () =>
    {
        const result = parseSceneHeading('INT. OFFICE - DAY');
        expect(result.location).toBe('OFFICE');
        expect(result.intExt).toBe('int');
        expect(result.timeOfDay).toBe('DAY');
    });

    test('EXT. PARK - NIGHT', () =>
    {
        const result = parseSceneHeading('EXT. PARK - NIGHT');
        expect(result.location).toBe('PARK');
        expect(result.intExt).toBe('ext');
        expect(result.timeOfDay).toBe('NIGHT');
    });

    test('INT./EXT. CAR - DAWN', () =>
    {
        const result = parseSceneHeading('INT./EXT. CAR - DAWN');
        expect(result.location).toBe('CAR');
        expect(result.intExt).toBe('mixed');
        expect(result.timeOfDay).toBe('DAWN');
    });

    test('EST. SKYLINE - DUSK (not int/ext)', () =>
    {
        const result = parseSceneHeading('EST. SKYLINE - DUSK');
        expect(result.location).toBe('SKYLINE');
        expect(result.intExt).toBe('other');
        expect(result.timeOfDay).toBe('DUSK');
    });

    test('.FORCED HEADING', () =>
    {
        const result = parseSceneHeading('.FORCED HEADING');
        expect(result.location).toBe('FORCED HEADING');
        expect(result.intExt).toBe('other');
        expect(result.timeOfDay).toBe('');
    });

    test('long heading truncated', () =>
    {
        const long = 'x'.repeat(201);
        const result = parseSceneHeading(long);
        expect(result.location.length).toBe(80);
        expect(result.intExt).toBe('other');
    });

    test('INT. APARTMENT (no time)', () =>
    {
        const result = parseSceneHeading('INT. APARTMENT');
        expect(result.location).toBe('APARTMENT');
        expect(result.intExt).toBe('int');
        expect(result.timeOfDay).toBe('');
    });
});

describe('resolveIntExt', () =>
{
    test('int only', () =>
    {
        expect(resolveIntExt(new Set(['int']))).toBe('int');
    });

    test('ext only', () =>
    {
        expect(resolveIntExt(new Set(['ext']))).toBe('ext');
    });

    test('int and ext = mixed', () =>
    {
        expect(resolveIntExt(new Set(['int', 'ext']))).toBe('mixed');
    });

    test('empty = other', () =>
    {
        expect(resolveIntExt(new Set())).toBe('other');
    });
});

describe('normalizeCharacterFallback', () =>
{
    test('plain name unchanged', () =>
    {
        expect(normalizeCharacterFallback('BOB')).toBe('BOB');
    });

    test('strips V.O.', () =>
    {
        expect(normalizeCharacterFallback('BOB (V.O.)')).toBe('BOB');
    });

    test('strips caret', () =>
    {
        expect(normalizeCharacterFallback('ALICE ^')).toBe('ALICE');
    });

    test('strips CONT\'D', () =>
    {
        expect(normalizeCharacterFallback("CHARLIE (CONT'D)")).toBe('CHARLIE');
    });

    test('lowercased name uppercased', () =>
    {
        expect(normalizeCharacterFallback('bob')).toBe('BOB');
    });
});
