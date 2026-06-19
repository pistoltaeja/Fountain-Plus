/**
 * Export style enums + heading formatters.
 *
 * Provides format-agnostic page / panel heading style selectors threaded through
 * every Screenplay writer (TXT, FDX, FadeIn, screenplayToFountain). When a
 * writer is called without `options` the default behaviour (existing fixed
 * output) is preserved — backwards compatibility is non-negotiable.
 *
 * Locale note: `PageHeadingStyle.Longhand` and `PageHeadingStyle.PageAndLonghand`
 * spell numbers in English only. Non-English locales fall back to the numeric
 * variants (Numerals / PageAndNumerals).
 *
 * @module core/export/export-styles
 */

/**
 * Page-heading style selector.
 *
 * - `Longhand` — "ONE" / "TWENTY"
 * - `PageAndLonghand` — "PAGE ONE"
 * - `PageAndNumerals` — "PAGE 1"
 * - `Numerals` — "1"
 *
 * @typedef {'longhand' | 'page-and-longhand' | 'page-and-numerals' | 'numerals'} PageHeadingStyleValue
 */
export const PageHeadingStyle = Object.freeze({
    Longhand: 'longhand',
    PageAndLonghand: 'page-and-longhand',
    PageAndNumerals: 'page-and-numerals',
    Numerals: 'numerals'
});

/**
 * Panel-heading style selector.
 *
 * - `PanelAndNumerals` — "PANEL 1"
 * - `PanelAndNumeralsWithPage` — "PANEL 1.3" (page.panel)
 * - `NumeralAndDot` — "1."
 * - `NumeralWithPage` — "1.3"
 * - `NumeralAndParenthesis` — "1)"
 *
 * @typedef {'panel-and-numerals' | 'panel-and-numerals-with-page' | 'numeral-and-dot' | 'numeral-with-page' | 'numeral-and-parenthesis'} PanelHeadingStyleValue
 */
export const PanelHeadingStyle = Object.freeze({
    PanelAndNumerals: 'panel-and-numerals',
    PanelAndNumeralsWithPage: 'panel-and-numerals-with-page',
    NumeralAndDot: 'numeral-and-dot',
    NumeralWithPage: 'numeral-with-page',
    NumeralAndParenthesis: 'numeral-and-parenthesis'
});

// ---------------------------------------------------------------------------
// English number-to-words (1-100). Larger values fall back to numerals.
// ---------------------------------------------------------------------------

const ONES = [
    '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN',
    'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'
];
const TENS = [
    '', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY',
    'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'
];

/**
 * Convert 1-100 to an English uppercase word ("ONE", "TWENTY-ONE", "ONE HUNDRED").
 * Returns `null` for values outside 1-100 — callers should fall back to numerals.
 *
 * @param {number} n
 * @returns {string | null}
 */
function numberToWords(n)
{
    if (!Number.isInteger(n) || n < 1 || n > 100) return null;
    if (n === 100) return 'ONE HUNDRED';
    if (n < 20) return ONES[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Format a page heading for a writer.
 *
 * When `style` is undefined returns `null` so the calling writer keeps its
 * existing default output verbatim. Longhand styles fall back to the numeric
 * equivalent for non-English locales or out-of-range numbers.
 *
 * @param {number} num
 * @param {PageHeadingStyleValue | undefined} style
 * @param {string} [locale='en']
 * @returns {string | null}
 */
export function formatPageHeading(num, style, locale = 'en')
{
    if (!style) return null;

    const wantsLonghand = style === PageHeadingStyle.Longhand || style === PageHeadingStyle.PageAndLonghand;
    const englishLocale = !locale || locale.toLowerCase().startsWith('en');
    const longhand = wantsLonghand && englishLocale ? numberToWords(num) : null;

    switch (style)
    {
        case PageHeadingStyle.Longhand:
            return longhand !== null ? longhand : String(num);
        case PageHeadingStyle.PageAndLonghand:
            return longhand !== null ? `PAGE ${longhand}` : `PAGE ${num}`;
        case PageHeadingStyle.PageAndNumerals:
            return `PAGE ${num}`;
        case PageHeadingStyle.Numerals:
            return String(num);
        default:
            return null;
    }
}

/**
 * Format a panel heading for a writer.
 *
 * When `style` is undefined returns `null` so the calling writer keeps its
 * existing default output. Styles that include the page number fall back to
 * the panel-only variant when `pageNum` is undefined.
 *
 * @param {number} num
 * @param {number | undefined} pageNum
 * @param {PanelHeadingStyleValue | undefined} style
 * @returns {string | null}
 */
export function formatPanelHeading(num, pageNum, style)
{
    if (!style) return null;
    const hasPage = typeof pageNum === 'number';

    switch (style)
    {
        case PanelHeadingStyle.PanelAndNumerals:
            return `PANEL ${num}`;
        case PanelHeadingStyle.PanelAndNumeralsWithPage:
            return hasPage ? `PANEL ${pageNum}.${num}` : `PANEL ${num}`;
        case PanelHeadingStyle.NumeralAndDot:
            return `${num}.`;
        case PanelHeadingStyle.NumeralWithPage:
            return hasPage ? `${pageNum}.${num}` : `${num}.`;
        case PanelHeadingStyle.NumeralAndParenthesis:
            return `${num})`;
        default:
            return null;
    }
}
