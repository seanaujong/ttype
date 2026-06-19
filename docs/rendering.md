# Rendering

This doc covers _what the user sees_. The engine state is `{text, typeableIndices, keystrokes, events, …}` and the cursor is derived as `keystrokes.length` rather than stored; the renderer turns those into a frame on the terminal each tick. The renderer is allowed to be opinionated about presentation; the engine never is.

## At a glance

- **Layerable rendering** — a base renderer works for any text; source-kind-aware behavior (diff hunks, syntax highlight, markdown structure) is additive and lives outside the engine.
- **Cloze masked render** — in an active-recall re-drill, untyped typeable positions render as `▁` and reveal green/red on type; surrounding non-blank text is dim context because `typeableIndices` was re-scoped to only the blanks. Pure render-layer behavior keyed on `isClozeRun`; engine untouched.
- **Collapsed whitespace** — a run of 2+ spaces is one keystroke (the chunker's base layer keeps only the run's first space typeable, the same spirit as the tab and leading-whitespace skips); the run renders as dim `·` middots so the skippable gap stays visible. The whitespace twin of the `↵` newline marker. A lone space is ordinary word spacing — untouched.
- **Bare URLs skipped** — a `http(s)://…` run is dropped from the typing path (a long opaque URL is tedious and rarely the point of a drill). It's a kind-agnostic base-layer skip, so it applies to prose, code, commits, and diffs alike — not a markdown span. The URL still renders (as ordinary non-typed gray); the cursor jumps past it.
- **Semantic chunking** — the viewport is sized by the cursor's containing chunk (function body, paragraph, diff hunk), not by raw line count. Line-windowing is the floor, not the ceiling.
- **Line-window fallback** — when a chunk exceeds the viewport, render a cursor-centered line window _inside_ it. The fallback always works.
- **Cursor is always visible** — sticky-middle policy; the user never types past the bottom of the rendered output.
- **TUI rendering is "choose what to render", not "scroll to it"** — we control what bytes get written, not the terminal's scroll buffer.
- **Raw text in; chunkers detect structure** — composition with `cat`, `git diff`, etc. is preserved by keeping raw text as the primary input. Pre-formatting is a possible future power-user option, not the default.
- **Chunkers are their own module** — `source/chunker.ts` parallels `source/engine.ts`: pure function over text, no UI, no I/O, testable in isolation. The React component composes the two.
- **Multi-chunk viewport** — show the focused chunk plus as many neighbors as fit, dimmed. Documents have flow; isolating one chunk strips the context that gives it meaning.

## Layerable rendering

A default renderer handles any text. Source-kind-aware features (diff hunk dimming, syntax coloring, markdown structure) are layers _on top of_ the default — additive, opt-in, outside the engine.

The discipline: the engine doesn't know what its input "is." A diff, a TypeScript file, and a paragraph of prose all flow through the same `reducer(state, action) → state`. If the engine ever needs to ask "is this a diff?", we've drifted. The rendering layer is where that question becomes legal — and even there, it's answered by _which renderer is plugged in_, not by branching inside one renderer.

A renderer plugged into the engine is a function `(state) → Frame`. A layer is a transformation `Frame → Frame`. They compose; the engine doesn't care. This is the load-bearing pattern that lets us add `--diff`, `--syntax`, etc., without ever editing engine code.

## Cloze masked render

The cloze re-drill (active recall) is the clearest example of layerable rendering in the codebase, because it adds a new per-character visual mode without touching the engine at all.

**How it works:** after a typing run, `clozeBlanks` in `review.ts` selects the fumbled positions (slowest + most-mistyped words). `App` re-scopes `typeableIndices` to exactly that list and remounts `Racer` with `isClozeRun = true`. From the engine's perspective, nothing changed — it receives a smaller `typeableIndices` set and folds keystrokes the same way. All the "cloze" logic lives upstream of the engine.

**What the renderer does differently when `isClozeRun` is true:**

- **Untyped typeable positions** (the blanks you haven't filled yet) render as `▁` — the placeholder glyph is repeated to match the display width of the underlying character, so wide glyphs (CJK) keep columns aligned.
- **Once typed**, the position reveals its result via the existing `styleFor` logic: green for correct, red for wrong. No new render path — the same character-styling hook that drives a normal run handles the reveal.
- **All other text** — the positions not in `typeableIndices` — is non-typeable because the index set was re-scoped. The cursor skips them. They render as dim context, letting you see the surrounding passage while typing only the blanks.

**The engine purity invariant holds by construction:** `isClozeRun` is a render flag, not an engine flag. The engine never sees it. A test (`cloze-render.test.ts`) confirms that masked-ahead / revealed-on-type / no-mask-in-a-normal-run all hold at the render layer, and that the `c`-key re-drill and `--cloze` auto-advance flow correctly — without asserting on any engine internals.

**WPM and accuracy in a cloze run** measure recall of the blanks specifically, because `typeableIndices` is the re-scoped set. The fold hasn't changed; the input to the fold has.

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
// The live shape is source/chunker.ts; this sketch shows the load-bearing fields.
type Chunk = {
	start: number; // character offset (inclusive)
	end: number; // character offset (exclusive)
	label?: string; // optional — "function foo", "hunk 1", etc.
	kind?: ChunkKind; // optional — the chunk's structural unit (see "hybrid documents")
	spans?: Span[]; // optional — cosmetic ranges inside the chunk (see below)
};

type ChunkKind = 'prose' | 'code' | 'heading' | 'fenced-code' | 'diff-hunk';

// A cosmetic range within a chunk: rendered, but not in the typing path.
// `style` is a hint the renderer maps to a visual; the engine never reads it.
type Span = {
	style: SpanKind; // 'diff-add', 'md-heading-prefix', … — full union in source/chunker.ts
	start: number;
	end: number;
};

type Chunker = (text: string) => Chunk[];
```

The renderer:

- Knows the cursor index (from engine state).
- Calls a configured `Chunker` to get the chunk list at ingestion (or lazily, but at ingestion is fine).
- Finds the chunk containing the cursor.
- Renders that chunk, padding with neighbors if there's room.

Different input kinds get different chunkers, picked by the adapter (file extension, `--diff` flag, etc.). The renderer code doesn't change.

### Hybrid documents

Real-world content often mixes shapes within a single document — markdown with embedded code blocks, GitHub PR descriptions with diff snippets, design docs with prose + ASCII diagrams + sample code, Slack messages with text + code snippets. The chunker is the layer that recognizes these transitions.

Two fields carry this, at different granularities. `kind` names the chunk's structural unit — descriptive metadata for the chunk as a whole. The finer-grained decoration lives in `spans`: each chunker tags cosmetic sub-ranges with a `SpanKind` — the `diffChunker` emits `diff-add` / `diff-header` / … spans, the `markdownChunker` emits `md-heading-prefix` / `md-fence` / … spans. Two consumers read those spans: `computeTypeableIndices` drops the covered positions from the typing path (so you don't type the `> ` quote prefix or a `+` marker), and `spanVisuals` in `app.tsx` maps each `SpanKind` to a visual. A span usually marks a cosmetic _sub-range_ of an otherwise-typeable chunk, but it needn't: a `comment` chunk (an `<!-- … -->` HTML block) carries one `md-comment` span over its whole extent, so the entire chunk is rendered dim and nothing in it is typed — editorial prose you read past, not text you drill on. Syntax highlighting on `fenced-code` is the one decoration not yet emitted — it'd be a new `SpanKind` family on the code chunk. The engine never sees `kind` or `spans`.

A markdown chunker for a doc like:

````
# Introduction

Some prose explaining the idea.

​```ts
const x = 1;
​```

More prose.
````

…produces something like:

```ts
[
	{start: 0, end: 16, kind: 'heading', label: '# Introduction'},
	{start: 17, end: 50, kind: 'prose', label: 'paragraph 1'},
	{start: 51, end: 70, kind: 'fenced-code', label: 'ts code block'},
	{start: 71, end: 82, kind: 'prose', label: 'paragraph 2'},
];
```

Decisions worth noting up front:

- **Start flat, defer hierarchical chunks.** A `chunks?: Chunk[]` field for sub-chunking inside a code block is tempting but adds tree-traversal logic everywhere chunks are consumed. Flat chunks + per-span decoration covers most cases; hierarchical chunks earn their place if and when a real use case demands them.
- **Per-span decoration, not per-file.** The same doc can switch decoration mid-stream as spans change. This is the _layerable rendering_ property at sub-chunk (span) granularity instead of the document granularity.
- **Kind is renderer concern, not engine concern.** The engine still sees uniform text and a typing-path cursor. Kinds inform display, not what the user types.

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

### Multi-chunk viewport

The complementary case to "chunk too big" is "chunk too small" — a 3-line paragraph alone in the viewport with the rest of the screen blank, while the surrounding paragraphs that give it meaning sit just out of view. Documents have **flow**; a single isolated chunk strips that.

**The principle:** show the focused chunk **plus as many neighbors as fit**, with the focused chunk in normal color and neighbors **dimmed**. The reader's eye gets sharp focus on what they're typing and de-emphasized peripheral text for context — the same mental model the brain uses when reading a printed page.

The visible viewport adapts to chunk size:

- Small focused chunk → many neighbors visible. Reads almost like the whole document with one section highlighted.
- Large focused chunk → few neighbors (or none). Same as the current "stick on one chunk" behavior.
- Very large focused chunk → falls back to line-window-inside-chunk (the "chunk too big" case above).

**Greedy expansion algorithm:**

- Start with just the focused chunk.
- Look at both immediate neighbors. Pick the smaller one (maximizes total chunks shown) that still fits in the remaining line budget.
- Repeat until no neighbor fits.
- Render all included chunks; per-line, dim everything that isn't in the focused chunk.

**Why dim instead of border or other separation:**

- Borders add visual chrome that competes with the source content. Dimming is invisible-when-not-relevant.
- The user already gets a chunk identity from the status row (`chunk 2 / 5`); dimming reinforces "this is the _focused_ one" without rebroadcasting structure.
- Standard editor convention. Most IDEs use dim/fade for code outside the cursor's scope.

**Trade-offs to know:**

- **Chunk-boundary jitter.** When the cursor crosses a chunk boundary, the focused chunk changes and the viewport may shift. Dimmed neighbors mean the shift is _less_ jarring (the now-focused chunk was already on screen), but some movement is unavoidable. Sticky behavior — only re-expanding the neighbor set when membership actually changes — keeps jitter to a minimum.
- **Dynamic viewport size.** Line budget should come from `process.stdout.rows` (minus status row height) and re-subscribe on `SIGWINCH`. Static budget works for a first cut.
- **Asymmetric expansion** (e.g., near the start of the document, only "next" neighbors exist) — the algorithm degenerates gracefully; the line budget fills with what's available.

**What this changes architecturally:** nothing. The engine doesn't move. The chunker doesn't move. The renderer's "which lines to render and how to dim them" logic gets richer. This is the _layerable rendering_ property in action — viewport policy is a renderer choice that can grow without touching the layers below.

### Why not just pagination

Some tools pick "show one screen at a time, user advances explicitly." We don't, because:

- It introduces a mode switch that breaks typing rhythm.
- It requires the user to think about the rendering — anti the chill-not-strict typing principle.
- Continuous scrolling via semantic chunks is the experience editors already trained users to expect.

### Why not single-line / Monkeytype-style

A few sites show just the current line plus a sliver of context. This works for prose-only trainers where line breaks are meaningless. It's wrong for code (function structure invisible), diffs (hunk context lost), and long-form prose (paragraphs broken arbitrarily). The whole point of ttype is handling structured input gracefully; collapsing to one line throws away the structure.

## Cursor highlight

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
