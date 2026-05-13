# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`ttype` is an Ink-based terminal type-racer. It was scaffolded with `create-ink-app` and is still at the scaffold stage — `source/app.tsx` is the default "Hello, $name" greeter, not yet the type-racer UI.

## Goals

1. **General-purpose, not diff-specific.** The core engine accepts arbitrary text. Input sources (plain files, stdin, `git diff`, `git show`, URLs, etc.) are pluggable adapters that all produce a `string` (or tokenized text) for the engine. The engine never branches on input kind.
2. **Layerable rendering.** Default rendering works for any text. Source-kind-aware rendering (e.g., dimming diff hunk headers, syntax highlighting) is opt-in and lives outside the core.
3. **A TypeScript + React learning project.** The owner is new to both. Favor idiomatic, teachable patterns over clever ones. When introducing a non-trivial TS or React concept (hooks, generics, discriminated unions, dependency arrays, controlled inputs, etc.), explain the fundamental before/while writing the code.
4. **Useful to actually type with.** Real input sources Seana wants to drill on: essays/articles, full source files, commits, PRs, diffs.

## Validation workflows

These are the demos/tests we use to check we're meeting the goals. If a change makes any of these harder, we've drifted.

- **Smoke (engine works at all):** type-race a hardcoded multi-line string from inside `source/app.tsx`; correct chars green, wrong chars red, WPM + accuracy shown at the end.
- **File adapter:** `ttype path/to/essay.txt` runs the racer over the file contents. Proves the adapter boundary — no engine changes should be needed when adding this.
- **Stdin adapter:** `cat foo.md | ttype` and `git diff | ttype` both work. Same engine, different adapter. If `git diff | ttype` requires engine changes, the boundary is wrong.
- **Diff-aware rendering (optional layer):** with a `--diff` flag (or auto-detected), `+`/`-` lines render differently *without* the core engine knowing what a diff is. This is the test that goal 2 actually holds.
- **Engine unit tests:** the engine is testable in isolation with a plain string input and a sequence of simulated keystrokes — no Ink, no adapters. If the engine can't be tested without rendering, it's doing too much.
- **Type-level invariants (the compiler is a test):** illegal states must be unrepresentable, not "validated at runtime." Discriminated unions with `kind` fields instead of flag bags or nullable numbers. Every `switch` on a union ends in a `never` exhaustiveness check. State is `Readonly<…>` / `ReadonlyArray<…>`; the engine never mutates. No `any` in engine code; `unknown` only at adapter boundaries. See [docs/ts-conventions.md](docs/ts-conventions.md) for the full checklist.
- **Replayability (the engine is a fold):** every scenario in `docs/scenarios.md` is also a JSON fixture: `{ text, events[], expected }`. A test loads the fixture, feeds events through `applyEvent`, asserts on the result. If something can affect engine outcomes that isn't in `events` (a wall clock, a global, an env var), that's a bug. See [docs/engine-design.md](docs/engine-design.md).
- **Teaching check:** after a non-trivial change, Seana should be able to point at any new line and say what it does and why. If not, we went too fast — slow down and explain.

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
