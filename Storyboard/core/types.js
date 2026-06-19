/**
 * Mangaplay Core Type Definitions
 * JSDoc types for IDE support without TypeScript
 */

// =============================================================================
// SCRIPT AST TYPES
// =============================================================================

/**
 * @typedef {'Manga' | 'Comic'} Format
 * Format determines reading direction:
 * - Manga: Right to Left
 * - Comic: Left to Right
 */

/**
 * @typedef {'LTR' | 'RTL'} ReadingDirection
 * Reading direction for panel layouts:
 * - LTR: Left to Right (Comic format)
 * - RTL: Right to Left (Manga format)
 */

/**
 * @typedef {string} Status
 * Free-text status value. Common values: 'Draft', 'In Progress', 'Complete',
 * 'Published', 'One Shot'. Any string is accepted — validators should not
 * enforce a closed enum.
 */

/**
 * @typedef {'mangaplay' | 'superscript'} ScriptFormat
 * Script format type:
 * - mangaplay: Fountain-style metadata with # PAGE headers and 4/8-space indentation
 * - superscript: Plain text format with colon dialogue and auto-numbering
 */

/**
 * @typedef {'A' | 'B' | 'mixed'} IndentStyle
 * - 'A': Panels at 4 spaces, dialogue at 8 spaces (canonical)
 * - 'B': Panels at 0 spaces, dialogue at 4 spaces (relaxed)
 * - 'mixed': Both conventions appear in the same file
 */

/**
 * @typedef {Object} ScriptMetadata
 * @property {string} title
 * @property {string} [author]
 * @property {string} [credit]      - e.g. "written by", "screenplay by"
 * @property {string} [source]      - e.g. "based on the novel by Daniel Wallace"
 * @property {string} [draftDate]   - e.g. "January 15, 2003"
 * @property {string} [contact]     - contact info
 * @property {string} [copyright]   - copyright notice
 * @property {string} [notes]       - additional notes
 * @property {string} [genre]
 * @property {Format} [format] - Manga (RTL) or Comic (LTR)
 * @property {number} [totalPages]
 * @property {Status} [status]
 * @property {ScriptFormat} [scriptFormat] - Source format (mangaplay or superscript)
 * @property {IndentStyle} [indentStyle] - Dominant indentation convention
 * @property {string[]} [characters] - Character names from title page (optional)
 * @property {string[]} [vocabulary] - Custom vocabulary words from title page (optional)
 * @property {boolean} [_totalPagesImplicit] - True when totalPages auto-counted (internal)
 */

/**
 * @typedef {'INT' | 'EXT'} LocationType
 */

/**
 * @typedef {'DAY' | 'NIGHT' | 'DAWN' | 'DUSK'} TimeOfDay
 */

/**
 * @typedef {Object} Location
 * @property {LocationType} type
 * @property {string} place
 * @property {TimeOfDay} [time]
 */

/**
 * @typedef {'H' | 'V' | 'WIDE' | 'GROUP' | 'INSET' | 'SPLIT' | 'SPREAD' | 'A' | string} PanelType
 * Panel types (Panel Grid Refactor, Section 2):
 * - H      : Horizontal — full-width row panel
 * - V      : Vertical — tall single panel
 * - WIDE   : Solo hero panel on its own row, rendered at 115% row width
 * - GROUP  : Shared-row container
 * - INSET  : Overlay panel on top of its parent's cell (outside the grid)
 * - SPLIT  : Panel divided by a dotted horizontal line; size unchanged
 * - SPREAD : Full-page splash (canonical name; [FULL] is a silent alias)
 * - A      : Internal auto tag — the parser assigns this to untagged
 *            non-first panels. Never typed by authors.
 * Legacy types (SPLASH / BROKEN / DIAGONAL / DIAG-H / DIAG-V / HORIZ /
 * VERT / H-N / V-N / H-N/M) were removed in the Panel Grid Refactor —
 * see TODO/PANEL_GRID_REFACTOR.md Section 5.1.
 */

/**
 * @typedef {Object} GridCell
 * @property {number} panelIndex - Index of panel occupying this cell, or -1 if empty
 * @property {boolean} isSpanContinuation - True if cell is continuation of a multi-cell span
 */

/**
 * @typedef {Object} GridTemplate
 * @property {number} rows - Number of rows in grid
 * @property {number} cols - Number of columns in grid
 * @property {GridCell[][]} cells - 2D array [row][col] of cell occupancy
 * @property {Map<number, {row: number, col: number, rowSpan: number, colSpan: number}>} placements - Panel index to grid placement
 */

/**
 * @typedef {Object} GridLayoutError
 * @property {'overlap' | 'out-of-bounds' | 'no-space'} type
 * @property {string} message
 * @property {number[]} panelIndices - Indices of panels involved in the conflict
 */

/**
 * @typedef {'speech' | 'thought' | 'whisper' | 'caption'} DialogueType
 */

/**
 * @typedef {Object} Dialogue
 * @property {string} character
 * @property {DialogueType} type
 * @property {string} text
 * @property {boolean} [offPanel]
 * TBD: dual-dialogue UI integration in <mps-visual-editor>.
 * Round-trip is correct today; only the visual editing UI is missing.
 * See TODO/mps-visual-panel-editor.md → dual-dialogue-tbd task.
 * @property {boolean} [dualDialogue] - Fountain dual dialogue ^
 * @property {string[]} [modifier] - Fountain character extensions e.g. ["CONT'D"], ["SPEAKER", "CONT'D"]
 * @property {boolean} [continuation] - True when this is a continuation beat of the preceding character's block
 */

/**
 * @typedef {Object} TitleCard
 * @property {string} type - e.g., 'TITLE', 'ROBOT TITLE', 'VILLAIN TITLE'
 * @property {string} name
 * @property {string} [info]
 */

/**
 * @typedef {Object} Panel
 * @property {number} index - Internal sequential index (0-based) within the page
 * @property {number} displayNumber - User's written panel number (may have duplicates/gaps)
 * @property {PanelType} [type] - Primary layout tag (H, V, WIDE, GROUP, INSET, SPLIT, SPREAD)
 * @property {string[]} [modifiers] - Modifier tags (BLEED, BORDERLESS, DIAGONAL, etc.)
 * @property {string} description
 * @property {Dialogue[]} dialogue
 * @property {string[]} sfx
 * @property {TitleCard[]} titleCards
 * @property {number} [lineNumber] - 0-based line number where panel starts
 * @property {number} [lineNumberEnd] - 0-based line number where panel ends
 * @property {string[]} [notes] - Fountain notes [[comment]]
 * @property {string[]} [transitions] - Fountain transitions (CUT TO:, FADE TO:, >forced)
 * @property {string[]} [centered] - Fountain centered text >TEXT<
 * @property {string} [synopsis] - Fountain synopsis = text
 * @property {string[]} [lyrics] - Fountain lyrics ~text
 * @property {boolean} [rowStart] - true when this panel begins a row group (set by [ROW] tag).
 *   Row-group membership is inferred at layout time: rowStart panels open a
 *   cluster, subsequent untagged panels belong to it until the next rowStart.
 * @property {number} [_panelIndent] - Detected panel indent (0 or 4). Internal.
 */

 * TBD: page-level direction — add `action` / `description` field for pre-panel prose
 * on the page. Today these lines attach to the first Panel's description.
 * See TODO/mps-visual-panel-editor-remediation.md → document-page-direction-v2.
 *
 * @typedef {Object} Page
 * @property {string} id - Full page ID (e.g., "1", "10-1", "0-COVER", "0-I")
 * @property {number} baseNumber - The numeric portion
 * @property {string} [suffix] - Optional suffix (e.g., "1", "COVER", "I")
 * @property {number} [displayNumber] - Sequential 1-indexed position in pages array for user display
 * @property {Location} [location]
 * @property {Panel[]} panels
 * @property {number} [lineNumber] - 0-based line number where page header starts
 */

/**
 * @typedef {Object} ParseError
 * @property {number} line - 0-based line number
 * @property {number} [column] - 0-based column (optional)
 * @property {number} [length] - Length of the offending text (optional)
 * @property {string} message - Human-readable error message
 * @property {'error' | 'warning' | 'info'} severity
 */

/**
 * @typedef {Object} ScriptAST
 * @property {ScriptMetadata} metadata
 * @property {Page[]} pages
 * @property {ParseError[]} [errors] - Parse errors and warnings
 * @property {ScriptFormat} [format] - Source format that produced this AST
 */
