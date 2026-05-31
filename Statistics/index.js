import * as analyzers from './analyzers.js';

const {
    countWords, countSyllables, countSentences, stripInlineNotes,
    estimateDialogueDuration, estimateActionDuration, slugify,
    normalizeTime, parseSceneHeading, resolveIntExt, normalizeCharacterFallback
} = analyzers;

/**
 * @param {string} text
 * @param {boolean} isMangaplay
 * @returns {string}
 */
function normalizeChar(text, isMangaplay)
{
    if (isMangaplay)
    {
        if (!text || typeof text !== 'string') return '';
        return text
            .replace(/\s*\^\s*$/, '')
            .replace(/\s*\((?:V\.?O\.?|O\.?S\.?|O\.?P\.?|O\.?C\.?|CONT['’]?D|CONTINUED)\)\s*$/i, '')
            .trim()
            .toUpperCase();
    }
    return normalizeCharacterFallback(text);
}

const WARN_EMPTY_INPUT = 'EMPTY_INPUT';
const WARN_NO_SCENES = 'NO_SCENES';
const WARN_ORPHAN_DIALOGUE = 'ORPHAN_DIALOGUE';
const WARN_UNKNOWN_TOKEN = 'UNKNOWN_TOKEN_TYPE';

const KNOWN_TYPES = new Set([
    'scene_heading', 'action', 'character', 'dialogue', 'parenthetical',
    'section', 'transition', 'synopsis', 'page_break', 'note', 'panel'
]);

/**
 * @typedef {{ type: string, depth: number, text: string, line: number, children: OutlineNode[] }} OutlineNode
 * @typedef {{ name: string, displayName: string, speakingParts: number, wordsSpoken: number, secondsSpoken: number, linesSpoken: number, firstAppearance: number|null, lastAppearance: number|null, sceneNumbers: number[], monologues: number }} CharacterStat
 * @typedef {{ name: string, slug: string, interiorExterior: string, timesOfDay: string[], sceneCount: number, sceneNumbers: number[], lines: number[] }} LocationStat
 * @typedef {{ dialogueSeconds: number, actionSeconds: number, totalSeconds: number, dialoguePercent: number, actionPercent: number, scenes: object[] }} DurationStat
 * @typedef {{ words: number, characters: number, charactersNoSpace: number, lines: number, nonEmptyElements: number, scenes: number, pages: number, elemPages: number, panels: number }} LengthStat
 * @typedef {{ medianGradeLevel: number, characters: object[] }} ReadabilityStat
 * @typedef {{ code: string, message: string, line?: number }} StatWarning
 */

/**
 * Convert a Screenplay object (scenes + elements) to flat token array.
 * Shared between the fountain.plus checker and test suite.
 * @param {object} screenplay
 * @returns {object[]}
 */
export function screenplayToTokens(screenplay)
{
    const result = [];
    let lineNum = 1;
    let sceneIdx = 0;

    if (!screenplay || !screenplay.scenes) return result;

    for (const scene of screenplay.scenes)
    {
        sceneIdx++;
        result.push({
            type: 'scene_heading',
            text: scene.heading || '',
            line: scene.elements?.[0]?.sourceLineStart ?? lineNum,
            location: scene.location || null,
            sceneIdx: sceneIdx,
            elementIdx: -1
        });
        lineNum += 2;

        if (!scene.elements) continue;

        for (let i = 0; i < scene.elements.length; i++)
        {
            const el = scene.elements[i];
            const fullText = el.type === 'character' && el.meta?.modifier
                ? `${el.content || ''} (${el.meta.modifier})`
                : (el.content || '');
            const mapped = {
                type: el.type,
                text: fullText,
                line: el.sourceLineStart ?? lineNum,
                sceneIdx: sceneIdx,
                elementIdx: i
            };
            if (el.type === 'character' && el.meta?.modifier)
            {
                mapped.originalText = fullText;
            }

            // Map title_card and sfx to action for stats compatibility
            if (el.type === 'title_card' || el.type === 'sfx' || el.type === 'soundtrack')
            {
                mapped.type = 'action';
            }

            result.push(mapped);
            lineNum++;
        }
    }

    return result;
}

const CHAR_EXTENSION_RE = /\s*(?:\([^)]+\)\s*)+$/;
const HEADING_SLUG_RE = /^(INT|EXT|EST|INT\.?\/?EXT|EXT\.?\/?INT|I\.?\/?E|E\.?\/?I)[\.\s]/i;
const NON_STANDARD_HEADING_RE = /^(FLASHBACK|FLASH BACK|MONTAGE|INTERCUT|BACK TO SCENE|DREAM SEQUENCE|FANTASY SEQUENCE|TIME CUT|SERIES OF SHOTS)\b/i;
const COLLAPSE_THRESHOLD = 5;
const COLLAPSIBLE_CODES = new Set(['FORMAT_CHAR_CASE', 'FORMAT_HEADING_CASE', 'FORMAT_PAREN_WRAPPED']);

/**
 * Normalise tokens for cross-format consistency.
 * @param {object[]} tokens
 * @param {{ format?: 'fountain'|'fdx'|'fadein'|'txt'|'pdf'|'mangaplay' }} options
 * @returns {{ tokens: object[], fixes: object[] }}
 */
export function normaliseTokens(tokens, options = {})
{
    const fixes = [];
    const removeSet = new Set();

    // Pass 1 — per-token normalisation
    for (let i = 0; i < tokens.length; i++)
    {
        const token = tokens[i];

        if (token.type === 'character')
        {
            token.text = token.text.replace(/^\*{1,3}|\*{1,3}$/g, '').trim();

            const upper = token.text.toUpperCase();
            if (upper !== token.text)
            {
                fixes.push({
                    code: 'FORMAT_CHAR_CASE',
                    source: 'format',
                    status: 'fixed',
                    original: token.text,
                    fixed: upper,
                    line: token.line,
                    sceneIdx: token.sceneIdx,
                    elementIdx: token.elementIdx,
                    autoFixable: false
                });
                token.text = upper;
            }

            token.text = token.text.replace(/[‘’`]/g, "'");

            const stripped = token.text.replace(CHAR_EXTENSION_RE, '');
            if (stripped !== token.text)
            {
                if (!token.originalText)
                {
                    token.originalText = token.text;
                }
                token.text = stripped;
            }
        }
        else if (token.type === 'scene_heading')
        {
            const trimmed = token.text.trim();
            if (trimmed !== token.text)
            {
                fixes.push({
                    code: 'FORMAT_HEADING_WHITESPACE',
                    source: 'format',
                    status: 'fixed',
                    original: token.text,
                    fixed: trimmed,
                    line: token.line,
                    sceneIdx: token.sceneIdx,
                    elementIdx: token.elementIdx,
                    autoFixable: false
                });
                token.text = trimmed;
            }

            const upper = token.text.toUpperCase();
            if (upper !== token.text)
            {
                fixes.push({
                    code: 'FORMAT_HEADING_CASE',
                    source: 'format',
                    status: 'fixed',
                    original: token.text,
                    fixed: upper,
                    line: token.line,
                    sceneIdx: token.sceneIdx,
                    elementIdx: token.elementIdx,
                    autoFixable: false
                });
                token.text = upper;
            }

            token.text = token.text.replace(/[‘’`]/g, "'");
        }
        else if (token.type === 'parenthetical')
        {
            if (token.text.startsWith('(') && token.text.endsWith(')'))
            {
                const unwrapped = token.text.slice(1, -1).trim();
                fixes.push({
                    code: 'FORMAT_PAREN_WRAPPED',
                    source: 'format',
                    status: 'fixed',
                    original: token.text,
                    fixed: unwrapped,
                    line: token.line,
                    sceneIdx: token.sceneIdx,
                    elementIdx: token.elementIdx,
                    autoFixable: false
                });
                token.text = unwrapped;
            }
        }

        if (token.type === 'dialogue' || token.type === 'action')
        {
            token.text = token.text
                .replace(/\*{1,3}(.+?)\*{1,3}/g, '$1')
                .replace(/_(.+?)_/g, '$1')
                .replace(/[‘’`]/g, "'")
                .replace(/[“”]/g, '"')
                .replace(/^\s+/, '')
                .replace(/\s+$/, '');
        }

        if (!token.text || token.text.trim() === '')
        {
            removeSet.add(i);
            fixes.push({
                code: 'FORMAT_EMPTY_TOKEN',
                source: 'format',
                status: 'fixed',
                original: token.type,
                fixed: '(removed)',
                message: `Empty ${token.type} token removed`,
                line: token.line,
                sceneIdx: token.sceneIdx,
                elementIdx: token.elementIdx,
                autoFixable: false
            });
        }
    }

    // Pass 2 — phantom cue detection
    for (let i = 0; i < tokens.length; i++)
    {
        if (removeSet.has(i)) continue;
        if (tokens[i].type !== 'character') continue;

        let found = false;
        for (let j = i + 1; j < tokens.length; j++)
        {
            if (removeSet.has(j)) continue;
            if (tokens[j].type === 'parenthetical') continue;

            if (tokens[j].type !== 'dialogue')
            {
                fixes.push({
                    code: 'FORMAT_PHANTOM_CUE',
                    source: 'format',
                    status: 'fixed',
                    original: tokens[i].text,
                    fixed: 'action',
                    message: `"${tokens[i].text}" reclassified: not a character cue (no dialogue follows)`,
                    line: tokens[i].line,
                    sceneIdx: tokens[i].sceneIdx,
                    elementIdx: tokens[i].elementIdx,
                    autoFixable: false
                });
                tokens[i].type = 'action';
            }
            found = true;
            break;
        }
        if (!found)
        {
            fixes.push({
                code: 'FORMAT_PHANTOM_CUE',
                source: 'format',
                status: 'fixed',
                original: tokens[i].text,
                fixed: 'action',
                message: `"${tokens[i].text}" reclassified: not a character cue (no dialogue follows)`,
                line: tokens[i].line,
                sceneIdx: tokens[i].sceneIdx,
                elementIdx: tokens[i].elementIdx,
                autoFixable: false
            });
            tokens[i].type = 'action';
        }
    }

    // Pass 3 — dubious heading detection
    for (let i = 0; i < tokens.length; i++)
    {
        if (removeSet.has(i)) continue;
        if (tokens[i].type !== 'scene_heading') continue;
        if (!tokens[i].text) continue;

        if (!HEADING_SLUG_RE.test(tokens[i].text) && !NON_STANDARD_HEADING_RE.test(tokens[i].text))
        {
            fixes.push({
                code: 'FORMAT_DUBIOUS_HEADING',
                source: 'format',
                status: 'fixed',
                original: tokens[i].text,
                fixed: tokens[i].text,
                line: tokens[i].line,
                sceneIdx: tokens[i].sceneIdx,
                elementIdx: tokens[i].elementIdx,
                autoFixable: false
            });
            tokens[i].type = 'action';
        }
    }

    // Collapse high-volume fix codes into summary entries
    for (const code of COLLAPSIBLE_CODES)
    {
        const indices = [];
        for (let i = 0; i < fixes.length; i++)
        {
            if (fixes[i].code === code) indices.push(i);
        }

        if (indices.length > COLLAPSE_THRESHOLD)
        {
            const detailMap = new Map();
            for (const idx of indices)
            {
                detailMap.set(fixes[idx].line, { code: fixes[idx].code, original: fixes[idx].original, fixed: fixes[idx].fixed });
            }

            const summary = {
                code,
                source: 'format',
                status: 'fixed',
                message: `${indices.length} ${code} fixes applied`,
                count: indices.length,
                autoFixable: false,
                _detailMap: detailMap
            };

            for (let k = indices.length - 1; k >= 0; k--)
            {
                fixes.splice(indices[k], 1);
            }
            fixes.push(summary);
        }
    }

    const filtered = tokens.filter((_, i) => !removeSet.has(i));

    return { tokens: filtered, fixes };
}

/**
 * Single-pass statistics computation over parsed tokens.
 * @param {object[]} tokens
 * @param {{ isMangaplay?: boolean }} options
 * @returns {{ outline: OutlineNode[], characters: CharacterStat[], locations: LocationStat[], duration: DurationStat, length: LengthStat, readability: ReadabilityStat, warnings: StatWarning[] }}
 */

const LAYOUT_CHARS = { action: 60, dialogue: 39, parenthetical: 25, sceneHeading: 60 };
const LINES_PER_PAGE = 55;

function wrapLineCount(text, maxChars)
{
    if (!text) return 1;
    const stripped = text.replace(/\*{1,3}|_/g, '');
    if (stripped.length <= maxChars) return 1;
    const words = stripped.split(/\s+/);
    let lines = 1;
    let lineLen = 0;
    for (const word of words)
    {
        if (!word) continue;
        if (lineLen === 0)
        {
            lineLen = word.length;
        }
        else if (lineLen + 1 + word.length <= maxChars)
        {
            lineLen += 1 + word.length;
        }
        else
        {
            lines++;
            lineLen = word.length;
        }
    }
    return lines;
}

function countLayoutPages(tokens, hasTitlePage)
{
    let pageCount = 0;
    let lineCount = 0;
    let inDialogueBlock = false;

    function flush()
    {
        if (lineCount > 0)
        {
            pageCount++;
            lineCount = 0;
        }
    }

    function addLines(n, isBlank)
    {
        if (lineCount + n > LINES_PER_PAGE)
        {
            if (inDialogueBlock) lineCount++;
            flush();
            if (inDialogueBlock) lineCount++;
        }
        if (lineCount === 0 && isBlank) return;
        lineCount += n;
    }

    function addBlank() { addLines(1, true); }

    for (let ti = 0; ti < tokens.length; ti++)
    {
        const tok = tokens[ti];
        switch (tok.type)
        {
            case 'scene_heading':
            {
                inDialogueBlock = false;
                if (lineCount + 3 > LINES_PER_PAGE) flush();
                addBlank();
                addBlank();
                const headingLines = wrapLineCount(tok.text, LAYOUT_CHARS.sceneHeading);
                addLines(headingLines, false);
                break;
            }
            case 'character':
            {
                inDialogueBlock = true;
                const next = tokens[ti + 1];
                const need = next && (next.type === 'dialogue' || next.type === 'parenthetical') ? 3 : 2;
                if (lineCount + need > LINES_PER_PAGE) flush();
                addBlank();
                addLines(1, false);
                break;
            }
            case 'dialogue':
            {
                const paragraphs = (tok.text || '').split('\n');
                for (const para of paragraphs)
                {
                    addLines(wrapLineCount(para, LAYOUT_CHARS.dialogue), false);
                }
                break;
            }
            case 'action':
            {
                inDialogueBlock = false;
                if (lineCount > 0) addBlank();
                const paragraphs = (tok.text || '').split('\n');
                for (const para of paragraphs)
                {
                    addLines(wrapLineCount(para, LAYOUT_CHARS.action), false);
                }
                break;
            }
            case 'parenthetical':
            {
                addLines(wrapLineCount(tok.text, LAYOUT_CHARS.parenthetical), false);
                break;
            }
            case 'transition':
            {
                inDialogueBlock = false;
                if (lineCount + 2 > LINES_PER_PAGE) flush();
                addBlank();
                addLines(1, false);
                break;
            }
            case 'page_break':
                inDialogueBlock = false;
                flush();
                break;
            default:
                if (tok.text)
                {
                    inDialogueBlock = false;
                    addLines(1, false);
                }
                break;
        }
    }
    if (lineCount > 0) pageCount++;
    if (hasTitlePage) pageCount++;
    return pageCount;
}

export function computeStatistics(tokens, options)
{
    if (!options || options.isMangaplay === undefined)
    {
        throw new Error('computeStatistics: options.isMangaplay is required');
    }
    if (options.hasTitlePage === undefined)
    {
        throw new Error('computeStatistics: options.hasTitlePage is required');
    }
    const { isMangaplay, printedPageCount, hasTitlePage } = options;
    const warnings = [];

    // Outline state
    const outlineRoot = { depth: 0, children: [] };
    const outlineStack = [outlineRoot];
    let lastScene = null;

    // Character state
    const charMap = new Map();
    let currentCharacter = null;

    // Location state
    const locMap = new Map();
    let sceneNumber = 0;

    // Duration state
    let totalDialogue = 0;
    let totalAction = 0;
    const sceneDurations = [];
    let currentSceneDur = { heading: '', dialogue: 0, action: 0, line: 0, sceneIdx: null, elementIdx: null };

    // Length state
    let wordCount = 0;
    let charCount = 0;
    let charsNoSpace = 0;
    let maxLine = 0;
    let panelCount = 0;
    let sceneCount = 0;

    if (!tokens || tokens.length === 0)
    {
        warnings.push({ code: WARN_EMPTY_INPUT, message: 'No tokens provided' });
        return {
            outline: [], characters: [], locations: [],
            duration: { dialogueSeconds: 0, actionSeconds: 0, totalSeconds: 0, dialoguePercent: 0, actionPercent: 0, scenes: [] },
            length: { words: 0, characters: 0, charactersNoSpace: 0, lines: 0, nonEmptyElements: 0, scenes: 0, pages: 0, elemPages: 0, panels: 0 },
            readability: { medianGradeLevel: 0, characters: [] },
            warnings
        };
    }

    let monoChar = null;
    let monoSeconds = 0;
    let previousSpeaker = null;
    const recentTokens = []; // rolling buffer for warning context

    for (const token of tokens)
    {
        const type = token.type;

        if (!KNOWN_TYPES.has(type) || (type === 'panel' && !isMangaplay))
        {
            if (!KNOWN_TYPES.has(type))
            {
                warnings.push({ code: WARN_UNKNOWN_TOKEN, message: `Unknown token type: ${type}`, line: token.line, sceneIdx: token.sceneIdx, elementIdx: token.elementIdx });
            }
            continue;
        }

        const text = token.text || '';

        // Length accumulators
        if (type !== 'parenthetical')
        {
            wordCount += countWords(text);
            charCount += text.length;
            charsNoSpace += text.replace(/\s/g, '').length;
        }
        if (token.line > maxLine) maxLine = token.line;

        switch (type)
        {
            case 'scene_heading':
            {
                sceneNumber++;
                sceneCount++;
                if (sceneNumber > 1)
                {
                    sceneDurations.push({ ...currentSceneDur });
                }
                currentSceneDur = { heading: text, dialogue: 0, action: 0, line: token.line, sceneIdx: token.sceneIdx, elementIdx: token.elementIdx };

                // Outline
                const sceneNode = { type: 'scene', depth: outlineStack.length, text, line: token.line, sceneIdx: token.sceneIdx, elementIdx: token.elementIdx, children: [] };
                outlineStack[outlineStack.length - 1].children.push(sceneNode);
                lastScene = sceneNode;

                // Locations
                const parsed = isMangaplay && token.location
                    ? { location: token.location.place || text, intExt: (token.location.type || '').toLowerCase(), timeOfDay: token.location.time || '' }
                    : parseSceneHeading(text);
                const locSlug = slugify(parsed.location);
                if (!locMap.has(locSlug))
                {
                    locMap.set(locSlug, { name: parsed.location, slug: locSlug, intExt: new Set(), times: new Set(), sceneNumbers: [], lines: [], elementRefs: [] });
                }
                const loc = locMap.get(locSlug);
                loc.intExt.add(parsed.intExt);
                if (parsed.timeOfDay) loc.times.add(normalizeTime(parsed.timeOfDay));
                loc.sceneNumbers.push(sceneNumber);
                loc.lines.push(token.line);
                loc.elementRefs.push({ sceneIdx: token.sceneIdx, elementIdx: token.elementIdx });

                if (monoChar && monoSeconds > 30 && charMap.has(monoChar))
                {
                    charMap.get(monoChar).monologues++;
                }
                monoChar = null;
                monoSeconds = 0;
                currentCharacter = null;
                previousSpeaker = null;
                break;
            }

            case 'character':
            {
                currentCharacter = normalizeChar(text, isMangaplay);
                if (!charMap.has(currentCharacter))
                {
                    charMap.set(currentCharacter, {
                        name: currentCharacter,
                        displayName: text.trim(),
                        speakingParts: 0,
                        wordsSpoken: 0,
                        secondsSpoken: 0,
                        dialogueText: '',
                        scenes: new Set(),
                        monologues: 0,
                        linesSpoken: 0,
                        firstAppearance: null,
                        lastAppearance: null
                    });
                }
                charMap.get(currentCharacter).scenes.add(sceneNumber);
                break;
            }

            case 'dialogue':
            {
                if (!currentCharacter)
                {
                    const dialogueSnippet = text.length > 80 ? text.slice(0, 77) + '...' : text;
                    const context = recentTokens.slice(-2).map(t => ({ type: t.type, text: (t.text || '').slice(0, 60) }));
                    warnings.push({ code: WARN_ORPHAN_DIALOGUE, message: 'Dialogue without character: "' + dialogueSnippet + '"', line: token.line, sceneIdx: token.sceneIdx, elementIdx: token.elementIdx, context });
                    continue;
                }
                const acc = charMap.get(currentCharacter);
                if (currentCharacter !== previousSpeaker)
                {
                    acc.speakingParts++;
                }
                previousSpeaker = currentCharacter;
                acc.linesSpoken++;
                if (acc.firstAppearance === null) acc.firstAppearance = sceneNumber;
                acc.lastAppearance = sceneNumber;
                const words = countWords(text);
                acc.wordsSpoken += words;
                acc.dialogueText += text + ' ';
                const seconds = estimateDialogueDuration(text);
                acc.secondsSpoken += seconds;
                if (currentCharacter === monoChar)
                {
                    monoSeconds += seconds;
                }
                else
                {
                    if (monoChar && monoSeconds > 30 && charMap.has(monoChar))
                    {
                        charMap.get(monoChar).monologues++;
                    }
                    monoChar = currentCharacter;
                    monoSeconds = seconds;
                }
                currentSceneDur.dialogue += seconds;
                totalDialogue += seconds;
                break;
            }

            case 'parenthetical':
                break;

            case 'action':
            {
                if (monoChar && monoSeconds > 30 && charMap.has(monoChar))
                {
                    charMap.get(monoChar).monologues++;
                }
                monoChar = null;
                monoSeconds = 0;
                const seconds = estimateActionDuration(text);
                currentSceneDur.action += seconds;
                totalAction += seconds;
                currentCharacter = null;
                previousSpeaker = null;
                break;
            }

            case 'panel':
            {
                if (monoChar && monoSeconds > 30 && charMap.has(monoChar))
                {
                    charMap.get(monoChar).monologues++;
                }
                monoChar = null;
                monoSeconds = 0;
                panelCount++;
                const seconds = estimateActionDuration(text);
                currentSceneDur.action += seconds;
                totalAction += seconds;
                currentCharacter = null;
                previousSpeaker = null;
                break;
            }

            case 'section':
            {
                const sectionNode = { type: 'section', depth: token.depth || 1, text, line: token.line, sceneIdx: token.sceneIdx, elementIdx: token.elementIdx, children: [] };
                while (outlineStack[outlineStack.length - 1].depth >= sectionNode.depth)
                {
                    outlineStack.pop();
                }
                outlineStack[outlineStack.length - 1].children.push(sectionNode);
                outlineStack.push(sectionNode);
                currentCharacter = null;
                break;
            }

            case 'transition':
            case 'page_break':
                if (monoChar && monoSeconds > 30 && charMap.has(monoChar))
                {
                    charMap.get(monoChar).monologues++;
                }
                monoChar = null;
                monoSeconds = 0;
                currentCharacter = null;
                break;

            case 'synopsis':
            {
                const synTarget = lastScene || outlineStack[outlineStack.length - 1];
                synTarget.children.push({ type: 'synopsis', text, line: token.line, sceneIdx: token.sceneIdx, elementIdx: token.elementIdx, depth: synTarget.depth + 1, children: [] });
                break;
            }

            case 'note':
            {
                const noteTarget = lastScene || outlineStack[outlineStack.length - 1];
                noteTarget.children.push({ type: 'note', text, line: token.line, sceneIdx: token.sceneIdx, elementIdx: token.elementIdx, depth: noteTarget.depth + 1, children: [] });
                break;
            }
        }

        recentTokens.push(token);
        if (recentTokens.length > 3) recentTokens.shift();
    }

    // Flush final monologue accumulator
    if (monoChar && monoSeconds > 30 && charMap.has(monoChar))
    {
        charMap.get(monoChar).monologues++;
    }

    // Push final scene duration
    if (sceneNumber > 0)
    {
        sceneDurations.push({ ...currentSceneDur });
    }

    if (sceneCount === 0)
    {
        warnings.push({ code: WARN_NO_SCENES, message: 'No scene headings found' });
    }

    // Build results
    const totalSeconds = totalDialogue + totalAction;
    const outline = outlineRoot.children;

    const characters = [...charMap.values()]
        .map(c => ({
            name: c.name,
            displayName: c.displayName,
            speakingParts: c.speakingParts,
            wordsSpoken: c.wordsSpoken,
            secondsSpoken: c.secondsSpoken,
            sceneNumbers: [...c.scenes],
            monologues: c.monologues
        }))
        .filter(c => c.speakingParts > 0)
        .sort((a, b) => b.speakingParts - a.speakingParts);

    const locations = [...locMap.values()].map(loc => ({
        name: loc.name,
        slug: loc.slug,
        interiorExterior: resolveIntExt(loc.intExt),
        timesOfDay: [...loc.times],
        sceneCount: loc.sceneNumbers.length,
        sceneNumbers: loc.sceneNumbers,
        lines: loc.lines,
        elementRefs: loc.elementRefs
    }));

    const duration = {
        dialogueSeconds: totalDialogue,
        actionSeconds: totalAction,
        totalSeconds,
        dialoguePercent: totalSeconds > 0 ? (totalDialogue / totalSeconds) * 100 : 0,
        actionPercent: totalSeconds > 0 ? (totalAction / totalSeconds) * 100 : 0,
        scenes: sceneDurations
    };

    const pages = totalSeconds > 0 ? totalSeconds / 60 : wordCount / 160;
    const elemPages = countLayoutPages(tokens, hasTitlePage);
    let nonEmptyElements = 0;
    for (const token of tokens)
    {
        if (token.text && token.text.trim().length > 0) nonEmptyElements++;
    }
    const length = {
        words: wordCount,
        characters: charCount,
        charactersNoSpace: charsNoSpace,
        lines: nonEmptyElements,
        nonEmptyElements,
        scenes: sceneCount,
        pages: Math.round(pages * 10) / 10,
        elemPages: Math.round(elemPages * 10) / 10,
        panels: panelCount
    };
    if (printedPageCount !== undefined) length.printedPages = printedPageCount;

    // Readability post-pass
    const charReadability = [];
    for (const c of charMap.values())
    {
        const text = c.dialogueText;
        const words = countWords(text);
        if (words < 50) continue;

        const sentences = countSentences(text);
        const wordList = text.split(/\s+/).filter(w => w.length > 0);
        const syllables = wordList.reduce((sum, w) => sum + countSyllables(w), 0);
        const letters = text.replace(/[^a-z]/gi, '').length;

        const fk = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
        const L = (letters / words) * 100;
        const S = (sentences / words) * 100;
        const cli = 0.0588 * L - 0.296 * S - 15.8;

        const gradeLevel = (fk + cli) / 2;
        const ageEquivalent = Math.min(22, Math.round(gradeLevel) + 5);

        charReadability.push({ name: c.name, gradeLevel, ageEquivalent });
    }

    const grades = charReadability.map(r => r.gradeLevel).sort((a, b) => a - b);
    const medianGradeLevel = grades.length > 0
        ? grades[Math.floor(grades.length / 2)]
        : 0;

    const readability = { medianGradeLevel, characters: charReadability };

    return { outline, characters, locations, duration, length, readability, warnings };
}

/** @param {object[]} tokens @param {{ isMangaplay?: boolean }} options */
export function computeOutline(tokens, options = {})
{
    return computeStatistics(tokens, options).outline;
}

/** @param {object[]} tokens @param {{ isMangaplay?: boolean }} options */
export function computeCharacters(tokens, options = {})
{
    return computeStatistics(tokens, options).characters;
}

/** @param {object[]} tokens @param {{ isMangaplay?: boolean }} options */
export function computeLocations(tokens, options = {})
{
    return computeStatistics(tokens, options).locations;
}

/** @param {object[]} tokens @param {{ isMangaplay?: boolean }} options */
export function computeDuration(tokens, options = {})
{
    return computeStatistics(tokens, options).duration;
}

/** @param {object[]} tokens @param {{ isMangaplay?: boolean }} options */
export function computeLength(tokens, options = {})
{
    return computeStatistics(tokens, options).length;
}

/** @param {object[]} tokens @param {{ isMangaplay?: boolean }} options */
export function computeReadability(tokens, options = {})
{
    return computeStatistics(tokens, options).readability;
}
