# Review — what happens after the run

## The reframe

Other type racers end with a **score**: WPM, accuracy, rank. Those numbers serve competitive ranking. That isn't the goal here. Sean's goals are:

- Internalize content (essays, source files, PRs) by typing it.
- Notice and improve typing habits over time.
- Stay chill — see [typing-feel.md](typing-feel.md).

A score doesn't directly serve any of those. So the post-run surface should be a **review**, not a scoreboard. We still *measure* — we just frame the measurements as feedback for next time, not as a number to chase.

This doc captures the direction, not the final spec. Concrete UI is deferred until the engine exists.

## Architectural split: engine emits log, review consumes it

The engine produces a **keystroke log**. Every key event:

- timestamp (or delta-since-previous-event)
- key pressed
- target char at the cursor index when the key was pressed
- engine action: `insert` / `backspace` / `enter` / `noop`
- outcome: `correct` / `wrong` / `auto-missed` (the auto-marked-red chars from Scenario 6) / `correction` (a backspace that cleared a wrong char) / `revisit` (a backspace that cleared a correct char)

That log is the single source of truth. The engine itself does not compute WPM, accuracy, "slow words," or anything else derived. It just runs the state machine and appends to the log.

Review is then a **separate consumer** of the log:

- It can run inline at end-of-run (the default UI).
- It could run later from a saved log (`ttype review <session>`) — future.
- It could roll up across runs to surface habits (`ttype habits`) — future.
- It can be replaced or skipped entirely without touching the engine.

This matches CLAUDE.md goal 1 (engine stays general) and lets us ship the engine + a minimal review, then evolve review independently.

## What review could surface

Two threads, both downstream of the log:

### Thread A — content reflection

The premise: typing a piece of text engages with it more deeply than reading. Review helps you notice *what* you engaged with.

Candidate surfaces:
- **Slow words.** "You paused longest on: `idempotent`, `mutex`, `coroutine`." Slow words are often unfamiliar words; typing speed becomes a low-effort signal for "what was new to you."
- **Mistyped words.** Words you got wrong on the first attempt. Sometimes a typing habit, sometimes "I don't actually know how to spell this term."
- **Sentences you spent the most time on.** Re-skim them. Effectively your own highlights.
- **For code:** hesitation around specific identifiers / symbols. "You paused on `useMemo` three times" → maybe a signal to go read about it.

The bar here is *gentle nudges toward learning*, not analytics.

### Thread B — typing habits

The premise: a low-key way to notice patterns in how you type.

Candidate surfaces:
- **Frequent miskeys.** "You typed `r` when you meant `e` — 7 times." Probably "your right hand drifts" or "those keys are adjacent."
- **Slowest keys.** Per-character timing ranked. Often correlates with shifted/punctuation keys.
- **Backspace bursts.** Long backspaces usually follow a misread of the source line. Worth surfacing as a pattern.
- **Cross-session aggregation.** Same surfaces over the last N runs. Requires log persistence (see below).

## What review explicitly is *not* (in v1)

- **Not a competitive score.** No leaderboard, no rank, no "hero WPM number."
- **Not LLM-graded comprehension.** A real "did you understand this" feature is a different product; don't blur it.
- **Not a dashboard.** A short, focused review surface — not metrics-and-charts.
- **Not always on.** Press `q` after a run to skip review entirely.

## Complexity read

Treating engine + keystroke log as foundation:

| piece | difficulty | why |
| --- | --- | --- |
| Engine emits log | trivial | Append on every keystroke. Engine already needs internal state for the typing rules. |
| Basic measurements (correct, wrong, missed, time) | trivial | Pure functions over the log. |
| Inline review screen (slow words, mistyped words, time) | small | Computation over the log + a single Ink view. |
| Log persistence (one JSON file per run) | small | Write on completion. |
| Cross-session habit detection | small | Read all logs, count and rank. No clever stats. |
| Polished review UX (navigation, "redrill the hard parts" flow) | medium | This is where scope can creep. Scope discipline matters here. |

Net: the foundation is not hard. The risk is scope creep on review; we'll bound it explicitly.

## A minimum-viable review for v1

Three things, max:

1. **Elapsed time** — `done in 1m 42s`.
2. **Slowest 3 spans** — short snippets of the source where you paused most. (Words for prose; tokens for code.)
3. **Corrected vs. uncorrected** — `you fixed 7 typos; 2 remain` (the latter being uncorrected red chars at run end). Includes auto-missed chars in its own line: `8 chars skipped via mid-line Enter`.

No WPM. No accuracy percentage. The user can press a key to expand any of the three into a more detailed view (deferred — start with the three lines).

## Open questions

- **Do we show *anything* during the run** — a timer, a progress bar — or is the screen purely text + cursor? Lean: nothing during the run. Review is the surface for measurement.
- **Default end state** — review screen, or silent exit? Lean: review screen, but `q` exits immediately at any point.
- **Log persistence default** — opt-in or opt-out? Lean: opt-in (some users won't want a `~/.ttype/` dir). Cross-session features are explicit about needing it.
- **"Slow word" definition** — what's slow? Top 3 by total typing time? Top 3 by max inter-keystroke gap? Probably "median key delay across the word, ranked." But this is tuning, not architecture.

## See also

- [typing-feel.md](typing-feel.md) — the principles. WPM/accuracy mentions there now refer to *internal engine measurements that feed review*, not user-facing scores.
- [scenarios.md](scenarios.md) — every scenario implicitly demonstrates entries in the keystroke log this doc consumes.
- [use-cases.md](use-cases.md) — case 1's end-of-run mock will be updated to the review-style summary above, not a WPM score.
