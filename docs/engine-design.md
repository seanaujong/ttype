# Engine design — event-sourced and auditable

## The decision

The engine is a **pure state machine**: one function, `applyEvent(state, event) → state`, with no hidden inputs (no clocks, no globals, no I/O). A session is fully described by its source text + an event log; current state is *derived* from that log via a pure fold. Renderers and review are downstream consumers of the same log — they never reach into engine internals.

We picked this shape because it makes the engine **auditable, replayable, and trivially testable**:
- Auditable: anything that affects engine outcomes is in the event log, by construction. No "well it depends on what time it was" surprises.
- Replayable: a saved session (`{ text, events }`) re-applied produces the same state. Bug reports become files.
- Testable: the engine imports nothing UI-related. Tests are plain function calls feeding events; every scenario in [scenarios.md](scenarios.md) becomes a fixture.

The rest of this doc shows how the pattern works, why it's a natural fit for goals 1–2 in [../CLAUDE.md](../CLAUDE.md), and what we're borrowing from a famously rigorous case study of the same pattern: Pokémon Showdown's battle engine.

## What Pokémon Showdown teaches

Showdown's battle engine is unusually rigorous about a few things that map directly onto ttype:

1. **The engine is a pure state machine.** Same starting state + same sequence of events → identical result. No hidden inputs (no implicit clocks, no globals, no I/O). RNG is seeded so even randomness is reproducible.
2. **The log is canonical.** Every battle is fully described by its event log + initial seed. Replaying the log reproduces the battle exactly. The log isn't a derived artifact of the battle; it *is* the battle.
3. **Renderers consume events, not internal state.** Showdown's web client renders battles by interpreting the same event protocol the engine emits. The engine doesn't know HTML exists.
4. **Bug reports are replayable.** Because logs are canonical, a bug report is a log file. Maintainers reproduce locally by replaying.
5. **Test fixtures come from real runs.** Any interesting battle becomes a regression test by saving its log + seed and asserting on the endpoint.

This is the event-sourcing / Redux / Elm pattern. Showdown is a particularly clean case study because the correctness bar is non-negotiable.

## How it maps to ttype

We've been edging toward this — the "engine emits a keystroke log; review consumes it" framing in [review.md](review.md) is already in this direction. The Showdown lens pushes it one step further: **the keystroke log isn't a side-output of the engine. It is the engine's input, and current state is *derived* from it.**

### The whole engine API is one function

```ts
function applyEvent(state: State, event: Event): State
```

- **State** = `{ text, typeableIndices, cursor, charStates }`. No timestamps, no derived counters, no UI.
- **Event** = a tagged union: `{ kind: 'input', char, t } | { kind: 'backspace', t } | { kind: 'enter', t }`. Time is *in* the event; the engine never reads a clock.
- **Pure** — same `(state, event)` returns the same next state. No side effects.

A session is `{ text, events: Event[] }`. The current state is `events.reduce(applyEvent, initialState(text))`. That's the entire model.

### The log is the engine

Consumers don't reach into engine state to "find out what happened" — they read the log:

- **Renderer:** receives the latest state. Draws. Stateless w.r.t. typing logic.
- **Review:** receives the full event log + final state. Computes slow words, miskeys, etc. via a different fold.
- **Persistence:** serializes `{ text, events }` to disk. Reload = re-apply.
- **Tests:** feed a fixture's events into the engine, assert on the final state.

### Replay for free

A session file is `{ text, events }`. To replay any session:
1. Initialize state from `text`.
2. Fold `events` through `applyEvent`.

We can step backward (slice events, re-fold), jump to any frame, or scrub through the session. This is what enables "redrill the hard parts" later — it's not a separate feature, it's a consequence of being event-sourced.

### Scenarios become fixtures

Every scenario in [scenarios.md](scenarios.md) is a sequence of events with an expected end state. Each becomes a literal JSON fixture:

```json
{
  "name": "scenario-2-typo-corrected",
  "text": "Hello",
  "events": [
    { "kind": "input", "char": "H", "t": 0 },
    { "kind": "input", "char": "x", "t": 120 },
    { "kind": "backspace", "t": 240 },
    { "kind": "input", "char": "e", "t": 360 },
    { "kind": "input", "char": "l", "t": 480 },
    { "kind": "input", "char": "l", "t": 600 },
    { "kind": "input", "char": "o", "t": 720 }
  ],
  "expected": {
    "cursor": "done",
    "charStates": ["correct","correct","correct","correct","correct"],
    "keystrokeStats": { "correct": 6, "wrong": 1, "missed": 0 }
  }
}
```

Tests load the fixture, apply events, assert. New scenarios — including "this weird thing happened to a user" — slot in the same way.

## What this enables

- **Time-travel debugging.** "What did state look like at event 47?" → `events.slice(0, 47).reduce(applyEvent, initialState(text))`. Useful any time something looks wrong on screen.
- **Bug reports as files.** A user runs `ttype --record foo.json`, finishes a session, sends the file. We replay; we see exactly what they saw. No "can you reproduce" back-and-forth.
- **Review is just a second fold.** Once with `applyEvent` to get final state; once with a review-specific reducer to compute stats. Same input, different views.
- **Persistence is trivial.** Sessions are 100% described by `{ text, events }`. No engine internals leak into the saved file.
- **Engine tests don't need Ink.** The engine is a TS module that imports nothing UI-related. Tests are plain function calls.

## What this changes in our direction

Almost nothing — the framing is the only shift:

- The keystroke log stops being a *side output* of the engine and becomes its *primary input*. Consumers read events.
- Engine state is *derived* from events, not the other way around. (Internally we may cache the latest state; conceptually it's `fold(events)`.)
- The engine never reads a clock. Timestamps come in *with* events. Whoever creates the event (the input handler) reads the clock once, attaches `t`, hands it off.

Renderers, adapters, and review don't need to change — they already only consume what the engine produces.

## What we don't take from Showdown

- **Server-authoritative model.** ttype is single-user; no anti-cheat surface.
- **Textual protocol** (`|move|p1a:Pikachu|...`). TS event types are fine.
- **Speculative rollback / client prediction.** Not needed.
- **Battle-specific state abstractions.** The pattern, not the specifics.

## Why this is also worth *learning*

The event-sourced model is what React+Redux teaches, what Elm is built on, what databases use (write-ahead logs), what git uses (commits are events on a tree), and what every undo/redo system that doesn't suck looks like. Internalizing the pattern here means recognizing it everywhere else. We'll point out the parallels when we build.

## Adapter output shape (tentative — validate when we build adapters)

The cosmetic/typeable separation is the load-bearing idea that makes goal 4 (self-hosting on this repo's `.tsx`, docs, and diffs — see [../CLAUDE.md](../CLAUDE.md)) work. The shape sketched earlier in this doc (`typeableIndices: ReadonlyArray<number>`) is sufficient for "skip leading whitespace" but doesn't carry enough information for diff- or markdown-aware *rendering* (dim hunk headers, color `+`/`-` markers, etc.).

The natural generalization: adapters produce **spans**, not just typeable indices. Each span covers a contiguous byte range and tags it as either typeable or cosmetic-with-a-style.

```ts
type IngestedText = Readonly<{
  text: string;
  spans: ReadonlyArray<Span>;
}>;

type Span = Readonly<
  | { kind: 'typeable';  start: number; end: number }
  | { kind: 'cosmetic';  start: number; end: number; style?: CosmeticStyle }
>;

type CosmeticStyle = 'dim' | 'diff-header' | 'diff-add' | 'diff-remove' | 'markdown-marker';
```

Behavior:
- The **engine** consumes only the `typeable` spans. The cursor advances within a typeable span and jumps to the next typeable span at boundaries. `text` is the source of truth for what to display; spans describe where the cursor can land and what to style.
- **Renderers** consume *all* spans. Plain renderer: dims `cosmetic` spans, normal-styles `typeable`. Diff renderer: applies the styles. Same engine, different rendering layers — that's goal 2 (layerable rendering).
- **Adapters** are the cosmetic-aware layer. The file adapter might mark only leading whitespace as cosmetic. The stdin-from-`git-diff` adapter (or a `--diff` mode) marks `@@` hunk headers, `+`/`-`/` ` line prefixes, and `diff --git` headers as cosmetic, with appropriate styles.

This is a clean generalization of [typing-feel.md](typing-feel.md)'s Principle 2 from "render whitespace, don't require it" to **"render the structure, require typing of the content."** Whitespace skipping is just the simplest case.

### Why this is tentative

We haven't built any of this yet, and the shape might want refinement when we hit real inputs:

- **Spans vs. per-char tagging.** Spans are more compact than tagging every char, but if cosmetic/typeable interleave heavily (e.g., ANSI color codes mid-line), per-char tagging might be simpler. We'll know when we try the first adapter that does anything non-trivial.
- **Style enum vs. open string.** `CosmeticStyle` as a closed union is the [ts-conventions.md](ts-conventions.md)-correct call now, but renderers may want extensibility (e.g., syntax highlighting later). If the union grows past ~6 variants, reconsider.
- **Where does `IngestedText` live?** It's an adapter output, but the engine needs the typeable spans to compute the initial cursor and state. Probably: `makeInitialState(ingested: IngestedText): State`. The engine stores spans in state (or a derived `typeableIndices` cache); rendering reads them from state alongside `text`.
- **Boundary cases**: zero-length cosmetic spans, overlapping spans (should never happen but the type permits it — maybe non-overlap is a smart-constructor invariant), empty input.

### Validation plan

We treat the above as a hypothesis, not a spec. Concretely, validate it when we build:

1. The **file adapter** (Scenario 9 in [scenarios.md](scenarios.md) — indented code line). If marking leading whitespace as a `cosmetic` span feels clean, the shape is probably right. If we end up wanting "cosmetic but only as a leading run" as its own kind, the shape needs revising.
2. The **stdin diff adapter** / `--diff` mode (use case 4). Real `git show` output is the stress test. If we can describe a diff with spans of `cosmetic { style: 'diff-add' }` etc. and the renderer just consumes them, the design holds. If we find ourselves wanting the renderer to *also* know the input is a diff to do the right thing, the spans aren't carrying enough information.

If either of those validations fails, revisit this section. The dogfood commands from goal 4 are also the natural acceptance test.

## Open questions

- **Event granularity.** Is "type a char" one event or two (`keypress` + `process`)? Lean: one. The engine doesn't see raw keyboard events; it only sees the semantic event after the React-layer input handler classifies it.
- **Where does the input handler live?** Ink's `useInput` hook in the React layer. It produces events and feeds them to the engine. The engine never touches a `KeyboardEvent`.
- **Snapshotting for performance.** A 10,000-char session re-folds fast; for very long sessions we might cache state every N events. Defer until measured.
- **Time format.** Lean: milliseconds since session start (`t: number`). Smaller and sufficient.
- **Determinism of `text` ingestion.** The text the engine sees should be fully determined by the adapter + the raw input. We should serialize the *ingested* text in session files, not the raw source — otherwise a fixture's outcome could change when the adapter changes.

## See also

- [review.md](review.md) — review consumes the event log this doc describes.
- [scenarios.md](scenarios.md) — each scenario maps to a fixture in this model.
- [typing-feel.md](typing-feel.md) — the rules the engine encodes; this doc explains how.
