# Making typing feel good

Where [use-cases.md](use-cases.md) covers *what people use ttype for*, this doc covers *how the act of typing should feel*. The north star: **chill, not strict**. Mistakes don't ruin runs. Structural whitespace doesn't punish you. Visual feedback stays local and proportionate.

These principles take precedence over "what other type racers do." We cite prior art to learn from it, not copy.

## At a glance

- **Chill > strict** — wrong keys are marked and counted, not halted on. No strict mode in v1.
- **Render the structure, require the content** — whitespace, blank lines, and (later) diff/markdown markers are displayed but auto-skipped from the typing path.
- **Errors stay local** — red is bounded to the actual wrong chars you typed; never cascades into future correct chars.
- **Words are sync points** — whitespace closes the current word and advances to the next; drift is bounded to one word, not the whole line.
- **Correction is cheap and obvious** — backspace is seamless, symmetric with forward motion, and carries no accuracy penalty.
- **Cursor is visible and obvious** — inverse-video background on the next char, not a thin caret.

## What other trainers do (in one paragraph each)

- **TypeRacer** is strict — you cannot advance past a wrong character; you must fix it. Errors render bright red. Historically, cascading errors after a mistake all counted against you; they later fixed that so consecutive post-error chars register as one error. Stat-side leniency, not visual leniency.
- **Monkeytype** exposes a spectrum: `stop on error: off / letter / word`, plus a "freedom mode" that lets you advance past errors. The fact that they need to manage mutually-exclusive modes (e.g., "confidence mode" disables several other settings) is itself a signal — strict-mode interactions are fiddly. Their default lets you push through.
- **TiltStack** (code-typing trainer) explicitly designs for comfort: VS Code–style auto-indent on Enter so you don't waste keystrokes typing four tabs to start a line. Their stated rationale matches ours: "if you have to manually hit Tab four times to get to the correct indentation level on a new line, you're spending keystrokes on navigation the IDE would handle automatically."
- **Typing.io** practices over real open-source code with whitespace preserved (no auto-skip), which is the *strict* end of the code-trainer spectrum. We are explicitly not building this.

The trainers designed for comfort (Monkeytype's freedom mode, TiltStack's auto-indent) point the same direction we're going. The strict ones (TypeRacer, Typing.io) are what we're *not* doing in v1.

## Chill > strict

One wrong character should not tank a run, halt the cursor, or feel like a big deal.

**Rules:**
- A wrong key is *marked* and *counted*, but you advance past it. No halt.
- No strict mode in v1. We can add `--strict` later if anyone actually wants it; don't build it speculatively.
- End-of-run summary uses lenient accuracy (see *correction is cheap and obvious* below) — using backspace to fix a mistake is not penalized.

## Render the structure, require the content

The screen shows structural / cosmetic characters in their original positions, but ttype doesn't make you type them. Whitespace is the simplest example; later this same principle handles diff line markers (`+`/`-`/` `, `@@` hunk headers) and possibly markdown structural chars. Adapters are the layer that decides what's cosmetic for a given input; the engine never branches on input kind. See [engine-design.md](engine-design.md) for the span shape this implies.

**Rules:**
- **Leading whitespace** on a line: rendered (so the shape is intact), but the cursor *starts* at the first non-whitespace character.
- **Enter at end of line** advances the cursor to the first non-whitespace character of the next non-blank line. Blank lines are skipped entirely (visible, but not part of the typing path).
- **Enter mid-line** is allowed and seamless: the remaining untyped characters on the current line are marked red (you "missed" them), and the cursor jumps to the first non-whitespace character of the next non-blank line. No halt, no penalty beyond the visual mark.
- **Tabs** are rendered however the source contains them but never count as required keystrokes.
- **Trailing whitespace** is stripped on ingestion. Always.

The effective rule: **the cursor only ever rests on a character the user is expected to actually type.** Indentation, blank lines, and other structural whitespace are *displayed-but-skipped*.

This is the load-bearing design decision in this doc. It means the engine's cursor isn't `position += 1` — it's `cursor = nextTypeableIndex(text, cursor)`.

## Errors stay local

A single wrong keystroke must not visually contaminate everything that comes after.

**Rules:**

- A char you typed *wrong* stays red until you correct it (or stays red forever if you don't).
- A char you typed *correctly* is always green — even if there's an uncorrected error earlier on the same line.
- The cursor highlight is its own color (inverse video on the current char), not tied to correctness.
- If you backspace and retype, the latest state wins. No ghost errors accumulating.
- Error count is per-keystroke, not per-displayed-red-char. Pressing the wrong key once = 1 error in the stats.

So "red text" is bounded to *the actual wrong chars you've typed and not corrected*. The visual maximum red on screen is the count of uncorrected wrong keystrokes — never a region.

Optional (decide later): a subtle underline on the *word* containing an uncorrected error, so it's findable when you're scrolling fast. Adds visibility without staining future text.

## Words are sync points

*Errors stay local* takes care of per-character locality (one wrong key marks one red char). This principle takes the same idea up one level: **per-word locality**. The cursor is word-aware, and whitespace acts as a *sync point* that resets the cursor regardless of what got typed inside the word. The damage from a drift (typing extra characters, undertyping, fat-fingering halfway through a word) is bounded to that one word; the next word starts fresh.

**The cursor is word-aware.** Instead of advancing 1:1 through the entire source, the cursor tracks `{ word, charIndex, extras }`. Each keystroke is interpreted against the *current* word, not against an absolute position in the source.

**Rules:**

- **Within a word:** non-whitespace keys match against the char at `charIndex`. Right keys advance with green; wrong keys advance with red. If the user types past the end of the word, those keys go into a per-word `extras` list (rendered after the word, see open questions for the style).
- **At any whitespace key** (space, tab, Enter): the current word **closes**. Anything not yet typed becomes missed (auto-marked red, same category as Enter-mid-line). `extras` are kept for the review. The cursor advances to the start of the next word with `charIndex = 0`.
- **Backspace within a word:** retreats `charIndex` (or pops the last extra). Symmetric with forward motion.
- **Backspace from the start of a word:** retreats into the previous word at its last position; the previous word is *reopened* for correction.

**What "word" means is decided by the adapter, not the engine.** For v1, every adapter uses *whitespace-delimited tokens* as words — that's good enough for prose and acceptable for code. Later adapters can refine (a code adapter might also split on operators, a diff adapter might split on the leading `+`/`-`/` ` line markers) without the engine changing. See the adapter shape in [engine-design.md](engine-design.md).

**No-whitespace inputs are a known limit.** A 200-char URL or a long single-token identifier has no internal sync points; drift inside it still cascades the way it would on a whole line. We accept this — it's a rare edge case, and users typing URLs aren't the core use case.

### How a word renders

Two-line per word, column-aligned. The display is a *diff view* between source and typed:

- **Mainline** — what the user *actually* typed, character by character. Correct chars normal; any char that diverges from the source (wrongs *and* extras) is **struck-through in red**. The above-line disambiguates which category each strike is.
- **Above line** — what the user was *supposed* to type at each column where the mainline disagrees. Correctly-typed columns are blank above (no divergence to flag). The source line ends at the word's length; columns past that on the mainline have no above-line counterpart — that's how the reader tells extras from wrongs.
- **Above-line color** — a quiet "reference" color (e.g., dim cyan or muted yellow). Definitely not green or red, since those carry "correct" / "wrong" meaning on the mainline. Final color choice deferred to when we build the renderer.

Example. Source: `Hello`. User typed: `Hxxxllo` (7 keys: H correctly, then `xxx` instead of `ell`, then `l` instead of `o`, then `lo` as extras).

```
 ello
Hxxxllo
```

Reading by column:
- col 0: above blank, main `H` — correct.
- cols 1–3: above shows `ell` (expected), main shows `xxx` struck-through — three wrongs.
- col 4: above shows `o`, main shows `l` struck-through — wrong at the last source position.
- cols 5–6: no above (source ended at col 5), main shows `lo` struck-through — extras past the end of `Hello`. *They're styled identically to wrongs; the absence of an above-line entry is what makes them readable as extras.*

A perfectly typed word renders with the above-line completely blank, so the two-line display effectively collapses to one line for clean stretches. Divergence is what makes the above-line appear. This keeps the screen quiet when typing is going well and surfaces exactly where it went wrong when it isn't.

**Engine state vs. rendering:** the engine still distinguishes wrongs from extras as separate categories in the keystroke log and per-word state (review wants the distinction, and stats want the distinction). The unified red strikethrough is a *rendering* choice — same data, simpler presentation.

**Why this matters:** without word-as-sync-point, the drift problem cascades — one extra keystroke shifts every subsequent character by one position, and the user sees the whole rest of the line turn red even though they were typing the right letters. Word sync points cap the blast radius at one word.

### Backspace into a closed word

Backspacing into a previous word reopens it for correction. Specifically: the cursor lands at the last position of the previous word; any auto-missed marks on that word **revert to untyped** so the user can re-type them. The extras list reverts too — backspace pops the last extra before retreating into the word proper.

We can be relaxed about this because of [engine-design.md](engine-design.md)'s replayability: state is `events.reduce(applyEvent, initial)`, so "revert to a non-broken render state" is literally just "fold a shorter event list." There's no special undo logic to get wrong.

## Correction is cheap and obvious

- **Backspace** moves the cursor back one *typeable* index (it skips over auto-skipped whitespace the same way forward motion does — symmetric with *render the structure, require the content*).
- Holding backspace works at the OS key-repeat rate. Nothing special.
- There is *no penalty* for using backspace. Accuracy is measured against the *final state* of the text, not the keystroke history. (This is "lenient accuracy" — see open questions.)

## Cursor is visible and obvious

Borrow from TypeRacer's modern UI: the next-to-type character gets a **background highlight** (inverse video), not a thin caret. Carets are easy to lose against monospaced text on dark themes.

Maybe a subtle underline on the current word so it's findable when scrolling.

## Engine implications

These principles aren't just visual — they shape the engine's API. Worth surfacing before we write `type Engine = ...`:

- The engine maintains an **ordered list of typeable indices** into the source text. The cursor is always one of these (or `done`).
- `advance()` moves to the next typeable index; `back()` to the previous. Adapters/renderers never compute `+1`/`-1` themselves.
- `input(char)` compares against `text[currentIndex]`, records correct/incorrect, advances.
- The set of typeable indices is computed at ingestion time from configurable rules: strip trailing whitespace, skip leading whitespace, skip blank lines, skip diff line markers (later), etc. These are adapter-configurable, not engine-hardcoded.
- Renderers receive `(text, typeableIndices, cursorIndex, keystrokeLog)` and produce output. They never mutate engine state.

This keeps the engine general (the *general-purpose engine* goal in CLAUDE.md) while making "render but don't require" a first-class concept rather than a hack.

## Open questions

- **Word-error underline:** yes or no? (Possibly redundant now that mainline strikethrough + above-line target makes errors obvious — revisit when we build the renderer.)
- **Space at end of a word with an error:** TypeRacer auto-skips the rest of the word. *Lean: no, keep cursor advancement deterministic.*
- **Per-character mistake breakdown at end-of-run:** useful, but adds end-screen complexity. Defer.
- **Lenient vs. strict accuracy:** lenient (final-state-based) by default. Strict (every-keystroke-counts) is interesting later as a stat *displayed alongside*, not as the primary number.

---

**See also:** [use-cases.md](use-cases.md) for the input-source side of the design, and [../CLAUDE.md](../CLAUDE.md) for the overall goals.
