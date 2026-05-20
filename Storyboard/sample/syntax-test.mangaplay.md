Title: Mangaplay Syntax Test
Author: Pistol Taeja
Credit: written by
Source: Story by Pistol Taeja
Draft date: 2026-05-05
Copyright: (c) 2026 Pistol Taeja
Contact:
    Absolutely Skint
    1234 5th Avenue
    Anytown, Planet Earth, 12345-7890
Genre: Isekai
Format: Manga
Status: One Shot
Notes:
    Every page in this file demonstrates one feature from
    the Mangaplay syntax page at /syntax.

# Page 1 INT. PAGE 1

Panel 1
This page demonstrates the Page header. It carries a positive integer, a label, and an optional inline scene heading.

# Page 2 INT. PAGE 2

Panel 1
Page 2 is just another Page. The renderer treats it independently.

Panel 2
Two panels per page works the same as one.

# Page 3 INT. PAGE 3

Panel 1
This page demonstrates Panel headers. Each panel begins with the literal word Panel and a positive integer at the start of the line.

Panel 2
Panel numbers are sequential within a page.

Panel 3
A new page resets the panel counter.

# Page 4 INT. PAGE 4

Panel 1 [BLEED] [L]
Panel tags go in square brackets after the panel number. This panel stacks a style tag and a size modifier.

Panel 2 [H][G]
Stacking a shape tag with the [G] modifier joins the previous open container.

Panel 3 [V][L] [END]
A tall, large panel anchored at the end of its row.

Panel 4 [INSET]
An inset window inside the previous panel.

Panel 5 [SPLIT]
A split panel with a dotted divider down the middle.

Panel 6 [SPREAD]
A splash panel that fills the entire page.

# Page 5 INT. PAGE 5

Panel 1
Action is plain prose at the start of the line.

A cracked highway stretches into the distance.

Rusted automatons litter the roadside.

Panel 2
DOROTHY walks the centre line, hat low, eyes hidden.

# Page 6 INT. PAGE 6

Panel 1

    HERO
    Character cues are written in caps on their own line.

    HERO
    The dialogue indents underneath the cue.

Panel 2

@McAvoy
A leading at-sign forces a character cue regardless of casing.

# Page 7 INT. PAGE 7

Panel 1

    HERO
    (whispering)
    Parentheticals sit between the cue and the dialogue.

    HERO
    (thought)
    They mark tone, delivery type, or thought bubbles.

# Page 8 INT. PAGE 8

Panel 1
Sound effects sit on their own line, in caps, with SFX in front.

    SFX: BOOM

    SFX: CHOMP CHOMP

# Page 9 INT. PAGE 9

Panel 1
Captions and title cards on their own line, pipe-separated.

    TITLE Executive Class : Enemy Of The State, | DOROTHY | Age 44

Panel 2

    NARRATION
    For caption boxes inside a panel, NARRATION is the speaker.

# Page 10 INT. PAGE 10

Panel 1
Scene headings can stand alone between panels.

INT. CORRIDOR - NIGHT

Panel 2
Forced scene heading with a leading period:

.kitchen

# Page 11 INT. PAGE 11

Panel 1
Transitions are a Fountain primitive.

CUT TO:

Panel 2

FADE OUT.

Panel 3

FADE IN:

Panel 4
Forced transition with a leading greater-than sign:

> FADE TO BLACK.

# Page 12 INT. PAGE 12

Panel 1
Author notes use double square brackets.

[[ remember to redraw the foreground ]]

Panel 2
Notes are kept out of the rendered page but stay in the source file.

[[ check the lighting in this panel ]]

# Page 13 INT. PAGE 13

/* PANEL 1 [BLEED] */
Boneyard panels are the Fountain-safe alternative to the Panel header.

/* PANEL 2 [INSET] */
A pure Fountain reader will silently strip them.

/* PANEL 3
   [WIDE] [ESTABLISHING] */
The multi-line form is supported too.

/* this is a regular Fountain author comment, not a panel */

# Page 14 INT. PAGE 14

Panel 1
Inline emphasis works the same as Fountain.

    HERO
    *italic*, **bold**, ***bold italic***, and _underline_.

Panel 2
Emphasis stacks: ***_bold italic underline_***.

# Page 15 INT. PAGE 15

Panel 1
A line wrapped in greater-than/less-than is centered.

> Centered title card <

Panel 2
A leading tilde marks a lyric.

~ A song line that floats on the page

~ A second lyric line in sequence

# Page 16 INT. PAGE 16

Panel 1
Three or more equals signs force a page break.

===

Panel 2
The forced break is recognised for Fountain compatibility. In a Mangaplay document, prefer the Page header.

# Page 17 INT. PAGE 17

!FADE IN:

Panel 1
A leading exclamation mark forces the line to be treated as action even when it looks like something else.

!CUT TO:

Panel 2
The forced action escape lets you write literal text that would otherwise parse as a transition or a slug.

# Page 18 INT. PAGE 18

Panel 1
Section headers are a Fountain primitive. They appear in the outline view but not in the rendered output. Mangaplay co-opts `# PAGE N` from this same syntax, so any other `# UPPERCASE_WORD N` line is reserved for future use and emits a warning.

## Chapter 2

Panel 2

### Subsection

Panel 3

# SCENE 5

Panel 4
Sections nest with multiple hashes (`#`, `##`, `###`). The parser tolerates them so future syntax extensions don't break old documents.

# Page 19 INT. PAGE 19

# Panel 1
The legacy hash-prefixed Panel form is recognised with a warning.

# Panel 2
Prefer the bare Panel N form, or the boneyard form for Fountain compatibility.

# Page 20 INT. PAGE 20

Panel 1
Dual dialogue is a Fountain primitive. Append a caret to the second character to signal two characters speaking simultaneously.

    ALICE
    What was that?

    BOB ^
    A tree branch, probably.

Panel 2
Three-way dual dialogue chains the carets:

    ALICE
    Hello!

    BOB ^
    Hi.

    CAROL ^
    Greetings.

# Page 21 INT. PAGE 21

Panel 1
Scene numbers can be appended to a scene heading, wrapped in hashes.

INT. KITCHEN - DAY #42#

Panel 2
Scene numbers can be alphanumeric.

EXT. ALLEYWAY - NIGHT #110A#

# Page 22 INT. PAGE 22

Panel 1
Character extensions sit in parentheses on the same line as the cue. Common ones from Fountain: off-screen, voice-over, continued.

    ALICE (O.S.)
    Are you listening?

    BOB (V.O.)
    He never listens.

    ALICE (CONT'D)
    Bob, please.

Panel 2
Mangaplay accepts `(O.P.)` (off-panel) as the equivalent of Fountain's `(O.S.)`.

    ALICE (O.P.)
    From the next panel over.

# Page 23 INT. PAGE 23

Panel 1
A synopsis is a Fountain primitive: a single equals sign followed by a one-line summary. Synopses describe sections or scenes and appear in outline tools, not in the rendered output.

= This page introduces Dorothy and the dying highway.

INT. STUDIO - DAY

= Subscene synopsis goes here too.

Panel 2
Synopses share the equals character with the forced page break. A single `=` is a synopsis. Three or more `===` on their own line is a forced page break. The parser must disambiguate.

# Page 24 INT. PAGE 24

Panel 1
Emphasis can be escaped with a backslash so the asterisks render as literal text.

    HERO
    The price was \*$100\* exactly.

    HERO
    Use \_underscores\_ for filenames like my_file.txt.

Panel 2
Combined emphasis stacks: ***_bold italic underline_***. Escaping inside emphasis still works: *the \*real\* asterisks*.

# Page 25 INT. PAGE 25

Panel 1
Last page. Mixing every feature in one panel:

INT. FINAL ROOM - DAWN

[[ this is a closing note ]]

A LLAMA, *unimpressed*, looks at the camera.

    LLAMA
    (deadpan)
    The end.

    SFX: WHEEZE

CUT TO:

> FADE TO BLACK. <

!>THE END.<
