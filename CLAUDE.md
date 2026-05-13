# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`ttype` is an Ink-based terminal type-racer. It was scaffolded with `create-ink-app` and is still at the scaffold stage — `source/app.tsx` is the default "Hello, $name" greeter, not yet the type-racer UI.

## Why ttype exists

Sean spends a lot of time in Claude Code (which is built on Ink) and wants *one* tool to drill on the variety of text he actually reads in a day: prose essays, full source files, git commits, PRs, and diffs. Existing type racers each cover one slice — TypeRacer / Monkeytype do prose only; Typing.io does code strictly; nobody handles diffs comfortably. ttype is the single tool that handles all of those well.

The secondary motivation: Sean is new to TypeScript and React, and ttype doubles as the learning vehicle for both.

## Goals

1. **A general-purpose engine over arbitrary text.** Essays, source files, commits, PRs, and diffs all flow through the same engine via pluggable adapters. The engine never branches on input kind — that's how we avoid the existing-trainers trap of building one product per input shape.
2. **Layerable rendering.** A default renderer works for any text. Source-kind-aware rendering (dimming diff hunk headers, syntax highlighting, markdown structure) is **additive** — it lives outside the core so the engine stays simple as features grow. If the core ever needs to know what a diff is, we've drifted.
3. **A TypeScript + React learning project.** The owner is new to both. Favor idiomatic, teachable patterns over clever ones. When introducing a non-trivial TS or React concept (hooks, generics, discriminated unions, dependency arrays, controlled inputs, etc.), explain the fundamental before/while writing the code.
4. **Self-hosting.** Once the engine works, it should run cleanly over *this repo's own files and git diffs* — including `.tsx` source, design docs, and `git diff`/`git show` output on commits we've made here. This is both a learning lever (type through the code we wrote to internalize it) and a real-world validation: if the engine can't gracefully handle our own TypeScript, our own diffs, and our own markdown, it's not done.

## Validation workflows

These are the demos/tests we use to check we're meeting the goals. If a change makes any of these harder, we've drifted.

- **Smoke (engine works at all):** type-race a hardcoded multi-line string from inside `source/app.tsx`; correct chars green, wrong chars red, WPM + accuracy shown at the end.
- **File adapter:** `ttype path/to/essay.txt` runs the racer over the file contents. Proves the adapter boundary — no engine changes should be needed when adding this.
- **Stdin adapter:** `cat foo.md | ttype` and `git diff | ttype` both work. Same engine, different adapter. If `git diff | ttype` requires engine changes, the boundary is wrong.
- **Diff-aware rendering (optional layer):** with a `--diff` flag (or auto-detected), `+`/`-` lines render differently *without* the core engine knowing what a diff is. This is the test that goal 2 actually holds.
- **Engine unit tests:** the engine is testable in isolation with a plain string input and a sequence of simulated keystrokes — no Ink, no adapters. If the engine can't be tested without rendering, it's doing too much.
- **Type-level invariants (the compiler is a test):** illegal states must be unrepresentable, not "validated at runtime." Discriminated unions with `kind` fields instead of flag bags or nullable numbers. Every `switch` on a union ends in a `never` exhaustiveness check. State is `Readonly<…>` / `ReadonlyArray<…>`; the engine never mutates. No `any` in engine code; `unknown` only at adapter boundaries. See [docs/ts-conventions.md](docs/ts-conventions.md) for the full checklist.
- **Replayability (the engine is a fold):** every scenario in `docs/scenarios.md` is also a JSON fixture: `{ text, events[], expected }`. A test loads the fixture, feeds events through `applyEvent`, asserts on the result. If something can affect engine outcomes that isn't in `events` (a wall clock, a global, an env var), that's a bug. See [docs/engine-design.md](docs/engine-design.md).
- **Teaching check:** after a non-trivial change, Sean should be able to point at any new line and say what it does and why. If not, we went too fast — slow down and explain.
- **Dogfood (self-hosting):** running `ttype source/app.tsx`, `cat docs/typing-feel.md | ttype`, and `git show HEAD | ttype` against this repo should all work and feel right — no special cases, no engine flags. Once the engine exists, this becomes a fixed checkpoint we run periodically. It catches edge cases that synthetic test text doesn't: mixed tabs/spaces in TS files, fenced code blocks in markdown, `+`/`-` markers in diffs, long lines, unicode in commit messages, etc. (Goal 4.)

## Commands

- `npm run build` — compile `source/` → `dist/` via `tsc`
- `npm run dev` — `tsc --watch`
- `npm test` — runs the full check: `prettier --check . && xo && ava`
- `npx ava test.tsx` — run tests only (skip lint/format)
- `npx ava test.tsx -m 'greet user with a name'` — run a single test by title
- `node dist/cli.js --name=Jane` — run the built CLI (must `npm run build` first; `bin` points at `dist/cli.js`)

## Architecture

- `source/cli.tsx` — entry point. Parses flags with `meow`, then `render(<App .../>)` from `ink`. `#!/usr/bin/env node` shebang + `"bin": "dist/cli.js"` in package.json makes the compiled output executable.
- `source/app.tsx` — the React/Ink component tree. Ink renders React components to the terminal (`<Text>`, `<Box>`, etc. from `ink`, not the DOM).
- `test.tsx` (at repo root, not under `source/`) — uses `ink-testing-library`'s `render` + `lastFrame()` to assert on terminal output. Imports `./source/app.js` (note the `.js` extension on a `.tsx` source — required because `"type": "module"` + NodeNext-style resolution; ts-node's ESM loader maps it back to `.tsx`).

ESM specifics that matter when editing:
- `package.json` has `"type": "module"`, so relative imports must use explicit `.js` extensions even when the source is `.tsx`/`.ts`.
- `ava` is configured to run `.ts`/`.tsx` directly via `--loader=ts-node/esm` (see the `ava` block in package.json) — no separate build step needed for tests.

## Lint/format

`xo` (extends `xo-react`, prettier-integrated) is the linter; `@vdemedes/prettier-config` is the formatter config. `react/prop-types` is disabled. `npm test` will fail on any prettier or xo violation before tests run, so format/lint locally before assuming a test failure is logic-related.
