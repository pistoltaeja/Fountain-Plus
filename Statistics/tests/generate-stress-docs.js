import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Data Pools ───────────────────────────────────────────────────────────────

const CHARACTERS = [
    'ALICE', 'BOB', 'CHARLIE', 'DIANA', 'ETHAN', 'FIONA', 'GEORGE', 'HANNAH',
    'IVAN', 'JULIA', 'KARL', 'LUNA', 'MARCUS', 'NINA', 'OSCAR', 'PENNY',
    'QUINN', 'RACHEL', 'SAMUEL', 'TANYA', 'UMBERTO', 'VIVIAN', 'WALTER',
    'XENA', 'YUSUF'
];

const LOCATIONS = [
    'APARTMENT', 'OFFICE', 'DINER', 'ROOFTOP', 'SUBWAY', 'PARK',
    'HOSPITAL', 'SCHOOL', 'WAREHOUSE', 'BAR', 'AIRPORT', 'BEACH',
    'CEMETERY', 'CHURCH', 'FACTORY', 'GARAGE', 'HOTEL ROOM', 'KITCHEN',
    'LIBRARY', 'MUSEUM', 'NIGHTCLUB', 'PARKING LOT', 'RESTAURANT',
    'STUDIO', 'TRAIN STATION', 'UNIVERSITY', 'ALLEY', 'BASEMENT',
    'BRIDGE', 'CAFE', 'COURTROOM', 'ELEVATOR', 'GARDEN', 'HALLWAY',
    'JUNGLE', 'LAKE', 'MOUNTAIN', 'OPERA HOUSE', 'PIER', 'QUARRY',
    'RIVER', 'SHIP', 'TEMPLE', 'UNDERGROUND', 'VINEYARD', 'WATCHTOWER',
    'YACHT', 'ZOO', 'BUNKER', 'CANYON', 'DESERT', 'FORTRESS'
];

const INT_EXT = ['INT.', 'EXT.', 'INT./EXT.', 'EST.'];
const TIMES = ['DAY', 'NIGHT', 'DAWN', 'DUSK', 'MORNING', 'AFTERNOON', 'EVENING', 'CONTINUOUS'];

const DIALOGUE = [
    "I never thought we'd end up here.",
    "After everything that happened last summer, it feels like a lifetime ago.",
    "You don't get to decide that for me. Not anymore.",
    "The quarterly reports show a fifteen percent increase in operational expenditure.",
    "Look, I understand what you're saying, but that doesn't change the fact that we're running out of time.",
    "Fine.",
    "Whatever you say.",
    "I've been thinking about what you said, and I think you might be right after all.",
    "Do you remember the night we first met? Everything was different back then.",
    "This isn't what I signed up for.",
    "The molecular structure indicates a previously unknown compound.",
    "She left three hours ago. Didn't say where she was going.",
    "We need to talk about what happened at the conference.",
    "I'm not the person you think I am.",
    "Hand me the wrench. No, the other one.",
    "The defense rests, Your Honor.",
    "If we don't leave now, we'll miss our chance.",
    "I've analyzed the data from every conceivable angle, and there's simply no other explanation.",
    "You're lying.",
    "Tell me something I don't already know.",
    "The patient's vitals are dropping. We need to operate now.",
    "I promised myself I'd never come back to this place.",
    "According to the ancient texts, the artifact should be located beneath the east tower.",
    "Just because you can doesn't mean you should.",
    "My father built this company from nothing. I won't let you destroy it.",
    "The signal's getting weaker. We're losing them.",
    "I'll have the usual. Actually, make it a double.",
    "You want the truth? You couldn't handle the truth.",
    "Three months. That's all the time we have left.",
    "I've seen things you wouldn't believe possible in a civilized society.",
    "Run!",
    "The experiment was a complete success beyond all our initial projections and wildest expectations.",
    "I didn't do it. You have to believe me.",
    "Sometimes the hardest thing to do is nothing at all.",
    "We've been compromised. Execute protocol seven immediately.",
    "It's beautiful, isn't it? The way the light hits the water at this hour.",
    "I resign.",
    "The treaty was signed in eighteen forty-two, not eighteen forty-three as commonly believed.",
    "Get out. Now.",
    "I've waited my entire life for this moment, and I'm not going to let fear stop me.",
    "The wiring's all wrong. Whoever installed this didn't know what they were doing.",
    "You remind me of someone I used to know. Someone I lost a long time ago.",
    "The budget simply won't allow for that kind of expenditure in the current fiscal quarter.",
    "I love you. I've always loved you.",
    "The suspect was last seen heading north on Fifth Avenue.",
    "We should go.",
    "If I had known then what I know now, I would have done everything differently.",
    "The structural integrity of the building has been severely compromised.",
    "I can't breathe.",
    "Ladies and gentlemen of the jury, what you are about to hear will fundamentally change your understanding of the events of that night."
];

const ACTIONS = [
    "A long silence fills the room as the characters stare at each other.",
    "The door swings open with a loud CRASH. Debris scatters across the floor.",
    "Rain pelts the windows. Lightning illuminates the darkened interior.",
    "She crosses to the window and looks out at the city below, her reflection ghostly in the glass.",
    "He pulls out a crumpled photograph and places it on the table without a word.",
    "The crowd erupts in chaos. People push toward the exits.",
    "A clock on the wall ticks loudly in the silence. Its pendulum swings back and forth with mechanical precision.",
    "Papers fly off the desk as the wind howls through the broken window.",
    "The elevator doors open to reveal an empty corridor stretching into darkness.",
    "She picks up the phone, dials, waits. No answer. She hangs up and tries again.",
    "Blood seeps through the bandage. He winces but says nothing.",
    "The camera pans across the abandoned warehouse, rusted machinery standing like forgotten sentinels.",
    "A car pulls up to the curb. The engine dies. Nobody gets out.",
    "He reaches into his pocket and produces a small velvet box.",
    "The sun sets behind the mountains, casting long shadows across the valley floor.",
    "Footsteps echo in the stairwell, growing louder with each passing second.",
    "She tears the letter in half, then into quarters, then drops the pieces into the fire.",
    "The computer screen flickers to life, displaying rows of encrypted data.",
    "A dog barks somewhere in the distance. Then silence returns.",
    "They walk in silence through the empty streets, their breath visible in the cold night air."
];

// ─── Generators ───────────────────────────────────────────────────────────────

function generateFountain(targetChars)
{
    let doc = '';
    let charCount = 0;
    let sceneNum = 0;
    let sectionDepth = 1;

    // Add 15 sections spread through the document
    const sectionInterval = Math.floor(targetChars / 15);
    let nextSection = sectionInterval;

    while (charCount < targetChars)
    {
        // Occasionally insert a section heading
        if (charCount >= nextSection && sectionDepth <= 5)
        {
            const hashes = '#'.repeat(sectionDepth);
            const line = `${hashes} Act ${sectionDepth} - Part ${sceneNum}\n\n`;
            doc += line;
            charCount += line.length;
            sectionDepth = (sectionDepth % 5) + 1;
            nextSection += sectionInterval;
        }

        // Scene heading
        const intExt = INT_EXT[sceneNum % INT_EXT.length];
        const location = LOCATIONS[sceneNum % LOCATIONS.length];
        const time = TIMES[sceneNum % TIMES.length];
        const heading = `${intExt} ${location} - ${time}\n\n`;
        doc += heading;
        charCount += heading.length;
        sceneNum++;

        // Optional synopsis
        if (sceneNum % 5 === 0)
        {
            const syn = `= A brief synopsis of what happens in this scene.\n\n`;
            doc += syn;
            charCount += syn.length;
        }

        // 2-5 action lines
        const actionCount = 2 + (sceneNum % 4);
        for (let a = 0; a < actionCount && charCount < targetChars; a++)
        {
            const action = ACTIONS[(sceneNum + a) % ACTIONS.length] + '\n\n';
            doc += action;
            charCount += action.length;
        }

        // Optional inline note
        if (sceneNum % 3 === 0)
        {
            const note = `[[Director's note: consider alternative staging for this scene]]\n\n`;
            doc += note;
            charCount += note.length;
        }

        // 3-8 dialogue exchanges
        const dialogueCount = 3 + (sceneNum % 6);
        for (let d = 0; d < dialogueCount && charCount < targetChars; d++)
        {
            const charIdx = (sceneNum + d) % CHARACTERS.length;
            const character = CHARACTERS[charIdx];

            // Dual dialogue every 10th exchange
            const isDual = (d > 0 && d % 10 === 0);
            const charLine = isDual ? `${character} ^\n` : `${character}\n`;
            doc += charLine;
            charCount += charLine.length;

            // Parenthetical every 4th dialogue
            if (d % 4 === 0)
            {
                const paren = `(thoughtfully)\n`;
                doc += paren;
                charCount += paren.length;
            }

            const dialogueLine = DIALOGUE[(sceneNum * 7 + d) % DIALOGUE.length] + '\n\n';
            doc += dialogueLine;
            charCount += dialogueLine.length;
        }

        // Optional transition
        if (sceneNum % 7 === 0)
        {
            const trans = `> CUT TO:\n\n`;
            doc += trans;
            charCount += trans.length;
        }

        // Page break every ~10 scenes
        if (sceneNum % 10 === 0)
        {
            doc += `===\n\n`;
            charCount += 5;
        }
    }

    return doc;
}

function generateMangaplay(targetChars)
{
    let doc = 'Title: Stress Test Document\nAuthor: Generator\nFormat: Manga\n\n';
    let charCount = doc.length;
    let pageNum = 0;
    let sceneNum = 0;
    let sectionDepth = 1;

    const PANEL_TAGS = ['', '[H]', '[V]', '[WIDE]', '[SPREAD]', '[GROUP]', '[SPLIT]'];
    const sectionInterval = Math.floor(targetChars / 15);
    let nextSection = sectionInterval;

    while (charCount < targetChars)
    {
        // Sections
        if (charCount >= nextSection && sectionDepth <= 5)
        {
            const hashes = '#'.repeat(sectionDepth);
            const line = `${hashes} Chapter ${sectionDepth} - Section ${pageNum}\n\n`;
            doc += line;
            charCount += line.length;
            sectionDepth = (sectionDepth % 5) + 1;
            nextSection += sectionInterval;
        }

        // Page header
        pageNum++;
        const pageHeader = `# PAGE ${pageNum}\n\n`;
        doc += pageHeader;
        charCount += pageHeader.length;

        // Scene heading (every 2 pages)
        if (pageNum % 2 === 0)
        {
            sceneNum++;
            const intExt = INT_EXT[sceneNum % INT_EXT.length];
            const location = LOCATIONS[sceneNum % LOCATIONS.length];
            const time = TIMES[sceneNum % TIMES.length];
            const heading = `${intExt} ${location} - ${time}\n\n`;
            doc += heading;
            charCount += heading.length;
        }

        // 3-6 panels per page
        const panelCount = 3 + (pageNum % 4);
        for (let p = 0; p < panelCount && charCount < targetChars; p++)
        {
            const tag = PANEL_TAGS[(pageNum + p) % PANEL_TAGS.length];
            const panelLine = tag ? `Panel ${p + 1} ${tag}\n` : `Panel ${p + 1}\n`;
            doc += panelLine;
            charCount += panelLine.length;

            // Action for panel
            const action = '    ' + ACTIONS[(pageNum + p) % ACTIONS.length] + '\n\n';
            doc += action;
            charCount += action.length;

            // 1-3 dialogue per panel
            const dlgCount = 1 + (p % 3);
            for (let d = 0; d < dlgCount && charCount < targetChars; d++)
            {
                const charIdx = (pageNum + p + d) % CHARACTERS.length;
                const character = CHARACTERS[charIdx];
                const charLine = `        ${character}\n`;
                doc += charLine;
                charCount += charLine.length;

                if (d % 3 === 0)
                {
                    const paren = `        (softly)\n`;
                    doc += paren;
                    charCount += paren.length;
                }

                const dialogueLine = '        ' + DIALOGUE[(pageNum * 5 + p + d) % DIALOGUE.length] + '\n\n';
                doc += dialogueLine;
                charCount += dialogueLine.length;
            }
        }

        // Optional note
        if (pageNum % 4 === 0)
        {
            const note = `[[Production note: special effects required for this sequence]]\n\n`;
            doc += note;
            charCount += note.length;
        }

        // Optional synopsis
        if (pageNum % 6 === 0)
        {
            const syn = `= This page establishes the emotional turning point of the chapter.\n\n`;
            doc += syn;
            charCount += syn.length;
        }
    }

    return doc;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, 'fixtures');

if (!existsSync(FIXTURES_DIR))
{
    mkdirSync(FIXTURES_DIR, { recursive: true });
}

const SIZES = [50_000, 100_000, 500_000];

for (const size of SIZES)
{
    const sizeLabel = size >= 1_000_000 ? `${size / 1_000_000}m` : `${size / 1_000}k`;

    const fountain = generateFountain(size);
    const fountainPath = join(FIXTURES_DIR, `stress-fountain-${sizeLabel}.fountain`);
    writeFileSync(fountainPath, fountain);
    console.log(`Written: ${fountainPath} (${fountain.length} chars)`);

    const mangaplay = generateMangaplay(size);
    const mangaplayPath = join(FIXTURES_DIR, `stress-mangaplay-${sizeLabel}.mangaplay.md`);
    writeFileSync(mangaplayPath, mangaplay);
    console.log(`Written: ${mangaplayPath} (${mangaplay.length} chars)`);
}

console.log('Done. 6 stress documents generated.');
