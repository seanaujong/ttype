# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`ttype` is an Ink-based terminal type-racer, originally scaffolded with `create-ink-app`. It is now a working, feature-complete tool: one pure engine races arbitrary text (prose, source, commits, PRs, diffs), with additive rendering layers (diff / markdown / two-column `--split` view), chunk-skipping, an end-of-run results screen, and a cloze (fill-in-the-blank) active-recall re-drill. The goals below are met; the one remaining additive thread is syntax highlighting. See `docs/` for the design and `docs/diary/TODO.md` (gitignored) for the living status.

## Why ttype exists

Sean spends a lot of time in Claude Code (which is built on Ink) and wants _one_ tool to drill on the variety of text he actually reads in a day: prose essays, full source files, git commits, PRs, and diffs. Existing type racers each cover one slice — TypeRacer / Monkeytype do prose only; Typing.io does code strictly; nobody handles diffs comfortably. ttype is the single tool that handles all of those well.

The secondary motivation: Sean is new to TypeScript and React, and ttype doubles as the learning vehicle for both.

## Goals

**At a glance:**

- **General-purpose engine over arbitrary text** — essays, source, commits, PRs, and diffs all share one engine; the engine never branches on input kind.
- **Layerable rendering** — source-kind-aware rendering (diff hunk highlighting, syntax highlighting) is additive and lives outside the core.
- **A TypeScript + React learning project** — favor idiomatic, teachable patterns; explain fundamentals when introducing non-trivial TS / React concepts.
- **Self-hosting** — the engine must run cleanly on this repo's own files and git diffs as a real-world validation gate.

Each, in detail below. **Cross-reference goals by name (e.g., "the self-hosting goal"), not by number** — see [docs/README.md](docs/README.md) for the rule.

### General-purpose engine over arbitrary text

Essays, source files, commits, PRs, and diffs all flow through the same engine via pluggable adapters. The engine never branches on input kind — that's how we avoid the existing-trainers trap of building one product per input shape.

### Layerable rendering

A default renderer works for any text. Source-kind-aware rendering (dimming diff hunk headers, syntax highlighting, markdown structure) is **additive** — it lives outside the core so the engine stays simple as features grow. If the core ever needs to know what a diff is, we've drifted.

### A TypeScript + React learning project

The owner is new to both. Favor idiomatic, teachable patterns over clever ones. When introducing a non-trivial TS or React concept (hooks, generics, discriminated unions, dependency arrays, controlled inputs, etc.), explain the fundamental before/while writing the code.

### Self-hosting

Once the engine works, it should run cleanly over _this repo's own files and git diffs_ — including `.tsx` source, design docs, and `git diff`/`git show` output on commits we've made here. This is both a learning lever (type through the code we wrote to internalize it) and a real-world validation: if the engine can't gracefully handle our own TypeScript, our own diffs, and our own markdown, it's not done.

## Validation workflows

These are the demos/tests we use to check we're meeting the goals. If a change makes any of these harder, we've drifted.

- **Smoke (engine works at all):** the racer shows correct chars green, wrong chars red, and WPM + accuracy at the end. (This was the first milestone — a hardcoded string inside `source/app.tsx`; it's now the real app over any file or stdin.)
- **File adapter:** `ttype path/to/essay.txt` runs the racer over the file contents. Proves the adapter boundary — no engine changes should be needed when adding this.
- **Stdin adapter:** `cat foo.md | ttype` and `git diff | ttype` both work. Same engine, different adapter. If `git diff | ttype` requires engine changes, the boundary is wrong.
- **Diff-aware rendering (optional layer):** with a `--diff` flag (or auto-detected), `+`/`-` lines render differently _without_ the core engine knowing what a diff is. This is the test that the _layerable rendering_ goal actually holds.
- **Engine unit tests:** the engine is testable in isolation with a plain string input and a sequence of simulated keystrokes — no Ink, no adapters. If the engine can't be tested without rendering, it's doing too much.
- **Type-level invariants (the compiler is a test):** illegal states must be unrepresentable, not "validated at runtime." Discriminated unions with `kind` fields instead of flag bags or nullable numbers. Every `switch` on a union ends in a `never` exhaustiveness check. State is `Readonly<…>` / `ReadonlyArray<…>`; the engine never mutates. No `any` in engine code; `unknown` only at adapter boundaries. See [docs/research/ts-conventions.md](docs/research/ts-conventions.md) for the full checklist.
- **Replayability (the engine is a fold):** every scenario in `docs/research/scenarios.md` is also a JSON fixture: `{ text, events[], expected }`. A test loads the fixture, feeds events through the engine `reducer` (via `replay`), asserts on the result. If something can affect engine outcomes that isn't in `events` (a wall clock, a global, an env var), that's a bug. See [docs/research/engine-design.md](docs/research/engine-design.md).
- **Teaching check:** after a non-trivial change, Sean should be able to point at any new line and say what it does and why. If not, we went too fast — slow down and explain.
- **Dogfood (self-hosting):** running `ttype source/app.tsx`, `cat docs/research/typing-feel.md | ttype`, and `git show HEAD | ttype` against this repo should all work and feel right — no special cases, no engine flags. Once the engine exists, this becomes a fixed checkpoint we run periodically. It catches edge cases that synthetic test text doesn't: mixed tabs/spaces in TS files, fenced code blocks in markdown, `+`/`-` markers in diffs, long lines, unicode in commit messages, etc. (The _self-hosting_ goal made concrete.)

## Commands

- `npm run build` — compile `source/` → `dist/` via `tsc`
- `npm run dev` — `tsc --watch`
- `npm test` — gate check: `prettier --check . && xo && ava` (format + lint + the engine/render test suite). **Does NOT run `tsc`** — run `npm run build` separately to catch type errors.
- `npm run fix` — `prettier --write` then `xo --fix`
- `npx tsx source/cli.tsx` — run the CLI straight from source while iterating (no build step)
- `node dist/cli.js` — run the built CLI (must `npm run build` first; `bin` points at `dist/cli.js`)

## Architecture

The full map (with a diagram and invariant tables) is [docs/architecture.md](docs/architecture.md); the layers in brief:

- `source/cli.tsx` — entry point. Parses flags (`--diff`, `--split`, `--cloze`) with `meow`, then `render(<App .../>)` from `ink`. `#!/usr/bin/env node` shebang + `"bin": "dist/cli.js"` makes the compiled output executable.
- `source/app.tsx` — the React/Ink shell: `App` (owns the scope — chunking, the start chunk, cloze re-drill state) and `Racer` (one typing session — engine fold, viewport, per-char styling, render). Ink renders to the terminal (`<Text>`/`<Box>` from `ink`, not the DOM).
- `source/engine.ts` — the pure fold (`reducer`, `initialState`, `replay`). State is `Readonly`; the engine never branches on input kind and folds opaque keystroke strings by count.
- `source/chunker.ts` — per-kind chunkers (blank-line / diff / markdown) and `computeTypeableIndices`; emits the cosmetic spans the renderer decorates from. Decides what's typeable; the engine never learns the input kind.
- `source/layout.ts` / `source/grapheme.ts` / `source/viewport.ts` / `source/review.ts` — pure helpers: display-width + cursor-following scroll geometry; grapheme clustering; the "frame fits the terminal" invariant; and the post-run second fold (per-word stats + the `clozeBlanks` cloze selection).
- Tests: `source/*.test.ts` (ava) plus replayable JSON fixtures in `source/fixtures/`; `source/ink-harness.ts` is the committed TUI test driver (`renderApp` / `renderComponent`). See [docs/testing.md](docs/testing.md).

ESM specifics that matter when editing:

- `package.json` has `"type": "module"`, so relative imports must use explicit `.js` extensions even when the source is `.tsx`/`.ts`.
- `ava` runs `.ts`/`.tsx` directly via `--import=tsx` with `workerThreads: false` (so the loader registration propagates to test files).

## Lint/format

`xo` (extends `xo-react`, prettier-integrated) is the linter; `@vdemedes/prettier-config` is the formatter config. `react/prop-types` is disabled. `npm test` will fail on any prettier or xo violation before tests run, so format/lint locally before assuming a test failure is logic-related.
