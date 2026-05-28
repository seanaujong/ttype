# Engine design — event-sourced and auditable

## The decision

The engine is a **pure state machine**: one function, `reducer(state, action) → state`, with no hidden inputs (no clocks, no globals, no I/O). A session is fully described by its source text + an event log; current state is _derived_ from that log via a pure fold. Renderers and review are downstream consumers of the same log — they never reach into engine internals.

We picked this shape because it makes the engine **auditable, replayable, and trivially testable**:

- Auditable: anything that affects engine outcomes is in the event log, by construction. No "well it depends on what time it was" surprises.
- Replayable: a saved session (`{ text, events }`) re-applied produces the same state. Bug reports become files.
- Testable: the engine imports nothing UI-related. Tests are plain function calls feeding events; every scenario in the codebase becomes a JSON fixture.

## What Pokémon Showdown teaches

Showdown's battle engine is unusually rigorous about a few things that map directly onto ttype:

1. **The engine is a pure state machine.** Same starting state + same sequence of events → identical result. No hidden inputs (no implicit clocks, no globals, no I/O). RNG is seeded so even randomness is reproducible.
2. **The log is canonical.** Every battle is fully described by its event log + initial seed. Replaying the log reproduces the battle exactly. The log isn't a derived artifact of the battle; it _is_ the battle.
3. **Renderers consume events, not internal state.** Showdown's web client renders battles by interpreting the same event protocol the engine emits. The engine doesn't know HTML exists.
4. **Bug reports are replayable.** Because logs are canonical, a bug report is a log file. Maintainers reproduce locally by replaying.
5. **Test fixtures come from real runs.** Any interesting battle becomes a regression test by saving its log + seed and asserting on the endpoint.

This is the event-sourcing / Redux / Elm pattern. Showdown is a particularly clean case study because the correctness bar is non-negotiable.

## How it maps to ttype

The keystroke log isn't a side-output of the engine. It is the engine's input, and current state is _derived_ from it.

### The whole engine API is one function

```ts
function reducer(state: State, action: Action): State;
```

- **State** = `{ text, typeableIndices, keystrokes, startedAt, endedAt, events }`. No UI, no derived counters. `typeableIndices` is a readonly array of source positions the cursor can rest on (leading whitespace, tabs, and blank lines are skipped); `keystrokes` is parallel to `typeableIndices`, containing what the user typed at each visited position. `events` is the retained action log — the canonical record a second fold (`source/review.ts`) replays for per-word stats; `keystrokes`/timing are its derived hot path. (`RESET` clears `events`; a restart is a fresh attempt.)
- **Action** = a discriminated union: `{ kind: 'TYPE_CHAR', char, at } | { kind: 'BACKSPACE' } | { kind: 'RESET' }`. Time is _in_ the action; the engine never reads a clock.
- **Pure** — same `(state, action)` returns the same next state. No side effects.

A session is `{ text, actions: Action[] }`. The current state is `actions.reduce(reducer, initialState(text))`. That's the entire model.

### The log is the engine

Consumers don't reach into engine state to "find out what happened" — they read the log:

- **Renderer:** receives the latest state. Draws. Stateless w.r.t. typing logic.
- **Review:** receives the full event log + final state. Computes slow chars, miskeys, etc. via a different fold.
- **Persistence:** serializes `{ text, actions }` to disk. Reload = re-apply.
- **Tests:** feed a fixture's actions into the engine, assert on the final state.

### Replay for free

A session file is `{ text, actions }`. To replay any session:

1. Initialize state from `text`.
2. Fold `actions` through `reducer`.

We can step backward (slice events, re-fold), jump to any frame, or scrub through the session. This is what enables "redrill the hard parts" later — it's not a separate feature, it's a consequence of being event-sourced.

### Scenarios become fixtures

Every behavioral scenario is a sequence of actions with an expected end state. Each becomes a literal JSON fixture loaded by a generic runner:

```json
{
	"name": "typing 'hello' correctly",
	"text": "hello",
	"events": [
		{"kind": "TYPE_CHAR", "char": "h", "at": 1000},
		{"kind": "TYPE_CHAR", "char": "e", "at": 1100},
		{"kind": "TYPE_CHAR", "char": "l", "at": 1200},
		{"kind": "TYPE_CHAR", "char": "l", "at": 1300},
		{"kind": "TYPE_CHAR", "char": "o", "at": 1400}
	],
	"expected": {
		"keystrokes": ["h", "e", "l", "l", "o"],
		"startedAt": 1000,
		"endedAt": 1400
	}
}
```

The fixture runner scans the fixture directory, registers one ava test per JSON file, and asserts each declared field of `expected` against the folded result. New scenarios — including "this weird thing happened to a user" — slot in by dropping a JSON file. No test code changes.

## What this enables

- **Time-travel debugging.** "What did state look like at action 47?" → `actions.slice(0, 47).reduce(reducer, initialState(text))`. Useful any time something looks wrong on screen.
- **Bug reports as files.** A user runs `ttype --record foo.json`, finishes a session, sends the file. We replay; we see exactly what they saw. No "can you reproduce" back-and-forth.
- **Review is just a second fold.** Once with `reducer` to get final state; once with a review-specific fold to compute stats. Same input, different views. Built: `source/review.ts`'s `analyzeByWord(text, typeableIndices, events)` folds `state.events` into per-word timing and accuracy for the end-of-run results.
- **Persistence is trivial.** Sessions are 100% described by `{ text, actions }`. No engine internals leak into the saved file.
- **Engine tests don't need Ink.** The engine is a TS module that imports nothing UI-related. Tests are plain function calls.
- **Cloze validated the design.** The active-recall re-drill (fill in the fumbled words) required zero engine changes. It works by re-scoping `typeableIndices` to the fumbled positions — the selection (`clozeBlanks` in `review.ts`) and the re-scope happen upstream; the engine receives a smaller typeable set and folds keystrokes identically. "What counts as one unit," "what's typeable," and "what's blanked" all live upstream of the engine. If any of those had leaked into the fold, cloze would have forced an engine change. The fact that it didn't is the event-sourced design working as intended.

## What we don't take from Showdown

- **Server-authoritative model.** ttype is single-user; no anti-cheat surface.
- **Textual protocol** (`|move|p1a:Pikachu|...`). TS action types are fine.
- **Speculative rollback / client prediction.** Not needed.
- **Battle-specific state abstractions.** The pattern, not the specifics.

## Why this is also worth _learning_

The event-sourced model is what React+Redux teaches, what Elm is built on, what databases use (write-ahead logs), what git uses (commits are events on a tree), and what every undo/redo system that doesn't suck looks like. Internalizing the pattern here means recognizing it everywhere else.

## Adapter output shape

The cosmetic / typeable separation is the load-bearing idea that makes the self-hosting goal (typing through this repo's `.tsx`, docs, and diffs) work. The current implementation is the simplest possible version: a flat `typeableIndices: readonly number[]` produced at ingestion time, encoding the positions the cursor can rest on.

```ts
function initialState(text: string): State {
	return {
		text,
		typeableIndices: computeTypeableIndices(text),
		keystrokes: [],
		startedAt: undefined,
		endedAt: undefined,
	};
}
```

`computeTypeableIndices` applies a sequence of skip rules (leading whitespace, blank lines, mid-line tabs). Adding a rule is a localized edit to that function; the engine reducer doesn't change.

### Possible future generalization — spans

If diff- or markdown-aware _rendering_ (dim hunk headers, color `+`/`-` markers, etc.) wants to know more than "is this position typeable?", the natural generalization is **spans**: contiguous byte ranges tagged with kind and optional style. Each span covers a region of the text and tags it.

```ts
type Span = Readonly<
	| {kind: 'typeable'; start: number; end: number}
	| {kind: 'cosmetic'; start: number; end: number; style?: CosmeticStyle}
>;
```

The engine would still consume only the typeable spans (deriving `typeableIndices`); the renderer would consume all spans and apply per-kind decoration. This is a clean generalization of the same "render the structure, require the content" principle — whitespace skipping is the simplest case, diff markers and markdown structure would be additional cases.

We haven't built this yet. The current `typeableIndices` array is sufficient for the skip rules we've implemented; spans become motivated when the renderer wants per-region styling beyond "dim non-typeable chars."

### Validation plan

Treat the above as a hypothesis, not a spec. Concretely, validate it when we build:

1. The first **diff-aware rendering decoration** (color `+`/`-` lines, dim `@@` hunk headers). If marking each as a `cosmetic` span with the right style feels clean, the shape is probably right. If we end up wanting the renderer to also know the input is a diff to do the right thing, spans aren't carrying enough information.
2. The first **markdown chunker with embedded code blocks**. Real markdown with `# headings`, prose paragraphs, and fenced `ts` blocks is the stress test. If we can describe each kind cleanly as a chunk + spans, the design holds.

If either fails, revisit this section.

## Open questions

- **Action granularity.** Is "type a char" one action or two (`keypress` + `process`)? Lean: one. The engine doesn't see raw keyboard events; it only sees the semantic action after the React-layer input handler classifies it.
- **Where does the input handler live?** Ink's `useInput` hook in the React layer. It produces actions and feeds them to the engine via `dispatch`. The engine never touches a `KeyboardEvent`.
- **Snapshotting for performance.** A 10,000-char session re-folds fast; for very long sessions we might cache state every N actions. Defer until measured.
- **Time format.** Milliseconds since epoch (`at: number`, captured via `Date.now()` at the dispatch site). Smaller "milliseconds since session start" would also work and serialize more compactly.
- **Determinism of `text` ingestion.** The text the engine sees should be fully determined by the adapter + the raw input. We serialize the _ingested_ text in session files, not the raw source — otherwise a fixture's outcome could change when the adapter changes.
