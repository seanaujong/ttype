# Rendering

This doc covers _what the user sees_. The engine is `{text, keystrokes, cursor}`; the renderer turns those into a frame on the terminal each tick. The renderer is allowed to be opinionated about presentation; the engine never is.

## At a glance

- **Layerable rendering** — a base renderer works for any text; source-kind-aware behavior (diff hunks, syntax highlight, markdown structure) is additive and lives outside the engine.
- **Semantic chunking** — the viewport is sized by the cursor's containing chunk (function body, paragraph, diff hunk), not by raw line count. Line-windowing is the floor, not the ceiling.
- **Line-window fallback** — when a chunk exceeds the viewport, render a cursor-centered line window _inside_ it. The fallback always works.
- **Cursor is always visible** — sticky-middle policy; the user never types past the bottom of the rendered output.
- **TUI rendering is "choose what to render", not "scroll to it"** — we control what bytes get written, not the terminal's scroll buffer.
- **Raw text in; chunkers detect structure** — composition with `cat`, `git diff`, etc. is preserved by keeping raw text as the primary input. Pre-formatting is a possible future power-user option, not the default.
- **Chunkers are their own module** — `source/chunker.ts` parallels `source/engine.ts`: pure function over text, no UI, no I/O, testable in isolation. The React component composes the two.

## Layerable rendering

A default renderer handles any text. Source-kind-aware features (diff hunk dimming, syntax coloring, markdown structure) are layers _on top of_ the default — additive, opt-in, outside the engine.

The discipline: the engine doesn't know what its input "is." A diff, a TypeScript file, and a paragraph of prose all flow through the same `applyEvent(state, event) → state`. If the engine ever needs to ask "is this a diff?", we've drifted. The rendering layer is where that question becomes legal — and even there, it's answered by _which renderer is plugged in_, not by branching inside one renderer.

A renderer plugged into the engine is a function `(state) → Frame`. A layer is a transformation `Frame → Frame`. They compose; the engine doesn't care. This is the load-bearing pattern that lets us add `--diff`, `--syntax`, etc., without ever editing engine code.

## Semantic chunking

A typing session over more text than the terminal can show needs a viewport. The naive shape — render the last _K_ lines, or render around the cursor by raw line count — is fine for prose but wrong for code, diffs, and structured input. We can do better.

**The principle:** the viewport should be sized by the cursor's _conceptual unit_, not by an arbitrary line count. The unit is whatever the input's structure suggests:

- For prose, a paragraph.
- For code, a function body or top-level declaration.
- For a diff, a hunk.
- For a commit message, the subject vs. the body.

When the cursor's chunk fits on screen, render the whole chunk. The user sees the unit they're working through, top to bottom. That's the right mental model — the same one editors and review tools use when they show "the function you're editing" or "the hunk you're reviewing."

### The Chunker abstraction

```ts
type Chunk = {
	start: number; // character offset (inclusive)
	end: number; // character offset (exclusive)
	label?: string; // optional — "function foo", "hunk 1", etc.
};

type Chunker = (text: string) => Chunk[];
```

The renderer:

- Knows the cursor index (from engine state).
- Calls a configured `Chunker` to get the chunk list at ingestion (or lazily, but at ingestion is fine).
- Finds the chunk containing the cursor.
- Renders that chunk, padding with neighbors if there's room.

Different input kinds get different chunkers, picked by the adapter (file extension, `--diff` flag, etc.). The renderer code doesn't change.

### Per-input chunkers

| Input          | Natural chunk                            | Easy split                                                   |
| -------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Prose / essay  | Paragraph                                | Blank line (`/\n\s*\n+/`)                                    |
| Source code    | Function / class / top-level declaration | Lines starting at column 0 (first pass); proper parser later |
| Diff           | Hunk                                     | Lines starting with `@@`                                     |
| Markdown       | Section under a heading                  | Heading regex                                                |
| Commit message | Subject vs. body                         | First blank line                                             |
| _Default_      | Paragraph                                | Blank line                                                   |

The **default chunker is blank-line based**. It handles prose well, code surprisingly well (well-formatted code has blank lines between functions), and is one line to implement. It's the floor we lean on until source-kind-aware chunkers earn their place.

### The "chunk too big" fallback

A 500-line function doesn't fit in a 30-row viewport. The fallback policy:

- **Window inside the chunk.** The chunk identifies which region the user is in; a cursor-centered line window scrolls within. Sticky-middle, like editor scrolloff.
- **Status indicator.** A single status row at the bottom shows "function foo, line 23 of 60" or similar — gives the user a sense of where they are in the larger structure.

Line-windowing is the floor: it always works. Chunking is the ceiling: better UX when chunks are reasonable sizes.

### Why not just pagination

Some tools pick "show one screen at a time, user advances explicitly." We don't, because:

- It introduces a mode switch that breaks typing rhythm.
- It requires the user to think about the rendering — anti the chill-not-strict typing principle.
- Continuous scrolling via semantic chunks is the experience editors already trained users to expect.

### Why not single-line / Monkeytype-style

A few sites show just the current line plus a sliver of context. This works for prose-only trainers where line breaks are meaningless. It's wrong for code (function structure invisible), diffs (hunk context lost), and long-form prose (paragraphs broken arbitrarily). The whole point of ttype is handling structured input gracefully; collapsing to one line throws away the structure.

## Cursor highlight

_(stub — fill in when implemented.)_

The next-to-type character gets an **inverse-video background**, not a thin caret. Carets get lost against monospaced text on dark themes; inverse video doesn't.

When the cursor is inside the viewport, the highlight is at its actual position. When the cursor would be off-screen — shouldn't happen given sticky-middle, but defensively — the renderer scrolls to bring it back.

## Status row

A single line at the bottom of the rendered frame, separate from the source text. Shows:

- Position within the document (line N of M, or "hunk 2 of 5").
- Elapsed time during the session.
- End-of-session stats (WPM, accuracy) — currently shown as a flat line in `app.tsx`; the status row is the natural home.

The status row is the only renderer surface allowed to know "session-meta" things like elapsed time. The engine produces it (`startedAt`, `endedAt`); the renderer presents it. No live timer state in components.

## Wrapped lines

When a single source line exceeds the terminal's column count, the terminal wraps it visually onto multiple screen rows. This breaks the assumption that one source line = one viewport row. Two ways forward:

- **Ignore it** — most input has reasonable line lengths; some rendering oddness at edges is tolerable for a first cut.
- **Account for it** — compute the wrapped-row count per source line; window by visible rows, not source lines.

The disciplined version is the second. The pragmatic first cut is the first. We pick later, when we have actual content that exhibits the problem.

## Module structure

```
┌──────────────────────────────────────────────────┐
│  cli.tsx                       (adapter)         │
│    file / stdin / TTY → text                     │
│    file ext / flags  → which Chunker to use      │
└──────────────────────────┬───────────────────────┘
                           │ text, chunker
                           ▼
┌──────────────────────────────────────────────────┐
│  app.tsx                       (React shell)     │
│    useReducer(reducer, initialState(text))       │
│    useInput((input, key) => dispatch(action))    │
│    useMemo(() => chunker(text), [text])          │
│    → composes engine state + chunks → JSX frame  │
└──────┬────────────────────┬──────────────────────┘
       │                    │
       ▼                    ▼
┌─────────────┐      ┌─────────────────┐
│ engine.ts   │      │ chunker.ts      │
│   (pure)    │      │   (pure)        │
│             │      │                 │
│ State       │      │ Chunk           │
│ Action      │      │ Chunker         │
│ initialState│      │ blankLineChunker│
│ reducer     │      │ (later: diff,   │
│ replay      │      │  code, md, …)   │
└─────────────┘      └─────────────────┘
```

Three pure modules (`engine.ts`, `chunker.ts`, and eventually a `render.ts` if the per-character layout math gets big enough to extract) and one React component (`app.tsx`) that composes them. The CLI adapter at the top glues input shape to the right combination.

Why this shape:

- **Each pure module passes the four-question extraction test**: separate concern, independently testable, multiple implementations, shrinks what's around it.
- **Engine and chunker mirror each other architecturally** — both are pure functions over data with replaceable implementations selectable at the boundary. Same testing approach (in-code unit tests + replay fixtures for the engine, in-code unit tests for the chunker).
- **The React component never imports Ink-foreign concepts** — it just composes engine state with chunker output and emits JSX. The hard "what should happen" decisions live in the pure modules below.
- **Adapters are the only place that knows about input kinds.** When a new kind shows up (`.diff`, `.md`, `--code`), the change is: add a chunker to `chunker.ts`, teach `selectChunker()` in `cli.tsx` how to pick it. Nothing else moves.

The discipline this protects: **structure detection (chunking) is separate from typing semantics (engine) is separate from terminal output (renderer in app.tsx).** Three concerns, three modules. Mixing any two would mean a bigger surface that's harder to test, refactor, and reason about.

## Engine implications

Nothing here changes the engine. The renderer reads from engine state; the engine doesn't know what's being rendered. Specifically:

- `Chunker` is a renderer-layer concern, not engine state.
- Per-character coloring still derives from `keystrokes[i] === text[i]`, computed at render time.
- The cursor index is still `keystrokes.length`. No `viewportStart` or `visibleRange` enters engine state.

If the renderer ever needs the engine to track something for it (e.g., "the renderer wants to know which lines are typed yet"), that's a signal we've blurred the boundary. Push the computation to the render side instead.

## Open questions

- **Dynamic viewport size**: read `process.stdout.rows` and react to resize via `SIGWINCH`? Worth doing once the static-size version is solid.
- **Scroll-off**: sticky-middle is the default; some editors prefer a few rows of look-ahead (cursor lands ~⅓ from the bottom). UX preference; pick after dogfooding.
- **Chunk boundary cursor**: what happens when the cursor is exactly at a chunk boundary — render the chunk before, or the chunk after, or both? Default: the chunk after, since the user is about to type into it.
- **Skipped whitespace**: when the typing path skips structural whitespace (leading indentation, blank lines), rendered chars vs. typeable chars diverge. Per-character coloring and cursor positioning need the right index. The renderer needs a typeable-index map handed in alongside the cursor — engine-side concern that surfaces here.
