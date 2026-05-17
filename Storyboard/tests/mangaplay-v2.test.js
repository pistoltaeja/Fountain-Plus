/**
 * Mangaplay V2 Parser Tests
 * Phase 2 of TODO/MangaplayV2Plan.md — Fountain superset support.
 *
 * Each test loads a fixture under tests/mangaplay/v2/ (or
 * tests/fountain-corpus/) and asserts the parser surfaces the expected
 * AST shape and warning codes.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseScript, parseEmphasis } from '../core/parser/fountain-plus-mangaplay-parser.js';

const fix = (rel) => readFileSync(new URL('./mangaplay/v2/' + rel, import.meta.url), 'utf8');
const fountain = (rel) => readFileSync(new URL('./fountain-corpus/' + rel, import.meta.url), 'utf8');

// =============================================================================
// 1. Boneyard — single-line PANEL marker
// =============================================================================

describe('Mangaplay V2 — Boneyard', () =>
{
    test('single-line /* PANEL N [tag] */ becomes a panel marker', () =>
    {
        const ast = parseScript(fix('boneyard-panel-singleline.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].panels.length).toBeGreaterThanOrEqual(2);
        expect(ast.pages[0].panels[0].displayNumber).toBe(1);
        expect(ast.pages[0].panels[1].displayNumber).toBe(2);
    });

    test('multi-line /* PANEL N\\n [tag] */ becomes a panel marker', () =>
    {
        const ast = parseScript(fix('boneyard-panel-multiline.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].panels.length).toBe(2);
        expect(ast.pages[0].panels[0].displayNumber).toBe(1);
        expect(ast.pages[0].panels[1].displayNumber).toBe(2);
    });

    test('non-PANEL boneyard is dropped from output (author comment)', () =>
    {
        const ast = parseScript(fix('boneyard-author-comment.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].panels.length).toBe(2);
        // Description must NOT contain comment text.
        for (const p of ast.pages[0].panels)
        {
            expect(p.description || '').not.toContain('TODO:');
            expect(p.description || '').not.toContain('this comment spans');
        }
    });

    test('unterminated boneyard emits WARN_BONEYARD_UNTERMINATED at error severity', () =>
    {
        const ast = parseScript(fix('boneyard-unterminated.mangaplay'));
        const err = ast.errors.find(e => e.code === 'WARN_BONEYARD_UNTERMINATED');
        expect(err).toBeDefined();
        expect(err.severity).toBe('error');
    });
});

// =============================================================================
// 2. Notes [[ … ]]
// =============================================================================

describe('Mangaplay V2 — Notes', () =>
{
    test('inline notes attach to current panel', () =>
    {
        const ast = parseScript(fix('notes.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        const p = ast.pages[0].panels[0];
        expect(p.notes).toBeDefined();
        expect(p.notes.length).toBeGreaterThanOrEqual(1);
        expect(p.notes[0]).toContain('remember to revise');
    });
});

// =============================================================================
// 3. Standalone scene headings
// =============================================================================

describe('Mangaplay V2 — Standalone scene headings', () =>
{
    test('INT./EXT./EST./forced . scene headings attach to panel or page', () =>
    {
        const ast = parseScript(fix('scene-heading-standalone.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        const headings = (ast.pages[0].sceneHeadings || []).concat(
            ast.pages[0].panels.flatMap(p => p.sceneHeadings || [])
        );
        expect(headings.some(h => /INT\. KITCHEN - NIGHT/.test(h))).toBe(true);
        expect(headings.some(h => /EXT\. CLIFFTOP - DAY/.test(h))).toBe(true);
        // Forced `.kitchen` form (leading period stripped).
        expect(headings.some(h => /^kitchen$/.test(h))).toBe(true);
    });
});

// =============================================================================
// 4. Page-header lowercase warning
// =============================================================================

describe('Mangaplay V2 — Page header case warning', () =>
{
    test('# Page 1 / # page 2 emit WARN_PAGE_LOWERCASE; # PAGE 3 does not', () =>
    {
        const ast = parseScript(fix('lowercase-page-warns.mangaplay'));
        const warns = ast.warnings.filter(w => w.code === 'WARN_PAGE_LOWERCASE');
        expect(warns).toHaveLength(2);
        expect(warns[0].args).toEqual(['1', 'Page']);
        expect(warns[1].args).toEqual(['2', 'page']);
    });
});

// =============================================================================
// 5. Transitions
// =============================================================================

describe('Mangaplay V2 — Transitions', () =>
{
    test('CUT TO:, FADE OUT., FADE IN:, > forced are recognised', () =>
    {
        const ast = parseScript(fix('transitions.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        const allTrans = [
            ...(ast.pages[0].transitions || []),
            ...ast.pages[0].panels.flatMap(p => p.transitions || []),
            ...(ast.pages[1].transitions || []),
            ...ast.pages[1].panels.flatMap(p => p.transitions || [])
        ];
        expect(allTrans.some(t => /CUT TO:/.test(t))).toBe(true);
        expect(allTrans.some(t => /FADE OUT\./.test(t))).toBe(true);
        expect(allTrans.some(t => /FADE IN:/.test(t))).toBe(true);
        expect(allTrans.some(t => /SMASH CUT TO:/.test(t))).toBe(true);
    });
});

// =============================================================================
// 6. Forced character cue @alice
// =============================================================================

describe('Mangaplay V2 — Forced character cue', () =>
{
    test('@lowercase forces a cue regardless of casing', () =>
    {
        const ast = parseScript(fix('forced-cue.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        const dialogue = ast.pages[0].panels[0].dialogue;
        const characters = dialogue.map(d => d.character);
        expect(characters).toContain('alice');
        expect(characters).toContain('bob');
    });
});

// =============================================================================
// 7. Implicit Page 1
// =============================================================================

describe('Mangaplay V2 — Implicit Page 1', () =>
{
    test('content before any # PAGE → synthesised Page 1 with WARN_IMPLICIT_PAGE_1', () =>
    {
        const ast = parseScript(fix('implicit-page-1.mangaplay'));
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].id).toBe('1');
        const warn = ast.warnings.find(w => w.code === 'WARN_IMPLICIT_PAGE_1');
        expect(warn).toBeDefined();
    });
});

// =============================================================================
// 8. Action indentation
// =============================================================================

describe('Mangaplay V2 — Action indentation', () =>
{
    test('indented action in column-0 conv emits WARN_ACTION_INDENTED', () =>
    {
        // Convention B file with an indented prose line that is NOT a
        // name-like candidate (trailing period + > 4 words sidesteps the
        // ALL-CAPS speaker-name strict rule that fires at the dialogue band).
        const md = `Title: Test\n\n# PAGE 1\n\nPanel 1\n    Indented action prose that is too long to look like a speaker name.\n`;
        const ast = parseScript(md);
        const warn = ast.warnings.find(w => w.code === 'WARN_ACTION_INDENTED');
        expect(warn).toBeDefined();
    });
});

// =============================================================================
// 9. Emphasis spans
// =============================================================================

describe('Mangaplay V2 — Emphasis', () =>
{
    test('parseEmphasis returns null for plain text', () =>
    {
        expect(parseEmphasis('plain prose')).toBeNull();
    });

    test('*italic* / **bold** / ***bold italic*** / _underline_ produce styled spans', () =>
    {
        const spans = parseEmphasis('a *i* b **b** c ***bi*** d _u_');
        expect(spans).not.toBeNull();
        const styles = spans.map(s => s.style);
        expect(styles).toContain('italic');
        expect(styles).toContain('bold');
        expect(styles).toContain('bold-italic');
        expect(styles).toContain('underline');
    });

    test('emphasis on description and dialogue surfaces spans on AST', () =>
    {
        const ast = parseScript(fix('emphasis.mangaplay'));
        const panel = ast.pages[0].panels[0];
        expect(panel.spans).toBeDefined();
        expect(panel.spans.some(s => s.style === 'italic')).toBe(true);
        expect(panel.spans.some(s => s.style === 'bold')).toBe(true);
        expect(panel.spans.some(s => s.style === 'bold-italic')).toBe(true);
        expect(panel.spans.some(s => s.style === 'underline')).toBe(true);
    });
});

// =============================================================================
// 10. Centered + 11. Lyrics
// =============================================================================

describe('Mangaplay V2 — Centered text and lyrics', () =>
{
    test('> text < and ~text are recognised', () =>
    {
        const ast = parseScript(fix('centered-and-lyrics.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        const panel = ast.pages[0].panels[0];
        expect(panel.centered || []).toContain('THE END');
        expect((panel.lyrics || []).join('|')).toContain('la la la');
    });
});

// =============================================================================
// 12. Title-page continuation
// =============================================================================

describe('Mangaplay V2 — Title-page continuation', () =>
{
    test('continuation lines in title-page block do not produce errors', () =>
    {
        const ast = parseScript(fix('title-page-continuation.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        expect(ast.metadata.title).toBe('The Lighthouse');
        expect(ast.metadata.author).toBe('K. Taylor');
    });
});

// =============================================================================
// 13. Format: mangaplay tolerance (incl. v2 suffix)
// =============================================================================

describe('Mangaplay V2 — Format key tolerance', () =>
{
    test('Format: mangaplay v2 is read-tolerant (no error)', () =>
    {
        const ast = parseScript(fix('title-page-continuation.mangaplay'));
        // The fixture uses `Format: mangaplay v2`. No errors should fire.
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
    });
});

// =============================================================================
// 14. Forced page break ===
// =============================================================================

describe('Mangaplay V2 — Forced page break', () =>
{
    test('=== adjacent to # PAGE is silently dropped', () =>
    {
        const md = `Title: Test\n\n# PAGE 1\n===\n\nPanel 1\nFirst.\n`;
        const ast = parseScript(md);
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        expect(ast.pages).toHaveLength(1);
    });
});

// =============================================================================
// 15. Reserved markers
// =============================================================================

describe('Mangaplay V2 — Reserved markers', () =>
{
    test('## Chapter N and # SCENE N emit WARN_RESERVED_MARKER, not error', () =>
    {
        const ast = parseScript(fix('reserved-markers.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        const warns = ast.warnings.filter(w => w.code === 'WARN_RESERVED_MARKER');
        expect(warns.length).toBeGreaterThanOrEqual(1);
        // # SCENE 1 must be flagged.
        expect(warns.some(w => /SCENE/.test((w.args || [])[0] || ''))).toBe(true);
    });
});

// =============================================================================
// 16. Legacy # Panel N
// =============================================================================

describe('Mangaplay V2 — Legacy # Panel N', () =>
{
    test('# Panel N [tag] is recognised + emits WARN_LEGACY_PANEL', () =>
    {
        const ast = parseScript(fix('legacy-hash-panel.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        expect(ast.pages).toHaveLength(1);
        expect(ast.pages[0].panels.length).toBe(2);
        const warns = ast.warnings.filter(w => w.code === 'WARN_LEGACY_PANEL');
        expect(warns).toHaveLength(2);
    });
});

// =============================================================================
// Fountain conformance smoke test
// =============================================================================

describe('Mangaplay V2 — Fountain conformance smoke', () =>
{
    test('plain Fountain script parses with zero errors and zero panels', () =>
    {
        const ast = parseScript(fountain('smoke.mangaplay'));
        expect(ast.errors.filter(e => e.severity === 'error')).toEqual([]);
        // Title-page metadata picks up.
        expect(ast.metadata.title).toBe('Fountain Smoke Test');
        // No panels are inferred — Fountain has no panel concept.
        const totalPanels = ast.pages.reduce((s, p) => s + p.panels.length, 0);
        expect(totalPanels).toBe(0);
    });
});

// =============================================================================
// Warnings shape contract
// =============================================================================

describe('Mangaplay V2 — Warnings return shape', () =>
{
    test('parseScript returns both errors and warnings arrays', () =>
    {
        const ast = parseScript('Title: Foo\n\n# Page 1\n\nPanel 1\nA.\n');
        expect(Array.isArray(ast.errors)).toBe(true);
        expect(Array.isArray(ast.warnings)).toBe(true);
        // The lowercase "Page" produces a warning.
        const w = ast.warnings.find(x => x.code === 'WARN_PAGE_LOWERCASE');
        expect(w).toBeDefined();
        expect(w.args).toEqual(['1', 'Page']);
        expect(typeof w.line).toBe('number');
        expect(w.severity).toBe('warning');
    });
});
