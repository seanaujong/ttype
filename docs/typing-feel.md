# Making typing feel good

This doc covers _how the act of typing should feel_. The north star: **chill, not strict**. Mistakes don't ruin runs. Structural whitespace doesn't punish you. Visual feedback stays local and proportionate.

These principles take precedence over "what other type racers do." We cite prior art to learn from it, not copy.

## At a glance

- **Chill > strict** — wrong keys are marked and counted, not halted on. No strict mode in v1.
- **Render the structure, require the content** — whitespace, blank lines, and (later) diff/markdown markers are displayed but auto-skipped from the typing path.
- **Errors stay local** — each wrong key marks one red char. The cursor and source-comparison frame don't drift apart unless the user types insertions or deletions (which they recover from via backspace).
- **Correction is cheap and obvious** — backspace is seamless, symmetric with forward motion, and carries no accuracy penalty.
- **Cursor is visible and obvious** — inverse-video background on the next char, not a thin caret.

## What other trainers do (in one paragraph each)

- **TypeRacer** is strict — you cannot advance past a wrong character; you must fix it. Errors render bright red. Historically, cascading errors after a mistake all counted against you; they later fixed that so consecutive post-error chars register as one error. Stat-side leniency, not visual leniency.
- **Monkeytype** exposes a spectrum: `stop on error: off / letter / word`, plus a "freedom mode" that lets you advance past errors. The fact that they need to manage mutually-exclusive modes (e.g., "confidence mode" disables several other settings) is itself a signal — strict-mode interactions are fiddly. Their default lets you push through.
- **TiltStack** (code-typing trainer) explicitly designs for comfort: VS Code–style auto-indent on Enter so you don't waste keystrokes typing four tabs to start a line. Their stated rationale matches ours: "if you have to manually hit Tab four times to get to the correct indentation level on a new line, you're spending keystrokes on navigation the IDE would handle automatically."
- **Typing.io** practices over real open-source code with whitespace preserved (no auto-skip), which is the _strict_ end of the code-trainer spectrum. We are explicitly not building this.

The trainers designed for comfort (Monkeytype's freedom mode, TiltStack's auto-indent) point the same direction we're going. The strict ones (TypeRacer, Typing.io) are what we're _not_ doing in v1.

## Chill > strict

One wrong character should not tank a run, halt the cursor, or feel like a big deal.

**Rules:**

- A wrong key is _marked_ and _counted_, but you advance past it. No halt.
- No strict mode in v1. We can add `--strict` later if anyone actually wants it; don't build it speculatively.
- End-of-run summary uses lenient accuracy (see _correction is cheap and obvious_ below) — using backspace to fix a mistake is not penalized.

## Render the structure, require the content

The screen shows structural / cosmetic characters in their original positions, but ttype doesn't make you type them. Whitespace is the simplest example; later this same principle handles diff line markers (`+`/`-`/` `, `@@` hunk headers) and possibly markdown structural chars. Adapters are the layer that decides what's cosmetic for a given input; the engine never branches on input kind.

**Rules:**

- **Leading whitespace** on a line: rendered (so the shape is intact), but the cursor _starts_ at the first non-whitespace character.
- **Enter at end of line** advances the cursor past the newline; blank lines between content are skipped entirely (visible, but not part of the typing path). Multiple blank lines in a row collapse — one Enter takes the cursor to the first non-whitespace character of the next non-blank line.
- **Tabs** are rendered however the source contains them but never count as required keystrokes — leading or mid-line.
- **Trailing whitespace** is stripped on ingestion. Always.

The effective rule: **the cursor only ever rests on a character the user is expected to actually type.** Indentation, blank lines, and other structural whitespace are _displayed-but-skipped_.

This is the load-bearing design decision in this doc. It means the engine's cursor isn't `position += 1` — it's `cursor = nextTypeableIndex(text, cursor)`.

## Errors stay local

A single wrong keystroke marks one char red — it doesn't infect the rest of the line.

**Rules:**

- A char you typed _wrong_ stays red until you correct it (or stays red forever if you don't).
- A char you typed _correctly_ is always green — even if there's an uncorrected error earlier on the same line.
- The cursor highlight is its own color (inverse video on the current char), not tied to correctness.
- If you backspace and retype, the latest state wins. No ghost errors accumulating.
- Error count is per-keystroke, not per-displayed-red-char. Pressing the wrong key once = 1 error in the stats.

So "red text" is bounded to _the actual wrong chars you've typed and not corrected_. The visual maximum red on screen is the count of uncorrected wrong keystrokes — never a region.

### Known limit — insertion drift

The flat-cursor engine has one known weakness: **inserting an extra character shifts the comparison frame for everything after it**. If the user types one too many letters in a word, every subsequent expected character is off by one against the source, and a cascade of red lights up until the user notices and backspaces.

In practice this is bounded by the user's perception speed (seconds, not minutes) and recovered with backspace. We accept it. The original design considered a more elaborate word-aware engine to bound the cascade automatically; dogfooding the flat version showed the cost-benefit didn't favor it.

## Correction is cheap and obvious

- **Backspace** moves the cursor back one _typeable_ index (it skips over auto-skipped whitespace the same way forward motion does — symmetric with _render the structure, require the content_).
- Holding backspace works at the OS key-repeat rate. Nothing special.
- There is _no penalty_ for using backspace. Accuracy is measured against the _final state_ of the text, not the keystroke history. (This is "lenient accuracy".)

## Cursor is visible and obvious

The next-to-type character gets a **background highlight** (inverse video), not a thin caret. Carets are easy to lose against monospaced text on dark themes.

When the cursor sits on a newline (a typeable position with no visible glyph, since the line was split for rendering), the renderer surfaces it as an `↵ENTER` marker at the end of the current line. The user always knows where the next keystroke will land.

## Engine implications

These principles aren't just visual — they shape the engine's API:

- The engine maintains an **ordered list of typeable indices** into the source text. The cursor is always one of these (or `done`).
- Each keystroke advances the cursor through the typeable list, not through every character. Skipped chars (leading whitespace, tabs, blank lines) are positions the cursor never lands on.
- Wrong keys advance the cursor anyway (chill mode), with the typed char recorded for accuracy / display. Backspace retreats one typeable position.
- The set of typeable indices is computed at ingestion time from configurable rules: strip trailing whitespace, skip leading whitespace, skip blank lines, skip tabs, skip diff line markers (later), etc.
- Renderers receive engine state and produce output. They never mutate engine state.

This keeps the engine general while making "render but don't require" a first-class concept rather than a hack.

## Open questions

- **Per-character mistake breakdown at end-of-run:** useful, but adds end-screen complexity. Defer.
- **Lenient vs. strict accuracy:** lenient (final-state-based) by default. Strict (every-keystroke-counts) is interesting later as a stat _displayed alongside_, not as the primary number.
- **`--strict` mode:** if anyone asks for it, that's the moment to build it. Don't speculate.
