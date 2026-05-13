# Scenarios — what typing actually looks like

Concrete, frame-by-frame walkthroughs of how ttype responds to keystrokes. Each scenario tests a specific rule from [typing-feel.md](typing-feel.md). When we build the engine, these become the unit tests / replay fixtures.

## At a glance

- **Happy path** — correct keystrokes advance the cursor through `Hello world` and complete the run.
- **Single wrong char, corrected with backspace** — wrong char goes red; backspace clears it; retype turns it green; the wrong keystroke still counts in stats.
- **Wrong char left uncorrected; future chars still green** — the headline anti-pattern from strict trainers: we don't stain the tail.
- **Cluster of wrong chars; no cascade** — three wrong keys in a row mark three red chars, not a region.
- **Enter at proper end of line** — leading whitespace on the next line is rendered but auto-skipped; cursor lands on the first non-whitespace char.
- **Enter mid-line** — allowed; remaining untyped chars on the line are auto-marked red as "missed"; cursor jumps to next line.
- **Backspace across a line break** — symmetric with forward motion; retreats into the previous line when current line has nothing to retreat over.
- **Blank line in source** — display-only; not part of the typing path.
- **Indented code line, mid-line entry** — the everyday case: typo, backspace, fix, continue. No drama.
- **Tabs in source** — structural tabs are rendered but not keystrokes.
- **Backspace at the very start** — no-op; not an error.

## Notation

Each cell below represents one character of the **source** text. The state changes based on what the user has done at that position.

| symbol | meaning | render |
| ------ | ------- | ------ |
| `X`    | untyped char | default color |
| `✓X`   | typed correctly | green |
| `✗X`   | typed wrong (or auto-marked wrong) | red |
| `[X]`  | cursor here — X is next to type | inverse-video highlight |
| `·`    | display-only char (auto-skipped: leading whitespace, blank line, etc.) | dim gray |
| `↵`    | end-of-line marker, shown when relevant | (only in these docs, not on screen) |

A "frame" shows the source text with its current per-cell state. Below each frame, a short note explains the engine state if it isn't obvious.

---

## Happy path

**Tests:** correct keystrokes advance the cursor; the run completes cleanly.

Source: `Hello world`

```
Frame 0 (initial):
  [H]ello world

Frame 1 — user types `H`:
  ✓H[e]llo world

Frame 2 — user types `ello world` (10 chars):
  ✓H✓e✓l✓l✓o✓ ✓w✓o✓r✓l✓d
  → run complete; end-of-run summary appears
```

Stats: 11 correct keystrokes, 0 wrong, 100% accuracy.

---

## Single wrong char, corrected with backspace

**Tests:** errors mark the char red; backspace moves back one typeable index; retyping correctly turns it green.

Source: `Hello`

```
Frame 0:
  [H]ello

Frame 1 — user types `H`:
  ✓H[e]llo

Frame 2 — user types `x` (meant `e`):
  ✓H✗e[l]lo
  → 'e' is red. Cursor advanced to 'l'. 1 error counted.

Frame 3 — user presses backspace:
  ✓H[e]llo
  → cursor moves back to 'e'. The red mark on 'e' clears (its state resets to "untyped").

Frame 4 — user types `e`:
  ✓H✓e[l]lo
  → 'e' is now green. Cursor on 'l'.

Frame 5 — user types `llo`:
  ✓H✓e✓l✓l✓o
  → run complete.
```

Stats: 6 correct keystrokes, 1 wrong, 6 / (6+1) ≈ 85.7% accuracy.

Note: even though the final on-screen state is "all green," the wrong keystroke is still counted in the stats. The visual ("did I leave anything red?") and the accuracy number ("did I press anything wrong?") are separate concepts.

---

## Wrong char left uncorrected; future chars still green

**Tests:** *errors stay local* from [typing-feel.md](typing-feel.md) — a wrong char does not stain subsequent correct chars.

Source: `Hello`

```
Frame 0:
  [H]ello

Frame 1 — user types `Hxllo` (typo on 2nd char, then 3 correct chars):
  ✓H✗e✓l✓l✓o
  → 'e' stays red. 'l', 'l', 'o' are green. Run complete.
```

Stats: 4 correct, 1 wrong. The red is bounded to the one wrong char.

This is the headline anti-pattern from TypeRacer-style trainers we're avoiding: there, the entire tail would render red until you backspaced and fixed the error. Here, you can finish the line and look back at exactly which char you missed.

---

## Cluster of wrong chars; no cascade

**Tests:** errors don't cascade. Pressing 3 wrong keys in a row marks 3 red chars, not the whole region after.

Source: `Hello world`

```
Frame 0:
  [H]ello world

Frame 1 — user types `Hxyz` (1 correct, 3 wrong in a row):
  ✓H✗e✗l✗l[o] world

Frame 2 — user types `o world` (7 correct):
  ✓H✗e✗l✗l✓o✓ ✓w✓o✓r✓l✓d
  → 3 red chars are clearly identifiable; everything after is green.
```

Stats: 8 correct, 3 wrong. Accuracy = 8/11 ≈ 72.7%.

---

## Enter at proper end of line

**Tests:** *render the structure, require the content* from [typing-feel.md](typing-feel.md) — leading whitespace is rendered but auto-skipped on Enter.

Source:
```
def hello():
    print("hi")
```

```
Frame 0 (initial):
  [d]ef hello():↵
  ····print("hi")
  → Cursor on 'd'. Leading 4 spaces on line 2 are shown as dim '·' (display-only).

Frame 1 — user types `def hello():` (12 chars correctly):
  ✓d✓e✓f✓ ✓h✓e✓l✓l✓o✓(✓)✓:↵
  ····print("hi")
  → cursor sits after the ':' — but where exactly is it? The line still has the ↵.

Frame 2 — user presses Enter:
  ✓d✓e✓f✓ ✓h✓e✓l✓l✓o✓(✓)✓:↵
  ····[p]rint("hi")
  → Cursor jumped to 'p', skipping over the 4 spaces. Spaces are still rendered (dim), but no keystrokes were required to traverse them.
```

Engine note: the `typeableIndices` list contains the 12 chars of `def hello():`, then jumps directly to the index of `p` — the 4 leading spaces aren't in the list.

---

## Enter mid-line

**Tests:** *render the structure, require the content* — pressing Enter before finishing a line is allowed; the rest of the line is auto-marked red; cursor jumps to next line.

Source:
```
Hello, world!
Goodbye.
```

```
Frame 0:
  [H]ello, world!↵
  Goodbye.

Frame 1 — user types `Hello` (5 chars correctly):
  ✓H✓e✓l✓l✓o[,] world!↵
  Goodbye.

Frame 2 — user presses Enter (mid-line!):
  ✓H✓e✓l✓l✓o✗,✗ ✗w✗o✗r✗l✗d✗!↵
  [G]oodbye.
  → All untyped chars on line 1 are now red (auto-marked, not user-typed).
    Cursor jumped to 'G' on line 2.
```

Stats: 5 correct keystrokes, 0 wrong keystrokes, but 8 missed chars on line 1.

**Decisions for this case:**

- **Auto-marked-red chars are tracked separately from typing errors.** They're "missed" / "skipped," not wrong keystrokes. The engine records them as a distinct category in the keystroke log. The user *chose* to skip; that's not the same as fat-fingering, and they shouldn't be conflated in any review the user sees. (See [review.md](review.md).)
- **Backspace can cross back into the auto-marked tail.** If the user backspaces from line 2 while line 2 has nothing typed, the cursor returns to the last auto-marked char on line 1 and clears its mark. Symmetric with the *backspace across a line break* scenario — Enter is not specially irreversible.

---

## Backspace across a line break

**Tests:** *correction is cheap and obvious* from [typing-feel.md](typing-feel.md) — backspace is symmetric with forward motion. It should retreat to the previous typeable index, even if that's on a previous line.

Source:
```
abc
xyz
```

```
Frame 0:
  [a]bc↵
  xyz

Frame 1 — user types `abc` then Enter:
  ✓a✓b✓c↵
  [x]yz

Frame 2 — user presses backspace:
  ✓a✓b✓c↵
  [???]
  → Where does the cursor go?
```

**Decision:** backspace from the start of line 2 (when line 2 has no typed chars) moves to the *last typeable index of the previous line*. So the cursor lands on `c`, and `c`'s green mark clears (back to untyped):

```
Frame 2 — backspace:
  ✓a✓b[c]↵
  xyz
```

Now if the user presses backspace again, it goes to `b`. And so on.

Edge case: if line 2 had typed chars, backspace just retreats within line 2. Cross-line backspace only fires when there's nothing on the current line to retreat over.

This is the chill principle: backspace just works, anywhere, always.

---

## Blank line in source

**Tests:** *render the structure, require the content* — blank lines are display-only.

Source:
```
First paragraph.

Second paragraph.
```

```
Frame 0:
  [F]irst paragraph.↵
  ↵                            ← blank line, displayed as empty row
  Second paragraph.

Frame 1 — user types `First paragraph.`:
  ✓F✓i✓r✓s✓t✓ ✓p✓a✓r✓a✓g✓r✓a✓p✓h✓.↵
  ↵
  Second paragraph.
  → Cursor is logically "after the '.'". The Enter behavior applies.

Frame 2 — user presses Enter:
  ✓F✓i✓r✓s✓t✓ ✓p✓a✓r✓a✓g✓r✓a✓p✓h✓.↵
  ↵
  [S]econd paragraph.
  → Cursor jumped over the blank line directly to 'S'.
```

The blank line is in the rendered output (so paragraph shape is preserved) but not in `typeableIndices`.

---

## Indented code line, mid-line entry

**Tests:** combination of *render the structure, require the content* (whitespace auto-skip) and *errors stay local* on a code-like input.

Source:
```
def greet(name):
    return f"Hello, {name}"
```

```
Frame 0:
  [d]ef greet(name):↵
  ····return f"Hello, {name}"

Frame 1 — user types `def greet(name):` then Enter:
  ✓d✓e✓f✓ ✓g✓r✓e✓e✓t✓(✓n✓a✓m✓e✓)✓:↵
  ····[r]eturn f"Hello, {name}"
  → cursor skipped 4 spaces, landed on 'r'.

Frame 2 — user types `retunr` (typo: swapped 'n' and 'r'):
  ✓d✓e✓f✓ ✓g✓r✓e✓e✓t✓(✓n✓a✓m✓e✓)✓:↵
  ····✓r✓e✓t✓u✗r✗n[ ]f"Hello, {name}"
  → 2 red chars; cursor advanced to the space after.
  → Note: the visible red region is exactly 2 chars wide. It does not bleed into ' f"Hello...'.

Frame 3 — user presses backspace twice:
  ✓d✓e✓f✓ ✓g✓r✓e✓e✓t✓(✓n✓a✓m✓e✓)✓:↵
  ····✓r✓e✓t✓u[r]n f"Hello, {name}"
  → 'r' now under cursor; 'n' is back to untyped (red marks gone).

Frame 4 — user types `nr`:
  ✓d✓e✓f✓ ✓g✓r✓e✓e✓t✓(✓n✓a✓m✓e✓)✓:↵
  ····✓r✓e✓t✓u✓n✓r[ ]f"Hello, {name}"
  → all green again; 2 wrong keystrokes remain in the stats.
```

This is the everyday case: typo, backspace, fix, continue. No drama.

---

## Tabs in source

**Tests:** *render the structure, require the content* — tabs are rendered but not required as keystrokes (when they're structural, i.e., at the start of a line).

Source (the indentation here is a literal tab character, not spaces):
```
func foo() {
→   return "ok"
}
```
where `→   ` represents one tab character rendered as 4 columns of dim gray.

```
Frame 0:
  [f]unc foo() {↵
  →·  return "ok"↵
  }

Frame 1 — user types `func foo() {` then Enter:
  ✓f✓u✓n✓c✓ ✓f✓o✓o✓(✓)✓ ✓{↵
  →·  [r]eturn "ok"↵
  }
  → cursor jumped past the tab.
```

Open question: what about a tab *mid-line* (not structural)? E.g., `print("a"\t"b")`. Lean: still display-only, but flag it for the user somehow. Mid-line tabs are rare in well-formatted source.

---

## Backspace at the very start

**Tests:** edge case — backspace before any keystroke is a no-op.

```
Frame 0:
  [H]ello

Frame 1 — user presses backspace:
  [H]ello
  → no change. No error counted (backspace isn't a "wrong key").
```

---

## What these scenarios collectively prove

If the engine passes all eleven, we know:

- **The cursor only ever rests on a typeable index** — demonstrated by the *enter at proper end of line*, *blank line in source*, *indented code line*, and *tabs in source* scenarios.
- **Forward motion and backward motion are symmetric and cross line breaks** — demonstrated by *single wrong char, corrected with backspace* and *backspace across a line break*.
- **Errors stay local; no cascading red** — demonstrated by *wrong char left uncorrected*, *cluster of wrong chars*, and *indented code line*.
- **Enter mid-line is allowed, marks the rest red, and jumps** — *enter mid-line*.
- **Stats count keystrokes, not displayed-red chars** — *single wrong char, corrected with backspace* and *enter mid-line*.
- **Edge cases don't crash or behave surprisingly** — *blank line in source*, *tabs in source*, *backspace at the very start*.

When we write the engine, each of these scenarios should map almost 1:1 to a unit test feeding a sequence of `input(char)` / `enter()` / `backspace()` calls and asserting on the resulting state.

---

**See also:** [typing-feel.md](typing-feel.md) for the principles each scenario tests; [use-cases.md](use-cases.md) for the input-source side of the design.
