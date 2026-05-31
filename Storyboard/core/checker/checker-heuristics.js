/**
 * Heuristics Engine for the Screenplay Checker.
 *
 * Runs 12 deterministic structural checks on a parsed screenplay.
 * No external imports — tokens and stats are passed in.
 *
 * @typedef {{ type: string, text: string, line: number }} Token
 *
 * @typedef {{ check: string, title: string, severity: 'warning', passed: boolean, items: HeuristicItem[] }} HeuristicResult
 * @typedef {{ message: string, line: number|null, sceneIdx: number|null, elementIdx: number|null, character?: string, scene?: number }} HeuristicItem
 */

/**
 * Compute Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b)
{
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
    {
        for (let j = 1; j <= n; j++)
        {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[m][n];
}

/** Generic cues to exclude from one-line-character checks */
const GENERIC_CUES = new Set([
    'ALL', 'EVERYONE', 'CROWD', 'GROUP', 'CHORUS',
    'NARRATOR', 'NARRATION', 'TITLE', 'SFX', 'CONT',
    'CUT', 'FADE', 'DISSOLVE', 'SMASH', 'INTERCUT',
    'FLASHBACK', 'MONTAGE', 'SUPER', 'CHYRON',
    'INT', 'EXT', 'EST', 'LATER', 'CONTINUOUS',
    'DAY', 'NIGHT', 'MORNING', 'EVENING', 'NOON',
    'DAWN', 'DUSK', 'SUNSET', 'SUNRISE',
    'CONTINUED', 'MORE', 'END', 'THE',
    'CLOSE', 'WIDE', 'ANGLE', 'SHOT', 'INSERT',
    'SERIES', 'SHOTS', 'VARIOUS', 'RESUME',
    'BACK', 'SAME', 'TIME', 'MOMENTS',
    'SUDDENLY', 'BEAT', 'PAUSE', 'SILENCE',
]);

/** Emotion words for excessive-parentheticals check */
const EMOTION_WORDS = new Set([
    'angrily', 'sadly', 'excitedly', 'nervously', 'happily', 'sarcastically',
    'quietly', 'loudly', 'softly', 'coldly', 'warmly', 'bitterly',
    'cheerfully', 'fearfully', 'hesitantly', 'impatiently', 'irritably',
    'lovingly', 'mockingly', 'passionately', 'playfully', 'proudly',
    'reluctantly', 'shyly', 'sternly', 'tearfully', 'tenderly', 'tiredly',
    'triumphantly', 'urgently', 'wearily', 'wistfully', 'worriedly',
    'anxiously', 'desperately', 'furiously', 'gently', 'grimly',
    'hopefully', 'joyfully',
]);

/** Unfilmable verbs for action-line scanning */
const UNFILMABLE_RE = /\b(realizes|remembers|knows|understands|feels|thinks|wonders|hopes|decides|considers|believes|assumes|imagines|recalls|senses|suspects|recognizes|forgets|regrets|wishes)\b/i;

/** Exposition marker phrases for dialogue scanning */
const EXPOSITION_PHRASES = [
    'as you know',
    "as i'm sure you know",
    'let me explain',
    'remember when',
    'as we discussed',
    'you already know',
];
const EXPOSITION_RE = new RegExp(EXPOSITION_PHRASES.map(p => p.replace(/'/g, "['’]")).join('|'), 'i');


// ── Individual checks ───────────────────────────────────────────────

/**
 * 1. Unintroduced characters — dialogue cue before any action mention.
 * @param {Token[]} tokens
 * @returns {HeuristicResult}
 */
function checkUnintroducedCharacters(tokens)
{
    // Build set of known speaking character names from dialogue cues
    const speakingNames = new Set();
    /** @type {Map<string, { line: number, sceneIdx: number, elementIdx: number }>} first dialogue cue */
    const firstDialogue = new Map();

    for (const tok of tokens)
    {
        if (tok.type === 'character')
        {
            const name = tok.text.replace(/\s*\(.*\)$/, '').trim();
            speakingNames.add(name);
            if (!firstDialogue.has(name))
            {
                firstDialogue.set(name, { line: tok.line, sceneIdx: tok.sceneIdx, elementIdx: tok.elementIdx });
            }
        }
    }

    const hasOffscreenCue = new Set();
    for (const tok of tokens)
    {
        if (tok.type === 'character')
        {
            const cueText = tok.originalText || tok.text;
            if (/\((?:[^)]*(?:V\.?O\.?|O\.?S\.?)[^)]*)\)/i.test(cueText))
            {
                const name = tok.text.replace(/\s*\(.*\)$/, '').trim() || tok.text.trim();
                hasOffscreenCue.add(name);
            }
        }
    }

    // Scan action tokens for ALL-CAPS words that match known characters
    /** @type {Map<string, number>} first action mention line */
    const firstAction = new Map();

    for (const tok of tokens)
    {
        if (tok.type === 'action')
        {
            const matches = tok.text.match(/\b[A-Z][A-Z]+\b/g);
            if (matches)
            {
                for (const word of matches)
                {
                    if (word.length < 2 || GENERIC_CUES.has(word)) continue;
                    if (firstAction.has(word)) continue;

                    // Only consider words that match a known speaking character
                    for (const charName of speakingNames)
                    {
                        if (word === charName || levenshtein(word, charName) <= 2)
                        {
                            // Map to the canonical character name
                            if (!firstAction.has(charName))
                            {
                                firstAction.set(charName, tok.line);
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    /** @type {HeuristicItem[]} */
    const items = [];
    for (const [name, info] of firstDialogue)
    {
        if (hasOffscreenCue.has(name)) continue;
        const aLine = firstAction.get(name);
        if (aLine === undefined || info.line < aLine)
        {
            items.push({
                message: `${name} speaks (line ${info.line}) before being introduced in action`,
                line: info.line,
                sceneIdx: info.sceneIdx,
                elementIdx: info.elementIdx,
                character: name,
            });
        }
    }

    return {
        check: 'unintroduced-characters',
        title: 'Unintroduced Characters',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 2. Orphan characters — introduced in action, never speak.
 * @param {Token[]} tokens
 * @param {object} stats
 * @returns {HeuristicResult}
 */
function checkOrphanCharacters(tokens, stats)
{
    const dialogueCueNames = new Set();
    for (const tok of tokens)
    {
        if (tok.type === 'character')
        {
            const name = tok.text.replace(/\s*\(.*\)$/, '').trim().toUpperCase();
            dialogueCueNames.add(name);
        }
    }

    const speakingNames = new Set(stats.characters.map(c => c.name));

    const orphanMentions = new Map();

    for (const tok of tokens)
    {
        if (tok.type !== 'action') continue;
        const text = tok.text;

        const introPattern = /\b([A-Z][A-Z0-9\s',\-]+?)\s*\(/g;
        let match;
        while ((match = introPattern.exec(text)) !== null)
        {
            const name = match[1].trim();
            if (name.length < 2) continue;
            if (GENERIC_CUES.has(name)) continue;

            const nameWords = name.split(/\s+/);
            const allGeneric = nameWords.every(w => GENERIC_CUES.has(w) || w.length < 2);
            if (allGeneric) continue;

            if (dialogueCueNames.has(name)) continue;

            let fuzzyMatch = false;
            for (const cue of dialogueCueNames)
            {
                if (levenshtein(name, cue) <= 2)
                {
                    fuzzyMatch = true;
                    break;
                }
            }
            if (fuzzyMatch) continue;

            if (!orphanMentions.has(name))
            {
                orphanMentions.set(name, { name, lines: [], sceneIdx: tok.sceneIdx, elementIdx: tok.elementIdx });
            }
            orphanMentions.get(name).lines.push(tok.line);
        }
    }

    const barePattern = /\b([A-Z][A-Z0-9]{1,})\b/g;
    for (const tok of tokens)
    {
        if (tok.type !== 'action') continue;
        let bareMatch;
        while ((bareMatch = barePattern.exec(tok.text)) !== null)
        {
            const bareName = bareMatch[1];
            if (bareName.length < 2) continue;
            if (GENERIC_CUES.has(bareName)) continue;
            if (dialogueCueNames.has(bareName)) continue;
            if (speakingNames.has(bareName)) continue;
            if (orphanMentions.has(bareName)) continue;

            let fuzzyMatch = false;
            for (const cue of dialogueCueNames)
            {
                if (levenshtein(bareName, cue) <= 2)
                {
                    fuzzyMatch = true;
                    break;
                }
            }
            if (fuzzyMatch) continue;

            orphanMentions.set(bareName, { name: bareName, lines: [tok.line], sceneIdx: tok.sceneIdx, elementIdx: tok.elementIdx });
        }
        barePattern.lastIndex = 0;
    }

    /** @type {HeuristicItem[]} */
    const items = [];
    for (const [name, data] of orphanMentions)
    {
        items.push({
            type: 'orphan_character',
            message: name + ' appears in action (line ' + data.lines[0] + ') but has no dialogue',
            line: data.lines[0],
            sceneIdx: data.sceneIdx,
            elementIdx: data.elementIdx,
            character: name,
        });
    }

    return {
        check: 'orphan-characters',
        title: 'Orphan Characters',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 3. Similar character names — Levenshtein ≤ 2, both ≥ 3 chars.
 * @param {object} stats
 * @returns {HeuristicResult}
 */
function checkSimilarNames(stats)
{
    const names = stats.characters.map(c => c.name).filter(n => n.length >= 3);
    /** @type {HeuristicItem[]} */
    const items = [];
    const seen = new Set();

    for (let i = 0; i < names.length; i++)
    {
        for (let j = i + 1; j < names.length; j++)
        {
            const a = names[i];
            const b = names[j];
            if (a === b) continue;
            const key = [a, b].sort().join('|');
            if (seen.has(key)) continue;
            if (levenshtein(a, b) <= 2)
            {
                seen.add(key);
                items.push({
                    message: `"${a}" and "${b}" differ by ≤ 2 edits — possible confusion`,
                    line: null,
                    sceneIdx: null,
                    elementIdx: null,
                });
            }
        }
    }

    return {
        check: 'similar-names',
        title: 'Similar Character Names',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 4. One-line characters — speakingParts ≤ 2, excluding generic cues.
 * @param {object} stats
 * @returns {HeuristicResult}
 */
function checkOneLineCharacters(stats)
{
    /** @type {HeuristicItem[]} */
    const items = [];

    for (const ch of stats.characters)
    {
        if (GENERIC_CUES.has(ch.name)) continue;
        if (ch.speakingParts <= 2)
        {
            items.push({
                message: `${ch.displayName || ch.name} has only ${ch.speakingParts} speaking part(s)`,
                line: null,
                sceneIdx: null,
                elementIdx: null,
                character: ch.name,
            });
        }
    }

    return {
        check: 'one-line-characters',
        title: 'One-Line Characters',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 5. Excessive parentheticals — emotion words > 25% and total ≥ 5.
 * @param {Token[]} tokens
 * @returns {HeuristicResult}
 */
function checkExcessiveParentheticals(tokens)
{
    let total = 0;
    let emotionCount = 0;
    /** @type {HeuristicItem[]} */
    const flagged = [];

    for (const tok of tokens)
    {
        if (tok.type === 'parenthetical')
        {
            total++;
            const inner = tok.text.replace(/[()]/g, '').toLowerCase().trim();
            const words = inner.split(/\s+/);
            const hasEmotion = words.some(w => EMOTION_WORDS.has(w));
            if (hasEmotion)
            {
                emotionCount++;
                flagged.push({
                    message: `Emotion parenthetical: ${tok.text}`,
                    line: tok.line,
                    sceneIdx: tok.sceneIdx,
                    elementIdx: tok.elementIdx,
                });
            }
        }
    }

    const passed = total < 5 || (emotionCount / total) <= 0.25;
    return {
        check: 'excessive-parentheticals',
        title: 'Excessive Parentheticals',
        severity: 'warning',
        passed,
        items: passed ? [] : flagged,
    };
}

/**
 * 6. Talking heads — > 112 consecutive dialogue lines with no action.
 * @param {Token[]} tokens
 * @returns {HeuristicResult}
 */
function checkTalkingHeads(tokens)
{
    /** @type {HeuristicItem[]} */
    const items = [];
    let consecutiveLines = 0;
    let streakStartLine = null;
    let streakStartSceneIdx = null;
    let streakStartElementIdx = null;
    let currentScene = 0;

    for (const tok of tokens)
    {
        if (tok.type === 'scene_heading')
        {
            // Check before resetting
            if (consecutiveLines > 112)
            {
                items.push({
                    message: `${consecutiveLines} consecutive dialogue lines with no action beat`,
                    line: streakStartLine,
                    sceneIdx: streakStartSceneIdx,
                    elementIdx: streakStartElementIdx,
                    scene: currentScene,
                });
            }
            consecutiveLines = 0;
            streakStartLine = null;
            streakStartSceneIdx = null;
            streakStartElementIdx = null;
            currentScene++;
        }
        else if (tok.type === 'dialogue' || tok.type === 'character' || tok.type === 'parenthetical')
        {
            if (tok.type === 'dialogue')
            {
                const lineCount = tok.text.split('\n').length;
                if (streakStartLine === null)
                {
                    streakStartLine = tok.line;
                    streakStartSceneIdx = tok.sceneIdx;
                    streakStartElementIdx = tok.elementIdx;
                }
                consecutiveLines += lineCount;
            }
            else if (streakStartLine === null)
            {
                streakStartLine = tok.line;
                streakStartSceneIdx = tok.sceneIdx;
                streakStartElementIdx = tok.elementIdx;
            }
        }
        else if (tok.type === 'action')
        {
            if (consecutiveLines > 112)
            {
                items.push({
                    message: `${consecutiveLines} consecutive dialogue lines with no action beat`,
                    line: streakStartLine,
                    sceneIdx: streakStartSceneIdx,
                    elementIdx: streakStartElementIdx,
                    scene: currentScene,
                });
            }
            consecutiveLines = 0;
            streakStartLine = null;
            streakStartSceneIdx = null;
            streakStartElementIdx = null;
        }
    }

    // Final streak
    if (consecutiveLines > 112)
    {
        items.push({
            message: `${consecutiveLines} consecutive dialogue lines with no action beat`,
            line: streakStartLine,
            sceneIdx: streakStartSceneIdx,
            elementIdx: streakStartElementIdx,
            scene: currentScene,
        });
    }

    return {
        check: 'talking-heads',
        title: 'Talking Heads',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 7. Long action blocks — > 6 lines in a single action token.
 * @param {Token[]} tokens
 * @returns {HeuristicResult}
 */
function checkLongActionBlocks(tokens)
{
    /** @type {HeuristicItem[]} */
    const items = [];

    for (const tok of tokens)
    {
        if (tok.type === 'action')
        {
            const lines = tok.text.split('\n').length;
            if (lines > 6)
            {
                items.push({
                    message: `Action block is ${lines} lines long (limit: 6)`,
                    line: tok.line,
                    sceneIdx: tok.sceneIdx,
                    elementIdx: tok.elementIdx,
                });
            }
        }
    }

    return {
        check: 'long-action-blocks',
        title: 'Long Action Blocks',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 8. Unfilmable action lines — internal-state verbs in action text.
 * @param {Token[]} tokens
 * @returns {HeuristicResult}
 */
function checkUnfilmableActions(tokens)
{
    /** @type {HeuristicItem[]} */
    const items = [];

    for (const tok of tokens)
    {
        if (tok.type === 'action')
        {
            const match = tok.text.match(UNFILMABLE_RE);
            if (match)
            {
                items.push({
                    message: `Unfilmable verb "${match[0]}" in action line`,
                    line: tok.line,
                    sceneIdx: tok.sceneIdx,
                    elementIdx: tok.elementIdx,
                });
            }
        }
    }

    return {
        check: 'unfilmable-actions',
        title: 'Unfilmable Action Lines',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 9. Long monologues — > 10 consecutive dialogue lines from same character.
 * @param {Token[]} tokens
 * @returns {HeuristicResult}
 */
function checkLongMonologues(tokens)
{
    /** @type {HeuristicItem[]} */
    const items = [];
    let currentCharacter = null;
    let dialogueCount = 0;
    let monologueStartLine = null;
    let monologueStartSceneIdx = null;
    let monologueStartElementIdx = null;

    for (const tok of tokens)
    {
        if (tok.type === 'character')
        {
            const name = tok.text.replace(/\s*\(.*\)$/, '').trim();
            if (name !== currentCharacter)
            {
                // Flush previous
                if (dialogueCount > 10)
                {
                    items.push({
                        message: `${currentCharacter} has ${dialogueCount} consecutive dialogue lines`,
                        line: monologueStartLine,
                        sceneIdx: monologueStartSceneIdx,
                        elementIdx: monologueStartElementIdx,
                        character: currentCharacter,
                    });
                }
                currentCharacter = name;
                dialogueCount = 0;
                monologueStartLine = null;
                monologueStartSceneIdx = null;
                monologueStartElementIdx = null;
            }
        }
        else if (tok.type === 'dialogue' && currentCharacter)
        {
            const lineCount = tok.text.split('\n').length;
            if (monologueStartLine === null)
            {
                monologueStartLine = tok.line;
                monologueStartSceneIdx = tok.sceneIdx;
                monologueStartElementIdx = tok.elementIdx;
            }
            dialogueCount += lineCount;
        }
        else if (tok.type === 'parenthetical')
        {
            // Parentheticals don't break a monologue
        }
        else
        {
            // Non-dialogue/character/parenthetical breaks monologue
            if (dialogueCount > 10)
            {
                items.push({
                    message: `${currentCharacter} has ${dialogueCount} consecutive dialogue lines`,
                    line: monologueStartLine,
                    sceneIdx: monologueStartSceneIdx,
                    elementIdx: monologueStartElementIdx,
                    character: currentCharacter,
                });
            }
            currentCharacter = null;
            dialogueCount = 0;
            monologueStartLine = null;
            monologueStartSceneIdx = null;
            monologueStartElementIdx = null;
        }
    }

    // Final flush
    if (dialogueCount > 10)
    {
        items.push({
            message: `${currentCharacter} has ${dialogueCount} consecutive dialogue lines`,
            line: monologueStartLine,
            sceneIdx: monologueStartSceneIdx,
            elementIdx: monologueStartElementIdx,
            character: currentCharacter,
        });
    }

    return {
        check: 'long-monologues',
        title: 'Long Monologues',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 10. Exposition markers — cliché exposition phrases in dialogue.
 * @param {Token[]} tokens
 * @returns {HeuristicResult}
 */
function checkExpositionMarkers(tokens)
{
    /** @type {HeuristicItem[]} */
    const items = [];

    for (const tok of tokens)
    {
        if (tok.type === 'dialogue')
        {
            const match = tok.text.match(EXPOSITION_RE);
            if (match)
            {
                items.push({
                    message: `Exposition marker: "${match[0]}"`,
                    line: tok.line,
                    sceneIdx: tok.sceneIdx,
                    elementIdx: tok.elementIdx,
                });
            }
        }
    }

    return {
        check: 'exposition-markers',
        title: 'Exposition Markers',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 11. Solo dialogue — character speaks alone in a scene with > 3 lines, no V.O./O.S.
 * @param {Token[]} tokens
 * @returns {HeuristicResult}
 */
function checkSoloDialogue(tokens)
{
    /** @type {HeuristicItem[]} */
    const items = [];

    // Split into scenes
    const scenes = [];
    let current = null;

    for (const tok of tokens)
    {
        if (tok.type === 'scene_heading')
        {
            current = { heading: tok, tokens: [] };
            scenes.push(current);
        }
        else if (current)
        {
            current.tokens.push(tok);
        }
    }

    for (let i = 0; i < scenes.length; i++)
    {
        const scene = scenes[i];
        const speakers = new Map();
        let hasVoiceOver = false;
        let totalDialogueLines = 0;

        for (const tok of scene.tokens)
        {
            if (tok.type === 'character')
            {
                const raw = tok.originalText || tok.text;
                if (/\((?:[^)]*(?:V\.?O\.?|O\.?S\.?)[^)]*)\)/i.test(raw))
                {
                    hasVoiceOver = true;
                }
                const name = tok.text.replace(/\s*\(.*\)$/, '').trim() || tok.text.trim();
                speakers.set(name, (speakers.get(name) || 0));
            }
            else if (tok.type === 'dialogue')
            {
                totalDialogueLines += tok.text.split('\n').length;
                // Attribute to last speaker
                const lastSpeaker = [...speakers.keys()].pop();
                if (lastSpeaker)
                {
                    speakers.set(lastSpeaker, speakers.get(lastSpeaker) + tok.text.split('\n').length);
                }
            }
        }

        if (speakers.size === 1 && !hasVoiceOver && totalDialogueLines > 3)
        {
            const name = [...speakers.keys()][0];
            items.push({
                message: `${name} is the only speaker in scene ${i + 1} with ${totalDialogueLines} dialogue lines`,
                line: scene.heading.line,
                sceneIdx: scene.heading.sceneIdx,
                elementIdx: scene.heading.elementIdx,
                character: name,
                scene: i + 1,
            });
        }
    }

    return {
        check: 'solo-dialogue',
        title: 'Solo Dialogue',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}

/**
 * 12. Disappearing characters — last scene in first 40% and ≥ 3 speaking parts.
 * @param {object} stats
 * @returns {HeuristicResult}
 */
function checkDisappearingCharacters(stats)
{
    /** @type {HeuristicItem[]} */
    const items = [];
    const totalScenes = stats.length.scenes;
    if (totalScenes === 0) return {
        check: 'disappearing-characters',
        title: 'Disappearing Characters',
        severity: 'warning',
        passed: true,
        items: [],
    };

    const cutoff = Math.floor(totalScenes * 0.4);

    for (const ch of stats.characters)
    {
        if (ch.speakingParts < 3) continue;
        const sceneNums = ch.sceneNumbers || [];
        if (sceneNums.length === 0) continue;
        const lastScene = Math.max(...sceneNums);
        if (lastScene <= cutoff)
        {
            items.push({
                message: `${ch.displayName || ch.name} last appears in scene ${lastScene} of ${totalScenes} (first 40%)`,
                line: null,
                sceneIdx: null,
                elementIdx: null,
                character: ch.name,
            });
        }
    }

    return {
        check: 'disappearing-characters',
        title: 'Disappearing Characters',
        severity: 'warning',
        passed: items.length === 0,
        items,
    };
}


// ── Public API ───────────────────────────────────────────────────────

/**
 * Run all 12 heuristic checks on a parsed screenplay.
 *
 * @param {Token[]} tokens  — parsed token array
 * @param {object}  stats   — return value of computeStatistics(tokens)
 * @returns {HeuristicResult[]}
 */
export function runHeuristics(tokens, stats)
{
    return [
        checkUnintroducedCharacters(tokens),
        checkOrphanCharacters(tokens, stats),
        checkSimilarNames(stats),
        checkOneLineCharacters(stats),
        checkExcessiveParentheticals(tokens),
        checkTalkingHeads(tokens),
        checkLongActionBlocks(tokens),
        checkUnfilmableActions(tokens),
        checkLongMonologues(tokens),
        checkExpositionMarkers(tokens),
        checkSoloDialogue(tokens),
        checkDisappearingCharacters(stats),
    ];
}
