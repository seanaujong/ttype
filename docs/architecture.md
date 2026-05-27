# Architecture

A high-level map of how ttype's layers fit together. This doc complements the per-layer design docs by showing the picture all at once.

## At a glance

- **Four layers, top to bottom**: CLI adapter → React shell → pure modules (engine, chunker) → terminal output.
- **Data flows down, no upward references**: lower layers don't know about layers above them. Each pure module imports nothing from the layers that use it.
- **The engine knows nothing about rendering**: it consumes typeable indices and keystroke actions, produces state.
- **The chunker knows nothing about typing**: it classifies bytes into structural regions; whether and how those regions are typed is consumer's choice.
- **Composition lives in `app.tsx`**: the React shell wires pure modules together via hooks. It's the only place that knows about all the layers.

## The diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│  cli.tsx                                       (adapter / orchestrator) │
│                                                                         │
│  argv  ─▶  meow.input[0]  ─▶  resolveSourceText  ─▶  text               │
│  argv  ─▶  meow.flags     ─▶  selectChunker      ─▶  chunker            │
│  env   ─▶  process.stdout.rows                   ─▶  viewportLineBudget │
│                                                                         │
│             <App text={text} chunker={chunker} viewportLineBudget={…}/> │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ props
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  app.tsx                                          (React composition)   │
│                                                                         │
│  ── Setup (memoized; runs on mount and when deps change) ──             │
│                                                                         │
│   text ──────────────────┐                                              │
│                          ├──▶ chunker(text)  ──▶  chunks                │
│   chunker ───────────────┘                          │                   │
│                                                     ▼                   │
│   text  ──────────────────▶  computeTypeableIndices(text, chunks)       │
│                                              │                          │
│                                              ▼                          │
│                                  typeableIndices                        │
│                                              │                          │
│                                              ▼                          │
│   useReducer(reducer, init=() => initialState(text, typeableIndices))  │
│                                              │                          │
│                                              ▼                          │
│                                       [state, dispatch]                 │
│                                                                         │
│  ── Per-render derived state (4 custom hooks) ──                        │
│                                                                         │
│   useLineLayout(text)        ──▶  lineRows, lineForPos                  │
│   useChunkViewport({chunks, focusPos, lineRows, lineForPos, ...})       │
│                              ──▶  focusedChunk, chunkStartLine, etc.    │
│   useCharacterStyling({...}) ──▶  colorFor, isCursor                    │
│   useStats({...})            ──▶  progress, liveWpm, accuracy, chunkPos │
│                                                                         │
│  ── Side effects + render ──                                            │
│                                                                         │
│   useInput((input, key) => dispatch({...}))                             │
│   return <Box>...</Box>                                                 │
└─────────────────┬────────────────────────────────┬─────────────────────┘
                  │                                │
                  ▼                                ▼
┌─────────────────────────────┐    ┌─────────────────────────────────────┐
│  engine.ts          (pure)  │    │  chunker.ts                 (pure)  │
│                             │    │                                     │
│  type State / Action        │    │  type Chunk / Span / ChunkKind      │
│  reducer(state, action)     │    │  blankLineChunker / diffChunker     │
│  initialState(text, tI)     │    │  computeTypeableIndices(text, ch)   │
│  replay(text, events, tI)   │    │                                     │
└─────────────────────────────┘    └─────────────────────────────────────┘
```

## How each layer separates

**`cli.tsx`** is the only file that touches the environment: file paths, stdin, terminal size, command-line flags. It produces three values (text, chunker, viewport budget) and hands them to `<App />`. If you ran ttype in a non-CLI context (e.g., a web demo), only this file would need a sibling.

**`app.tsx`** composes pure modules. It knows about all the layers but doesn't _contain_ their logic — it imports `engine.ts` and `chunker.ts`, calls their functions, threads state through React hooks. The four custom hooks (`useLineLayout`, `useChunkViewport`, `useCharacterStyling`, `useStats`) bundle related derivations to keep `App` itself a short composition.

**`engine.ts`** is a pure state machine. Inputs: text + typeable indices + an action. Output: new state. No imports, no I/O, no React, no rendering. Testable by feeding actions and asserting on returned state.

**`chunker.ts`** classifies text into structural regions. It owns:

- `Chunk[]` — high-level boundaries (paragraphs, hunks, etc.) used by the renderer for viewport policy.
- `Span[]` within each chunk — fine-grained ranges marking cosmetic characters (the `+`/`-` prefix of a diff line, hunk headers, etc.).
- `computeTypeableIndices(text, chunks)` — applies engine-global skip rules (leading whitespace, blank lines, mid-line tabs) **and** subtracts chunk-provided cosmetic spans. Returns the positions the engine cursor can rest on.

The chunker is pure: text-in, data-out. No I/O, no React.

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

## When the diagram changes

This doc is current as of the spans / cosmetic-region refactor. Things that would update the diagram:

- **Adding a third pure module** (e.g., `review.ts` for post-session analysis) — the bottom layer grows from two boxes to three.
- **Hooks moving out of `app.tsx`** to `source/hooks/`-style files — the middle layer gains an explicit sublayer.
- **Plugin architecture** (e.g., user-supplied chunkers) — adds a registration surface around `chunker.ts`.

If the actual code stops matching the diagram, **update the diagram first**, then make the code match. The architecture is the contract; the code is the implementation.
