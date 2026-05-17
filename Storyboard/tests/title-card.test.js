/**
 * Title Card Parser Tests
 * Validates all title card format variations
 */

import { describe, test, expect } from 'bun:test';
import { parseTitleCard } from '../core/parser/screenplay-parser.js';

// =============================================================================
// TWO-PART FORMATS
// =============================================================================

describe('parseTitleCard - Two-Part Formats', () =>
{
    test('should parse "NAME | Age info" format', () =>
    {
        const result = parseTitleCard('DOROTHY | Age 44');

        expect(result).not.toBeNull();
        expect(result?.type).toBe('title_card');
        expect(result?.content).toBe('DOROTHY');
        expect(result?.meta?.age).toBe('Age 44');
        expect(result?.meta?.epithet).toBeUndefined();
        expect(result?.meta?.subheader).toBeUndefined();
    });

    test('should parse "NAME | role info" with parentheses', () =>
    {
        const result = parseTitleCard('UNIT 42 | (Model X-7)');

        expect(result?.content).toBe('UNIT 42');
        expect(result?.meta?.age).toBe('(Model X-7)');
    });

    test('should parse "Class | NAME" format (no age)', () =>
    {
        const result = parseTitleCard('Executive Class | DOROTHY');

        expect(result?.content).toBe('DOROTHY');
        expect(result?.meta?.subheader).toBe('Executive Class');
        expect(result?.meta?.age).toBeUndefined();
    });

    test('should parse multi-part name with comma', () =>
    {
        const result = parseTitleCard('CHURIN, IV ALASTAIR | (Commissariat : Model Llama)');

        expect(result?.content).toBe('CHURIN, IV ALASTAIR');
        expect(result?.meta?.age).toBe('(Commissariat : Model Llama)');
    });

    test('should handle name with apostrophe', () =>
    {
        const result = parseTitleCard("O'BRIEN | Age 50");

        expect(result?.content).toBe("O'BRIEN");
        expect(result?.meta?.age).toBe('Age 50');
    });

    test('should handle two-word name', () =>
    {
        const result = parseTitleCard('JOHN DOE | Age 30');

        expect(result?.content).toBe('JOHN DOE');
        expect(result?.meta?.age).toBe('Age 30');
    });

    test('should parse "Epithet : Class | NAME" format (no age)', () =>
    {
        const result = parseTitleCard('Enemy Of The State : Executive Class | DOROTHY');

        expect(result?.content).toBe('DOROTHY');
        expect(result?.meta?.epithet).toBe('Enemy Of The State');
        expect(result?.meta?.subheader).toBe('Executive Class');
        expect(result?.meta?.age).toBeUndefined();
    });
});

// =============================================================================
// THREE-PART FORMATS
// =============================================================================

describe('parseTitleCard - Three-Part Formats', () =>
{
    test('should parse "Epithet : Class | NAME | Age" format', () =>
    {
        const result = parseTitleCard('Enemy Of The State : Executive Class | DOROTHY | Age 44');

        expect(result?.content).toBe('DOROTHY');
        expect(result?.meta?.epithet).toBe('Enemy Of The State');
        expect(result?.meta?.subheader).toBe('Executive Class');
        expect(result?.meta?.age).toBe('Age 44');
    });

    test('should parse "Class | NAME | Age" format (no epithet)', () =>
    {
        const result = parseTitleCard('Executive Class | DOROTHY | Age 44');

        expect(result?.content).toBe('DOROTHY');
        expect(result?.meta?.subheader).toBe('Executive Class');
        expect(result?.meta?.age).toBe('Age 44');
        expect(result?.meta?.epithet).toBeUndefined();
    });

    test('should parse with numeric epithet prefix', () =>
    {
        const result = parseTitleCard('7th Division Mortal Pacifist : Executive Class | ORACLE | Age XX');

        expect(result?.content).toBe('ORACLE');
        expect(result?.meta?.epithet).toBe('7th Division Mortal Pacifist');
        expect(result?.meta?.subheader).toBe('Executive Class');
        expect(result?.meta?.age).toBe('Age XX');
    });

    test('should parse with special class name', () =>
    {
        const result = parseTitleCard('Hero Class | CHAMPION | Level 99');

        expect(result?.content).toBe('CHAMPION');
        expect(result?.meta?.subheader).toBe('Hero Class');
        expect(result?.meta?.age).toBe('Level 99');
    });

    test('should handle epithet with trailing comma', () =>
    {
        const result = parseTitleCard('Enemy Of The State, : Executive Class | DOROTHY | Age 44');

        expect(result?.meta?.epithet).toBe('Enemy Of The State');
        expect(result?.meta?.subheader).toBe('Executive Class');
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('parseTitleCard - Edge Cases', () =>
{
    test('should return null for single-part input', () =>
    {
        const result = parseTitleCard('DOROTHY');

        expect(result).toBeNull();
    });

    test('should return null for empty string', () =>
    {
        const result = parseTitleCard('');

        expect(result).toBeNull();
    });

    test('should handle extra whitespace', () =>
    {
        const result = parseTitleCard('  DOROTHY  |  Age 44  ');

        expect(result?.content).toBe('DOROTHY');
        expect(result?.meta?.age).toBe('Age 44');
    });

    test('should handle lowercase age info', () =>
    {
        const result = parseTitleCard('DOROTHY | age unknown');

        expect(result?.content).toBe('DOROTHY');
        expect(result?.meta?.age).toBe('age unknown');
    });

    test('should handle complex role description', () =>
    {
        const result = parseTitleCard('MECH UNIT | (Series 7, Combat Model, Decommissioned)');

        expect(result?.content).toBe('MECH UNIT');
        expect(result?.meta?.age).toBe('(Series 7, Combat Model, Decommissioned)');
    });

    test('should handle age with appears notation', () =>
    {
        const result = parseTitleCard('VAMPIRE | Age 500 (appears 25)');

        expect(result?.content).toBe('VAMPIRE');
        expect(result?.meta?.age).toBe('Age 500 (appears 25)');
    });

    test('should handle mixed case class names', () =>
    {
        const result = parseTitleCard('Super Hero Class | MEGA MAN | Power Level 9000');

        expect(result?.content).toBe('MEGA MAN');
        expect(result?.meta?.subheader).toBe('Super Hero Class');
        expect(result?.meta?.age).toBe('Power Level 9000');
    });
});

// =============================================================================
// TITLE CARD TYPES
// =============================================================================

describe('parseTitleCard - Special Types', () =>
{
    test('should handle robot-style title card', () =>
    {
        const result = parseTitleCard('Combat Unit : Model Series | UNIT 7 | Production Year 2045');

        expect(result?.content).toBe('UNIT 7');
        expect(result?.meta?.epithet).toBe('Combat Unit');
        expect(result?.meta?.subheader).toBe('Model Series');
        expect(result?.meta?.age).toBe('Production Year 2045');
    });

    test('should handle villain-style title card', () =>
    {
        const result = parseTitleCard('World Destroyer : S-Rank Threat | DOOM LORD | Kills: 1000000+');

        expect(result?.content).toBe('DOOM LORD');
        expect(result?.meta?.epithet).toBe('World Destroyer');
        expect(result?.meta?.subheader).toBe('S-Rank Threat');
        expect(result?.meta?.age).toBe('Kills: 1000000+');
    });

    test('should handle organization-style title card', () =>
    {
        const result = parseTitleCard('Shadow Guild | GRAND MASTER | Founded 1892');

        expect(result?.content).toBe('GRAND MASTER');
        expect(result?.meta?.subheader).toBe('Shadow Guild');
        expect(result?.meta?.age).toBe('Founded 1892');
    });
});

// =============================================================================
// NAME VARIATIONS
// =============================================================================

describe('parseTitleCard - Name Variations', () =>
{
    test('should parse single word name', () =>
    {
        const result = parseTitleCard('ORACLE | Age Unknown');

        expect(result?.content).toBe('ORACLE');
    });

    test('should parse name with numbers', () =>
    {
        const result = parseTitleCard('AGENT 47 | Age Classified');

        expect(result?.content).toBe('AGENT 47');
    });

    test('should parse name with ampersand', () =>
    {
        const result = parseTitleCard('BONNIE & CLYDE | Partners in Crime');

        expect(result?.content).toBe('BONNIE & CLYDE');
        expect(result?.meta?.age).toBe('Partners in Crime');
    });

    test('should parse title with roman numerals in name', () =>
    {
        const result = parseTitleCard('Royal Lineage : King | CHARLES III | Age 75');

        expect(result?.content).toBe('CHARLES III');
        expect(result?.meta?.epithet).toBe('Royal Lineage');
        expect(result?.meta?.subheader).toBe('King');
    });

    test('should parse Japanese-style name order', () =>
    {
        const result = parseTitleCard('TANAKA HIROSHI | Age 28');

        expect(result?.content).toBe('TANAKA HIROSHI');
    });
});

// =============================================================================
// COLON HANDLING
// =============================================================================

describe('parseTitleCard - Colon Handling', () =>
{
    test('should correctly split epithet and class on first colon', () =>
    {
        const result = parseTitleCard('Title: Subtitle : Class | NAME | Info');

        // First colon splits epithet from class
        expect(result?.meta?.epithet).toBe('Title');
        expect(result?.meta?.subheader).toBe('Subtitle : Class');
    });

    test('should handle colon in age info', () =>
    {
        const result = parseTitleCard('UNIT 7 | Model: X7-Combat');

        expect(result?.content).toBe('UNIT 7');
        expect(result?.meta?.age).toBe('Model: X7-Combat');
    });

    test('should handle only class (no epithet)', () =>
    {
        const result = parseTitleCard('Warrior Class | HERO | Age 25');

        expect(result?.meta?.epithet).toBeUndefined();
        expect(result?.meta?.subheader).toBe('Warrior Class');
    });
});

// =============================================================================
// OUTPUT STRUCTURE
// =============================================================================

describe('parseTitleCard - Output Structure', () =>
{
    test('should always return type as title_card', () =>
    {
        const result = parseTitleCard('NAME | Age 1');

        expect(result?.type).toBe('title_card');
    });

    test('should always have content field for name', () =>
    {
        const result = parseTitleCard('TEST | Info');

        expect(result?.content).toBeDefined();
        expect(typeof result?.content).toBe('string');
    });

    test('should always have meta object', () =>
    {
        const result = parseTitleCard('NAME | Age');

        expect(result?.meta).toBeDefined();
        expect(typeof result?.meta).toBe('object');
    });

    test('should not include undefined values in meta', () =>
    {
        const result = parseTitleCard('NAME | Info');

        // When parsed correctly, only age should be set
        const metaKeys = Object.keys(result?.meta || {});
        expect(metaKeys.every(k => result?.meta?.[k] !== undefined)).toBe(true);
    });
});

// =============================================================================
// PARENTHETICAL-SIBLING NAME DETECTION (Title Case names)
// =============================================================================

describe('parseTitleCard - Parenthetical-sibling name detection', () =>
{
    test('Title Case name + parenthetical age: "Cincinnati Cid | (19)"', () =>
    {
        const result = parseTitleCard('Cincinnati Cid | (19)');

        expect(result).not.toBeNull();
        expect(result?.content).toBe('Cincinnati Cid');
        expect(result?.meta?.age).toBe('(19)');
        // Segments: name first, then parenthetical.
        expect(result?.meta?.segments?.[0]).toEqual({ text: 'Cincinnati Cid', isName: true });
        expect(result?.meta?.segments?.[1]).toEqual({ text: '(19)', isName: false });
    });

    test('Title Case name + parenthetical age: "Minnesota Baddie | (19)"', () =>
    {
        const result = parseTitleCard('Minnesota Baddie | (19)');

        expect(result?.content).toBe('Minnesota Baddie');
        expect(result?.meta?.age).toBe('(19)');
    });

    test('Parenthetical FIRST: "(19) | Cincinnati Cid" still picks the non-paren as name', () =>
    {
        const result = parseTitleCard('(19) | Cincinnati Cid');

        expect(result?.content).toBe('Cincinnati Cid');
    });

    test('lowercase name + parenthetical: still picks the non-paren as name', () =>
    {
        const result = parseTitleCard('hiroshi tanaka | (28)');

        expect(result?.content).toBe('hiroshi tanaka');
    });

    test('ALL CAPS heuristic still wins when both are non-parenthetical', () =>
    {
        const result = parseTitleCard('Executive Class | DOROTHY');

        expect(result?.content).toBe('DOROTHY');
        expect(result?.meta?.subheader).toBe('Executive Class');
    });

    test('both segments parenthetical: falls back to first', () =>
    {
        const result = parseTitleCard('(role) | (age)');

        expect(result?.content).toBe('(role)');
    });
});
