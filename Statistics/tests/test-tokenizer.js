/**
 * Simple tokenizer for stress tests.
 * Converts raw fountain/mangaplay text into token arrays
 * expected by computeStatistics.
 *
 * @param {string} text
 * @param {boolean} isMangaplay
 * @returns {object[]}
 */
export function simpleTokenize(text, isMangaplay = false)
{
    const tokens = [];
    const lines = text.split('\n');
    let lineNum = 0;
    let currentCharacter = null;

    for (const line of lines)
    {
        lineNum++;
        const trimmed = line.trim();
        if (!trimmed) { currentCharacter = null; continue; }

        // Scene heading
        if (/^(?:INT|EXT|EST|INT\.?\/?EXT|I\.?\/?E)[. ]/i.test(trimmed) || /^\.(?!\.)/.test(trimmed))
        {
            tokens.push({ type: 'scene_heading', text: trimmed, line: lineNum });
            currentCharacter = null;
            continue;
        }

        // Section
        const sectionMatch = trimmed.match(/^(#{1,5})\s+(.+)/);
        if (sectionMatch)
        {
            tokens.push({ type: 'section', text: sectionMatch[2], line: lineNum, depth: sectionMatch[1].length });
            currentCharacter = null;
            continue;
        }

        // Synopsis
        if (trimmed.startsWith('= '))
        {
            tokens.push({ type: 'synopsis', text: trimmed.slice(2), line: lineNum });
            continue;
        }

        // Note
        if (trimmed.startsWith('[[') && trimmed.endsWith(']]'))
        {
            tokens.push({ type: 'note', text: trimmed.slice(2, -2), line: lineNum });
            continue;
        }

        // Transition
        if (trimmed.startsWith('>') && !trimmed.startsWith('> '))
        {
            tokens.push({ type: 'transition', text: trimmed.slice(1).trim(), line: lineNum });
            currentCharacter = null;
            continue;
        }
        if (trimmed.startsWith('> '))
        {
            tokens.push({ type: 'transition', text: trimmed.slice(2).trim(), line: lineNum });
            currentCharacter = null;
            continue;
        }

        // Page break
        if (trimmed === '===')
        {
            tokens.push({ type: 'page_break', text: '', line: lineNum });
            currentCharacter = null;
            continue;
        }

        // Panel (mangaplay)
        if (isMangaplay && /^Panel\s+\d+/i.test(trimmed))
        {
            tokens.push({ type: 'panel', text: trimmed, line: lineNum });
            currentCharacter = null;
            continue;
        }

        // Page header in mangaplay -> treat as section
        if (isMangaplay && /^#\s+PAGE\s+\d+/i.test(trimmed))
        {
            tokens.push({ type: 'section', text: trimmed.replace(/^#\s+/, ''), line: lineNum, depth: 1 });
            continue;
        }

        // Character (ALL CAPS line, possibly with ^ or (V.O.) etc)
        if (/^[A-Z][A-Z\s.''-]+(?:\s*\^)?(?:\s*\(.*\))?$/.test(trimmed) && !currentCharacter)
        {
            tokens.push({ type: 'character', text: trimmed, line: lineNum });
            currentCharacter = trimmed;
            continue;
        }

        // Parenthetical
        if (currentCharacter && trimmed.startsWith('(') && trimmed.endsWith(')'))
        {
            tokens.push({ type: 'parenthetical', text: trimmed, line: lineNum });
            continue;
        }

        // Dialogue (after character)
        if (currentCharacter)
        {
            tokens.push({ type: 'dialogue', text: trimmed, line: lineNum });
            continue;
        }

        // Default: action
        tokens.push({ type: 'action', text: trimmed, line: lineNum });
    }

    return tokens;
}
