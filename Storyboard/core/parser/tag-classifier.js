/**
 * Tag Classification for Panel Tags — Panel Grid Refactor (Phase 1)
 *
 * Public tag surface (see TODO/PANEL_GRID_REFACTOR.md Section 2):
 *
 *   Layout:  [H] [V] [WIDE] [GROUP] [INSET] [SPLIT] [SPREAD]
 *   Size:    [S] [L]                       (medium is absence-of-modifier)
 *   Style:   [BLEED] [BORDERLESS]
 *
 * Aliases accepted but never surfaced:
 *   [HORIZONTAL] -> H
 *   [VERTICAL]   -> V
 *   [FULL]       -> SPREAD
 *   [FULL BLEED] -> BLEED
 *
 * Normalised away entirely:
 *   [M]  -> silently dropped (medium is the implicit default)
 *
 * NOT accepted (removed in this refactor — see Section 5.1):
 *   [VERT] [HORIZ] [ROW] [A]
 *   [H-N] [H-N/M] [V-N] and all sized variants
 *   [SPLASH] [BROKEN] [DIAGONAL] [DIAG-H] [DIAG-V] [SMALL]
 *
 * The classifier returns both the **new structured triple**
 * `{ layout, size, style }` and the **legacy** `{ type, modifiers }` shape
 * that the current grid calculator still reads. The legacy shape goes away
 * when the [GRID] workstream lands.
 */

/** @typedef {import('../types.js').PanelType} PanelType */

/**
 * @typedef {'none' | 'H' | 'V' | 'WIDE' | 'GROUP' | 'INSET' | 'SPLIT' | 'SPREAD'} PanelLayoutKind
 */

/**
 * @typedef {'S' | 'L' | null} PanelSizeKind
 *   Medium is represented as `null` — writers never type [M]; the parser
 *   silently normalises it away.
 */

/**
 * @typedef {'BLEED' | 'BORDERLESS' | null} PanelStyleKind
 */

/**
 * @typedef {'H' | 'V' | null} InsetOrientationKind
 *   Orientation is ONLY meaningful when `layout === 'INSET'`. `[INSET][H]` is
 *   a wide inset, `[INSET][V]` is a tall inset. Absent → square-ish default.
 */

/**
 * @typedef {Object} ParseWarning
 * @property {string} code           - Stable machine code, e.g. 'unknown-tag'
 * @property {string} message        - Artist-friendly English message
 * @property {string} [offendingTag] - Raw tag text that triggered the warning
 * @property {string} [suggestion]   - Optional "did you mean X" hint
 */

/**
 * @typedef {Object} ClassifiedTags
 *   New structured surface + legacy back-compat fields.
 * @property {PanelLayoutKind}  layout
 * @property {PanelSizeKind}    size
 * @property {PanelStyleKind}   style
 * @property {InsetOrientationKind} [orientation] - Only set when layout === 'INSET' AND an [H]/[V] orientation modifier was stacked.
 * @property {boolean}          [hasSplit]    - True when [SPLIT] is present. SPLIT is an overlay flag, not a competing layout — see Section 2.1 SPLIT Details.
 * @property {boolean}          [joinGroup]   - True when [G]/[GROUP] appears alongside another layout tag, signalling the panel joins an open GROUP/[V][L] container as a member rather than acting as the layout.
 * @property {boolean}          [placeAtEnd]  - True when [END]/[LAST] appears, signalling a [V][L] container should anchor at the END of the row and absorb predecessors instead of followers.
 * @property {PanelType|undefined} type       - Legacy: primary layout tag (for current grid calc).
 * @property {string[]}         modifiers     - Legacy: modifier stack (for current grid calc).
 * @property {ParseWarning[]}   warnings      - Structured warnings for the validator surface.
 */

// ---------------------------------------------------------------------------
// Canonical known tags (everything else is unknown)
// ---------------------------------------------------------------------------

const LAYOUT_CANONICAL = new Set(['H', 'V', 'WIDE', 'GROUP', 'INSET', 'SPLIT', 'SPREAD']);
const SIZE_CANONICAL   = new Set(['S', 'L']);
const STYLE_CANONICAL  = new Set(['BLEED', 'BORDERLESS']);
/**
 * Modifier flags — orthogonal to layout/size/style. Each modifier flag has its
 * own field on the result (e.g. `placeAtEnd` for [END]). Mirrors the way
 * `joinGroup` / `hasSplit` are surfaced.
 */
const MODIFIER_FLAGS = new Set(['END']);

/**
 * Alias map — LHS is what the author may type, RHS is the canonical tag.
 * Multi-word aliases like `FULL BLEED` are matched exactly (case-insensitive,
 * single internal space). `M` resolves to the sentinel `__DROP__` which the
 * classifier ignores.
 */
const ALIAS_TO_CANONICAL = new Map([
    ['HORIZONTAL', 'H'],
    ['VERTICAL',   'V'],
    ['SMALL',      'S'],
    ['FULL',       'SPREAD'],
    ['FULL BLEED', 'BLEED'],
    ['G',          'GROUP'],
    ['M',          '__DROP__'],
    ['LAST',       'END']
]);

/**
 * Public surface including aliases — used for "is this a known tag?" check.
 * Everything NOT in here is reported as `unknown-tag`.
 */
const KNOWN_PUBLIC_TAGS = new Set([
    ...LAYOUT_CANONICAL,
    ...SIZE_CANONICAL,
    ...STYLE_CANONICAL,
    ...MODIFIER_FLAGS,
    ...ALIAS_TO_CANONICAL.keys()
]);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract individual tags from the raw bracketed tag string.
 * Allocation-light: single regex pass with `exec` loop, no split/map chains.
 * Order-preserving.
 *
 * Accepts forms like `[INSET] [S]`, `[FULL BLEED]`, or a bare `H`.
 *
 * @param {string} rawTagStr
 * @returns {string[]} tag strings, uppercased, trimmed
 */
export function extractTags(rawTagStr)
{
    if (!rawTagStr) return [];

    /** @type {string[]} */
    const tags = [];

    // Bracketed form: [ABC], [FULL BLEED], [H], [S]
    // Match anything non-bracket between the brackets so unknown tags still
    // surface as warnings rather than silently vanishing.
    const bracketPattern = /\[([^\[\]]+)\]/g;
    let match;
    let sawBracket = false;
    while ((match = bracketPattern.exec(rawTagStr)) !== null)
    {
        sawBracket = true;
        const raw = match[1].trim();
        if (raw)
        {
            tags.push(raw.toUpperCase().replace(/\s+/g, ' '));
        }
    }

    // Bare form — single tag with no brackets.
    if (!sawBracket)
    {
        const trimmed = rawTagStr.trim();
        if (trimmed)
        {
            tags.push(trimmed.toUpperCase().replace(/\s+/g, ' '));
        }
    }

    return tags;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Normalise a raw tag to its canonical form. Returns one of:
 *   - a canonical tag string
 *   - the sentinel `'__DROP__'` for tags that should be silently dropped (e.g. [M])
 *   - `null` when the tag is not recognised at all
 *
 * @param {string} rawTag - already uppercased + whitespace-collapsed
 * @returns {string | null}
 */
function canonicaliseTag(rawTag)
{
    if (KNOWN_PUBLIC_TAGS.has(rawTag))
    {
        if (ALIAS_TO_CANONICAL.has(rawTag))
        {
            return /** @type {string} */ (ALIAS_TO_CANONICAL.get(rawTag));
        }
        return rawTag;
    }
    return null;
}

/**
 * Simple suggestion heuristic for unknown tags.
 * Matches very common typos without a full Levenshtein pass.
 *
 * @param {string} rawTag
 * @returns {string | undefined}
 */
function suggestForUnknown(rawTag)
{
    switch (rawTag)
    {
        case 'VERT':       return 'V';
        case 'HORIZ':      return 'H';
        case 'HORIZONATL': return 'H';
        case 'SPLASH':     return 'SPREAD';
        case 'BROKEN':     return 'BORDERLESS';
        case 'DIAGONAL':
        case 'DIAG-H':
        case 'DIAG-V':     return undefined; // no modern equivalent
        case 'ROW':        return 'GROUP';
        case 'LARGE':      return 'L';
        case 'MEDIUM':     return undefined; // drop entirely
        default:
        {
            if (/^H-\d/.test(rawTag)) return 'H';
            if (/^V-\d/.test(rawTag)) return 'V';
            return undefined;
        }
    }
}

/**
 * Classify tags into (layout, size, style). Later modifiers win on conflict
 * (for size and style); FIRST layout tag wins on conflict (per plan Section 2.5).
 *
 * Output order is deterministic and independent of input order — [INSET][S]
 * and [S][INSET] produce identical output.
 *
 * @param {string[]} tags       - Raw tag strings (from `extractTags`)
 * @param {number}   [panelIndex=0] - Present for signature compat with the old
 *                                    classifier; unused by the new surface.
 * @returns {ClassifiedTags}
 */
export function classifyTags(tags, panelIndex = 0)
{
    void panelIndex;

    /** @type {PanelLayoutKind} */
    let layout = 'none';
    /** @type {PanelSizeKind} */
    let size   = null;
    /** @type {PanelStyleKind} */
    let style  = null;
    /** @type {InsetOrientationKind | undefined} */
    let orientation;
    let hasSplit = false;
    let joinGroup = false;
    let placeAtEnd = false;

    // All layout-canonical tags seen IN INPUT ORDER (used to disambiguate
    // INSET+orientation, SPLIT-as-flag, and real layout conflicts).
    /** @type {string[]} */
    const seenLayoutTags = [];
    /** @type {string[]} */
    const seenSizes      = [];
    /** @type {string[]} */
    const seenStyles     = [];
    /** @type {ParseWarning[]} */
    const warnings       = [];

    for (const raw of tags)
    {
        const canonical = canonicaliseTag(raw);

        if (canonical === null)
        {
            warnings.push({
                code: 'unknown-tag',
                message: buildUnknownMessage(raw),
                offendingTag: raw,
                suggestion: suggestForUnknown(raw)
            });
            continue;
        }

        // [M] and any future "silently drop" alias
        if (canonical === '__DROP__') continue;

        if (LAYOUT_CANONICAL.has(canonical))
        {
            seenLayoutTags.push(canonical);
        }
        else if (MODIFIER_FLAGS.has(canonical))
        {
            // Pure flag — does not occupy a layout/size/style channel and never
            // conflicts with another tag. Repeating [END] is a no-op.
            if (canonical === 'END') placeAtEnd = true;
        }
        else if (SIZE_CANONICAL.has(canonical))
        {
            seenSizes.push(canonical);
            // Later-wins for size, per plan 2.5.
            size = /** @type {PanelSizeKind} */ (canonical);
        }
        else if (STYLE_CANONICAL.has(canonical))
        {
            seenStyles.push(canonical);
            // Later-wins for style. BLEED and BORDERLESS are separate — the
            // later one simply replaces the earlier one in this field.
            style = /** @type {PanelStyleKind} */ (canonical);
        }
    }

    // --- Resolve layout vs. orientation vs. SPLIT-flag ---------------------
    //
    // Rules (see TODO/PANEL_GRID_REFACTOR.md Sections 2.1 INSET Details,
    // 2.1 SPLIT Details, 2.5 Tag Stacking):
    //
    //   - SPLIT is an overlay flag, NOT a competing layout. [H][SPLIT] =
    //     layout H, hasSplit=true. Bare [SPLIT] = layout none, hasSplit=true.
    //   - INSET is a layout. When it stacks with an H or V, the H/V becomes
    //     an ORIENTATION modifier, not a second layout tag. [INSET][H] is
    //     legal and silent.
    //   - Everything else: first real-layout tag wins, others warn.

    // Pull SPLIT out first — it never competes with other layouts.
    const nonSplitLayoutTags = [];
    for (const t of seenLayoutTags)
    {
        if (t === 'SPLIT') hasSplit = true;
        else nonSplitLayoutTags.push(t);
    }

    // Pull GROUP out as a join-modifier when it appears alongside any OTHER
    // layout tag. [G]/[GROUP] has a dual role: alone it's the GROUP layout,
    // but stacked with another layout tag (e.g. [H][G], [V][L][G]) it just
    // signals "this panel joins the open group / [V][L] container". This is
    // not a layout conflict.
    //
    // [GROUP][GROUP] keeps its plain GROUP layout (no joinGroup) — a single
    // tag kind on its own (even repeated) doesn't trigger the join semantics.
    const groupCount = nonSplitLayoutTags.filter(t => t === 'GROUP').length;
    const hasOtherLayoutTag = nonSplitLayoutTags.some(t => t !== 'GROUP');
    let layoutTagsForResolution = nonSplitLayoutTags;
    if (groupCount > 0 && hasOtherLayoutTag)
    {
        joinGroup = true;
        layoutTagsForResolution = nonSplitLayoutTags.filter(t => t !== 'GROUP');
    }
    else if (groupCount > 1 && !hasOtherLayoutTag)
    {
        // [GROUP][GROUP] with nothing else — collapse to a single GROUP layout.
        // Repeating the same single layout kind isn't a real conflict for the
        // dual-role tag; just dedupe so the existing first-wins logic emits no
        // warning.
        layoutTagsForResolution = ['GROUP'];
    }

    // Is INSET in play? If so, consume H/V as orientation modifiers.
    const hasInset = layoutTagsForResolution.includes('INSET');
    /** @type {string[]} */
    const layoutConflictTags = [];

    if (hasInset)
    {
        layout = 'INSET';
        for (const t of layoutTagsForResolution)
        {
            if (t === 'INSET') continue;
            if (t === 'H' || t === 'V')
            {
                // First orientation wins.
                if (orientation === undefined)
                {
                    orientation = /** @type {InsetOrientationKind} */ (t);
                }
                continue;
            }
            layoutConflictTags.push(t);
        }

        // A second INSET is still a real conflict.
        const insetCount = layoutTagsForResolution.filter(t => t === 'INSET').length;
        if (insetCount > 1)
        {
            layoutConflictTags.unshift(...new Array(insetCount - 1).fill('INSET'));
        }

        if (layoutConflictTags.length > 0)
        {
            const all = ['INSET', ...layoutConflictTags];
            warnings.push({
                code: 'stack-multiple-layout',
                message: `Panel has multiple layout tags (${all.map(t => `[${t}]`).join(' ')}). The first one — [INSET] — wins.`
            });
        }
    }
    else
    {
        // No INSET → classic first-wins, H and V are full layouts.
        for (const t of layoutTagsForResolution)
        {
            if (layout === 'none') layout = /** @type {PanelLayoutKind} */ (t);
        }
        if (layoutTagsForResolution.length > 1)
        {
            warnings.push({
                code: 'stack-multiple-layout',
                message: `Panel has multiple layout tags (${layoutTagsForResolution.map(t => `[${t}]`).join(' ')}). The first one — [${layoutTagsForResolution[0]}] — wins.`
            });
        }
    }

    if (seenSizes.length > 1)
    {
        warnings.push({
            code: 'stack-multiple-size',
            message: `Panel has conflicting size modifiers (${seenSizes.map(t => `[${t}]`).join(' ')}). The last one — [${seenSizes[seenSizes.length - 1]}] — wins.`
        });
    }

    // Legacy back-compat fields — keep the current grid calculator happy until
    // the [GRID] workstream rewrites it. `type` mirrors the canonical layout;
    // `modifiers` carries size + style so downstream CSS-generator code still
    // sees BLEED / BORDERLESS / S / L.
    //
    // Two new modifier contributions:
    //   - When layout=INSET, push the orientation (H or V) into modifiers so
    //     the INSET overlay placer's orientation lookup (which scans
    //     panel.modifiers for 'H'/'V') keeps working.
    //   - When hasSplit, push 'SPLIT' into modifiers so the grid calculator's
    //     SPLIT overlay pass can detect it via modifier scan even when the
    //     layout is H/V/etc.
    /** @type {PanelType | undefined} */
    let legacyType;
    /** @type {string[] } */
    const legacyModifiers = [];

    if (layout !== 'none')
    {
        legacyType = /** @type {PanelType} */ (layout);
    }
    if (size !== null)                             legacyModifiers.push(size);
    if (style !== null)                            legacyModifiers.push(style);
    if (layout === 'INSET' && orientation)         legacyModifiers.push(orientation);
    if (hasSplit)                                  legacyModifiers.push('SPLIT');
    // Preserve [G]/[GROUP] in the legacy modifier list so the calculator's
    // existing `joinGroup` detection (which scans `panel.modifiers` for 'G' /
    // 'GROUP') keeps working without engine changes.
    if (joinGroup)                                 legacyModifiers.push('G');
    // Surface [END] on the legacy modifier list so the calculator can detect
    // the END-anchored variant of [V][L] without engine changes.
    if (placeAtEnd)                                legacyModifiers.push('END');

    /** @type {ClassifiedTags} */
    const result = {
        layout,
        size,
        style,
        type: legacyType,
        modifiers: legacyModifiers,
        warnings
    };
    if (orientation) result.orientation = orientation;
    if (hasSplit)    result.hasSplit = true;
    if (joinGroup)   result.joinGroup = true;
    if (placeAtEnd)  result.placeAtEnd = true;
    return result;
}

/**
 * Build an artist-friendly "unknown tag" message with an optional suggestion.
 * @param {string} rawTag
 * @returns {string}
 */
function buildUnknownMessage(rawTag)
{
    const hint = suggestForUnknown(rawTag);
    if (hint)
    {
        return `Unknown tag [${rawTag}] — did you mean [${hint}]?`;
    }
    return `Unknown tag [${rawTag}].`;
}
