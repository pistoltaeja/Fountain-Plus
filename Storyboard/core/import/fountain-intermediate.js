import { screenplayToFountain } from '../parser/fountain-writer.js';
import { parseFountain } from '../parser/fountain-parser.js';

/**
 * Route a raw Screenplay through Fountain as canonical intermediate.
 * Returns both the canonical Screenplay and the intermediate Fountain text.
 *
 * @param {import('../parser/screenplay-parser.js').Screenplay} rawScreenplay
 * @returns {{ screenplay: import('../parser/screenplay-parser.js').Screenplay, fountainText: string }}
 */
export function parseViaFountain(rawScreenplay)
{
    const fountainText = screenplayToFountain(rawScreenplay);
    const screenplay = parseFountain(fountainText);
    if (rawScreenplay.printedPageCount !== undefined)
    {
        screenplay.printedPageCount = rawScreenplay.printedPageCount;
    }
    return { screenplay, fountainText };
}
