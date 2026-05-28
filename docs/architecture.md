# Architecture

A high-level map of how ttype's layers fit together. This doc complements the per-layer design docs by showing the picture all at once.

## At a glance

- **Two halves**: a _structure_ (what may depend on what) and the _invariants_ that structure exists to protect. The diagram below is the structure; the layer contracts and the enforcement table are the invariants. Structure without invariants is arbitrary; invariants without structure are unenforceable.
- **Four layers, top to bottom**: CLI adapter → React shell → pure modules (engine, chunker, layout, grapheme, review, viewport) → terminal output.
- **Data flows down, no upward references**: lower layers don't know about layers above them. Each pure module imports nothing from the layers that use it.
- **The engine knows nothing about rendering**: it consumes typeable indices and keystroke actions, produces state.
- **The chunker knows nothing about typing**: it classifies bytes into structural regions; whether and how those regions are typed is consumer's choice.
- **Composition lives in `app.tsx`**: the React shell wires pure modules together via hooks. It's the only place that knows about all the layers.

## The diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ cli.tsx                                            (adapter / orchestrator)  │
│                                                                              │
│ argv  ─▶  meow.input[0]  ─▶  resolveSourceText  ─▶  text                     │
│ argv  ─▶  meow.flags     ─▶  selectChunker      ─▶  chunker                  │
│ argv  ─▶  meow.flags.split                      ─▶  isSplit                  │
│ (terminal size is read live in app.tsx, not passed as props)                 │
│                                                                              │
│     <App text chunker isSplit />                                             │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ props
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ app.tsx                                                 (React composition)  │
│                                                                              │
│ ── App: scope shell — owns which chunk the run starts on ──                  │
│ chunker(text) ──▶ chunks   ·   computeTypeableIndices ──▶ all idx            │
│ useState ──▶ startChunkIdx   ·   typeableIndicesFromChunk ──▶ scope          │
│ <Racer key={startChunkIdx} …/>  — key change ⇒ remount ⇒ reset               │
│      │  scoped typeable indices                                              │
│      ▼                                                                       │
│ ── Racer: one typing session ──                                              │
│ useTerminalSize() ──▶ live rows/cols ──▶ frameBudget ──▶ budget              │
│ useReducer(reducer) ──▶ state { text, keystrokes, events, timing }           │
│ useLineLayout · useChunkViewport · useCharacterStyling · useStats            │
│ useInput ─▶ Tab→skip · Backspace · Esc→reset · char→TYPE_CHAR                │
│ state.endedAt ? results panel (review.ts) : unified / split view             │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ imports
                                        ▼
───────────── pure modules — no Ink · no React · no upward imports ─────────────
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ engine.ts      (pure)│    │ chunker.ts     (pure)│    │ layout.ts      (pure)│
│                      │    │                      │    │                      │
│ State / Action       │    │ Chunk/Span/kinds     │    │ measureLine          │
│ reducer              │    │ blankLine/diff/md    │    │ cellWindow           │
│ initialState         │    │ computeTypeableIdx   │    │ visibleLineWindow    │
│ replay               │    │ typeableIdxFromChunk │    │ horizontalOffset     │
│ matchesExpected      │    │                      │    │ splitDiffRows        │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘

┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ grapheme.ts    (pure)│    │ review.ts      (pure)│    │ viewport.ts    (pure)│
│                      │    │                      │    │                      │
│ segmentGraphemes     │    │ analyzeByWord        │    │ frameBudget          │
│ clusterAt            │    │ slowestWords         │    │ frameFits            │
│                      │    │ mostMistypedWords    │    │ frameViolations      │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
```

## How each layer separates

**`cli.tsx`** is the only file that touches the environment: file paths, stdin, terminal size, command-line flags. It resolves those into `<App />`'s props — the text, the chunker, and the split flag (the terminal size is read live inside `app.tsx` via `useTerminalSize`, not passed as a prop) — and hands them over. If you ran ttype in a non-CLI context (e.g., a web demo), only this file would need a sibling.

**`app.tsx`** composes pure modules. It knows about all the layers but doesn't _contain_ their logic — it imports the pure modules (`engine`, `chunker`, `layout`, `grapheme`, `review`, `viewport`), calls their functions, threads state through React hooks. It splits into two components: **`App`** is a thin scope shell — it owns `startChunkIdx` (which chunk the run starts on) and re-scopes the typeable indices when `Tab`/`Shift+Tab` move it. **`Racer`** is one typing session over that scope: the engine fold plus the four custom hooks (`useLineLayout`, `useChunkViewport`, `useCharacterStyling`, `useStats`) that bundle related derivations to keep the component a short composition. Skipping a chunk changes `Racer`'s `key`, which remounts it — that remount _is_ the run reset, so the engine itself needs no "rescope" action.

**`engine.ts`** is a pure state machine. Inputs: text + typeable indices + an action. Output: new state. No imports, no I/O, no React, no rendering. Testable by feeding actions and asserting on returned state.

**`chunker.ts`** classifies text into structural regions. It owns:

- `Chunk[]` — high-level boundaries (paragraphs, hunks, etc.) used by the renderer for viewport policy.
- `Span[]` within each chunk — fine-grained ranges marking cosmetic characters (the `+`/`-` prefix of a diff line, hunk headers, etc.).
- `computeTypeableIndices(text, chunks)` — applies engine-global skip rules (leading whitespace, blank lines, mid-line tabs) **and** subtracts chunk-provided cosmetic spans. Returns the positions the engine cursor can rest on.

The chunker is pure: text-in, data-out. No I/O, no React.

## Layer contracts (guarantees / assumes)

"How each layer separates" says what each layer _owns_. This says what you can _rely on_ and what you must _preserve_ when you change it — the invariants the structure above exists to keep cheap. The rule when a change touches a layer: **honor its assumptions, preserve its guarantees, and fix bugs in the layer that _owns_ the invariant — not the layer that merely surfaces it.**

| Layer               | Guarantees                                                                                                                                                                  | Assumes                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `cli.tsx` (adapter) | The only code that touches the environment (I/O, argv, terminal size).                                                                                                      | Its normalizations preserve the typeable contract — it may re-encode transport, never change _what counts as typed_. |
| `app.tsx` (shell)   | The frame fits the terminal (≤ rows; every row < cols); display transforms (tab→space, truncation, scroll) never change the typeable set.                                   | `text` and `typeableIndices` from below are authoritative.                                                           |
| `engine.ts`         | State is a pure, replayable function of `(text, typeableIndices, events)` — no hidden inputs (clock, global, env); never mutates.                                           | `typeableIndices` is a valid, ascending subset of text positions.                                                    |
| `chunker.ts`        | The typeable set excludes everything you shouldn't type — diff markers, line indentation, leading whitespace, cosmetic spans.                                               | Nothing about how its output is rendered or folded.                                                                  |
| `layout.ts`         | Pure geometry (`splitDiffRows`, `visibleLineWindow`, `horizontalOffset`) — no Ink, no engine; unit-testable in isolation.                                                   | Its inputs are already classified/measured by the caller.                                                            |
| `viewport.ts`       | Owns "frame fits the terminal": `frameBudget` reserves the last row and column; `frameFits` / `frameViolations` are the invariant as a predicate. Pure (string-width only). | Its caller feeds it the live terminal size.                                                                          |

## Data flow during typing

After mount, `state` updates one keystroke at a time:

```
keystroke (Ink) ──▶ useInput callback ──▶ dispatch({kind, …}) ──▶ reducer
                                                                   │
                                                                   ▼
                                                              new state
                                                                   │
                       ┌───────────────────────────────────────────┘
                       │
                       ▼
       (4 hooks recompute derived view data — lineRows is cached,
        chunk viewport recomputes per render, character styling and
        stats are cheap derivations from state)
                       │
                       ▼
                   render JSX
                       │
                       ▼
                  terminal frame
```

Note what's _not_ in this loop: the engine doesn't know about Ink, the chunker doesn't recompute (chunks are memoized to `text`/`chunker` change only), and `text` is constant for the session. The fast path through `state → derivations → render` is the only thing per-keystroke.

## How to extend each layer

- **New chunker** (e.g., markdown, code-aware): add an exported `Chunker` in `chunker.ts`. Update `selectChunker` in `cli.tsx` to pick it. Renderer and engine unchanged.
- **New skip rule** (e.g., "skip URL prefixes"): edit `computeBaseTypeableIndices` in `chunker.ts`. Engine unchanged; renderer unchanged.
- **New decoration kind** (e.g., syntax highlighting on code blocks): extend `SpanKind`, have the relevant chunker emit spans with that kind, add a renderer mapping (`SpanKind → visual`). When this gets to two or more, extract a decorator registry per `docs/rendering.md`.
- **New action** (e.g., `SKIP_LINE`): add to the `Action` union in `engine.ts`, handle in the reducer's switch, dispatch from `useInput`. The `satisfies never` exhaustiveness check will catch missed cases.
- **New side-channel** (e.g., session recording): a new module that reads engine state via the existing reducer/replay surface. No engine changes; the engine already exposes everything needed.
- **New active-recall pass** (cloze re-drill): select the fumbled positions via `clozeBlanks` in `review.ts`, re-scope `typeableIndices` to that list, remount `Racer` with `isClozeRun` set to render blanks as `▁`. The engine fold is untouched — cloze is a selection in the review layer + a `typeableIndices` re-scope + a render flag. The same "re-scope + remount" move chunk-skipping already uses.

## The discipline that makes this work

Three rules, in priority order:

1. **No upward imports.** `engine.ts` and `chunker.ts` don't import from `app.tsx`. `app.tsx` doesn't import from `cli.tsx`. Composition flows from the top.
2. **Pure functions over data.** The reducer is pure. Chunkers are pure. `computeTypeableIndices` is pure. Side effects live in React (`useInput`, `useReducer`'s dispatch, render) and the CLI adapter (I/O). The boundary is visible in the import graph: only `app.tsx` and `cli.tsx` import React or Node modules.
3. **Cohesion clusters become hooks.** When `App` accumulated >50 lines of related derivations, those derivations got grouped into custom hooks. The function body became composition. Same discipline scales further as the project grows: when a hook accumulates its own related derivations, extract a sub-hook.

If a refactor proposal would break any of those rules, it's the proposal that's wrong, not the rules.

## Canonical text vs. display

There are two notions of "the text," usually the same string, and the architecture keeps them that way on purpose:

- **Text-as-typed** — the engine's source of truth. `computeTypeableIndices(text, chunks)` derives what you type from it; the fold replays over it.
- **Text-as-displayed** — what the renderer draws.

The renderer may transform text _for display_ — collapsing a tab to a space, truncating a long line, scrolling it horizontally — but it must **never feed a transformed text back into the engine or `computeTypeableIndices`.** The canonical `text` is what you type; display is a read-only view of it.

We learned this the hard way. Expanding tabs → spaces _at the input boundary_, to make rendering width predictable, looked like a clean adapter normalization — but it changed the engine's input. In a diff the indentation sits _after_ the `+`/`-` marker, so it isn't "leading" whitespace; only the mid-line-tab skip was keeping it out of the typeable set. Expanding to spaces made all of it typeable — you'd be typing the indentation. The fix was to move the tab→space swap into the renderer (display-only) and leave `computeTypeableIndices` untouched.

The tell that this boundary is being crossed: **a "display" change that moves the typeable-index count.** `computeTypeableIndices(text).length` is a cheap oracle — if a rendering tweak changes it, the tweak is in the wrong layer. (A regression test guards the specific case: a diff's indentation is never typeable, tab- or space-indented.)

## Which invariants are enforced, and how

An invariant is only as good as what holds it. Strongest is a type the compiler checks; next, a test; prose is the last resort — for invariants types can't express. Rule of thumb: **write an invariant in prose only if it's load-bearing _and_ not enforceable by a type or test.** If a type enforces it, the type _is_ the documentation; delete the prose.

| Invariant                                                                | Held by                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine never mutates                                                     | type — `Readonly<…>`                                                                                                                                                                                         |
| Every `SpanKind` has a visual                                            | type — exhaustive `Record<SpanKind, SpanVisual>` (already caught a miss at compile time)                                                                                                                     |
| Every union `switch` is total                                            | type — `satisfies never`                                                                                                                                                                                     |
| Engine is a pure, replayable fold                                        | test — JSON fixtures replayed through the `reducer` (`replay`); also guarded by `cloze-render.test.ts` (cloze required zero engine change, confirming the fold is cleanly separable from selection + render) |
| Typeable set excludes non-typed chars (markers, indentation, leading ws) | test — `chunker.test.ts`                                                                                                                                                                                     |
| Display transforms don't change the typeable set                         | prose + oracle — `computeTypeableIndices(text).length` is invariant under a render change (types can't see it: both sides are `string`)                                                                      |
| Frame fits the terminal                                                  | test — `frameFits` over real emitted frames (tall chunk, wide line, `--split`, narrow footer); owned by `viewport.ts`                                                                                        |
| Spans don't overlap                                                      | tolerated — "last write wins"; not enforced                                                                                                                                                                  |

One soft spot remains, named honestly: **span overlap** is tolerated rather than enforced ("last write wins"). **"Frame fits the terminal"** used to be the other — load-bearing (overflow makes the terminal scroll/wrap and Ink repaint the whole frame, a flicker / cursor "trail") but verified only by ad-hoc scripts. It now has an owner and a guard: `viewport.ts` (`frameBudget` reserves the last row and column; `frameFits` / `frameViolations` are the invariant as a predicate), and `viewport.test.ts` asserts real emitted frames stay within the terminal across the hard cases. A geometry-invariant test, not the brittle content snapshot the project rejected. Span overlap is now the lone candidate for future hardening.

## When the diagram changes

The diagram is current as of the six pure modules (engine, chunker, layout, grapheme, review, viewport), the `App`/`Racer` split, and the live-`useTerminalSize` size. Things that move it next:

- **Adding a pure module** (e.g., `review.ts` for post-session analysis) — the bottom layer grows another box, as `layout.ts` already did.
- **Hooks moving out of `app.tsx`** to `source/hooks/`-style files — the middle layer gains an explicit sublayer.
- **Plugin architecture** (e.g., user-supplied chunkers) — adds a registration surface around `chunker.ts`.

If the actual code stops matching the diagram, **update the diagram first**, then make the code match. The architecture is the contract; the code is the implementation.
