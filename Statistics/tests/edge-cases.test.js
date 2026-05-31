import { describe, test, expect } from 'bun:test';
import { computeStatistics } from '../index.js';

describe('edge cases', () =>
{
    test('null input -> EMPTY_INPUT, stats zeroed', () =>
    {
        const stats = computeStatistics(null, { isMangaplay: false, hasTitlePage: false });
        expect(stats.warnings.some(w => w.code === 'EMPTY_INPUT')).toBe(true);
        expect(stats.length.words).toBe(0);
        expect(stats.length.scenes).toBe(0);
        expect(stats.duration.totalSeconds).toBe(0);
        expect(stats.characters.length).toBe(0);
    });

    test('empty array -> EMPTY_INPUT, stats zeroed', () =>
    {
        const stats = computeStatistics([], { isMangaplay: false, hasTitlePage: false });
        expect(stats.warnings.some(w => w.code === 'EMPTY_INPUT')).toBe(true);
        expect(stats.length.words).toBe(0);
        expect(stats.duration.totalSeconds).toBe(0);
    });

    test('dialogue-only (no scenes) -> NO_SCENES, characters still populated', () =>
    {
        const tokens = [
            { type: 'character', text: 'BOB', line: 1 },
            { type: 'dialogue', text: 'Hello', line: 2 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        expect(stats.warnings.some(w => w.code === 'NO_SCENES')).toBe(true);
        expect(stats.characters.length).toBe(1);
        expect(stats.characters[0].name).toBe('BOB');
    });

    test('200+ char scene heading -> location truncated', () =>
    {
        const longText = 'x'.repeat(210);
        const tokens = [
            { type: 'scene_heading', text: longText, line: 1 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        expect(stats.locations[0].name.length).toBe(80);
    });

    test('unknown token type -> UNKNOWN_TOKEN_TYPE warning', () =>
    {
        const tokens = [
            { type: 'banana', text: 'xyz', line: 1 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        expect(stats.warnings.some(w => w.code === 'UNKNOWN_TOKEN_TYPE')).toBe(true);
    });

    test('dual dialogue -> both characters credited, caret stripped', () =>
    {
        const tokens = [
            { type: 'scene_heading', text: 'INT. ROOM - DAY', line: 1 },
            { type: 'character', text: 'ALICE', line: 2 },
            { type: 'dialogue', text: 'Hello', line: 3 },
            { type: 'character', text: 'BOB ^', line: 4 },
            { type: 'dialogue', text: 'Hi there', line: 5 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        const names = stats.characters.map(c => c.name);
        expect(names).toContain('ALICE');
        expect(names).toContain('BOB');
        expect(names).not.toContain('BOB ^');
    });

    test('readability threshold: < 50 words excluded', () =>
    {
        const tokens = [
            { type: 'scene_heading', text: 'INT. ROOM - DAY', line: 1 },
            { type: 'character', text: 'ALICE', line: 2 },
            { type: 'dialogue', text: 'Short dialogue.', line: 3 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        expect(stats.readability.characters.length).toBe(0);
    });

    test('deep sections -> outline tree has correct nesting', () =>
    {
        const tokens = [
            { type: 'section', text: 'Act 1', line: 1, depth: 1 },
            { type: 'section', text: 'Chapter 1', line: 2, depth: 2 },
            { type: 'section', text: 'Scene A', line: 3, depth: 3 },
            { type: 'section', text: 'Beat 1', line: 4, depth: 4 },
            { type: 'section', text: 'Detail', line: 5, depth: 5 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });

        // Act 1 at root
        expect(stats.outline.length).toBe(1);
        expect(stats.outline[0].text).toBe('Act 1');

        // Chapter 1 nested under Act 1
        expect(stats.outline[0].children.length).toBe(1);
        expect(stats.outline[0].children[0].text).toBe('Chapter 1');

        // Scene A nested under Chapter 1
        const chapter = stats.outline[0].children[0];
        expect(chapter.children.length).toBe(1);
        expect(chapter.children[0].text).toBe('Scene A');

        // Beat 1 nested under Scene A
        const scene = chapter.children[0];
        expect(scene.children.length).toBe(1);
        expect(scene.children[0].text).toBe('Beat 1');

        // Detail nested under Beat 1
        const beat = scene.children[0];
        expect(beat.children.length).toBe(1);
        expect(beat.children[0].text).toBe('Detail');
    });

    test('single scene -> stats are valid (no NaN/Infinity)', () =>
    {
        const tokens = [
            { type: 'scene_heading', text: 'INT. ROOM - DAY', line: 1 },
            { type: 'action', text: 'A man sits alone.', line: 2 },
            { type: 'character', text: 'JOHN', line: 3 },
            { type: 'dialogue', text: 'Hello world.', line: 4 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        expect(Number.isFinite(stats.duration.totalSeconds)).toBe(true);
        expect(Number.isFinite(stats.duration.dialogueSeconds)).toBe(true);
        expect(Number.isFinite(stats.duration.actionSeconds)).toBe(true);
        expect(Number.isFinite(stats.duration.dialoguePercent)).toBe(true);
        expect(Number.isFinite(stats.duration.actionPercent)).toBe(true);
        expect(Number.isNaN(stats.duration.totalSeconds)).toBe(false);
        expect(stats.length.scenes).toBe(1);
        expect(stats.characters.length).toBe(1);
    });

    test('tokens with no scene_heading -> NO_SCENES warning', () =>
    {
        const tokens = [
            { type: 'action', text: 'Something happens in the dark.', line: 1 },
            { type: 'action', text: 'Another thing occurs.', line: 2 },
            { type: 'character', text: 'NARRATOR', line: 3 },
            { type: 'dialogue', text: 'Where am I?', line: 4 }
        ];
        const stats = computeStatistics(tokens, { isMangaplay: false, hasTitlePage: false });
        expect(stats.warnings.some(w => w.code === 'NO_SCENES')).toBe(true);
        expect(stats.duration.totalSeconds).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(stats.duration.totalSeconds)).toBe(true);
    });

    test('empty token array -> stats return zeroed duration, empty scenes', () =>
    {
        const stats = computeStatistics([], { isMangaplay: false, hasTitlePage: false });
        expect(stats.duration.totalSeconds).toBe(0);
        expect(stats.duration.dialogueSeconds).toBe(0);
        expect(stats.duration.actionSeconds).toBe(0);
        expect(stats.duration.scenes).toEqual([]);
        expect(stats.length.scenes).toBe(0);
        expect(stats.characters.length).toBe(0);
    });
});
