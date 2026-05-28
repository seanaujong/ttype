# Testing

ttype's tests are layered by what they isolate. Each layer answers different questions cheaply; together they're cheaper than any single layer trying to do everything.

## At a glance

- **Reducer unit tests** — fastest, smallest. Call the reducer with explicit inputs; assert on the returned state. No Ink, no React, no I/O.
- **Replay fixtures** — JSON files describing a session as `{text, events, expected}`. Loaded by a generic runner that folds events through the reducer and compares.
- **Integration / flow tests** — render the actual component via the TUI harness (`source/ink-harness.ts`), simulate keystrokes, assert on the rendered frame. Written. Cover keyboard wiring, geometry invariants, and the end-to-end cloze flow.

All three layers are in place.

## Reducer unit tests

Standard ava `test('name', t => ...)`. Each test is one Act on the reducer.

The pattern: arrange initial state, call `reducer(state, action)`, assert on the returned state.

```ts
test('first TYPE_CHAR appends char, sets startedAt, leaves endedAt unset', t => {
	const next = reducer(initialState('hello'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});

	t.deepEqual(next.keystrokes, ['h']);
	t.is(next.startedAt, 1000);
	t.is(next.endedAt, undefined);
});
```

Conventions:

- **One Act per test** — one reducer call. Multiple assertions are fine when they describe the same post-condition surface (the keystrokes added + the timestamp set + the timestamp not set are facets of one transition).
- **Different scenarios → different tests** — two-step sequences with their own setup get their own `test(...)`. Don't cram multiple stories into one.
- **Pick inputs where wrong code would produce different output** — `at: 1000` then `at: 2000` is better than `at: 1000` twice for testing a "preserve earliest" invariant. A test that passes under both correct and broken code is a weak test.

## Replay fixtures

A fixture describes a session as data, not code:

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

The generic runner in `source/engine.test.ts` scans `source/fixtures/` at module load and registers one ava test per JSON file. **Drop a JSON file → get a test.** No test code changes.

When to reach for a fixture vs. an in-code reducer test:

| Scenario                                                | Use a fixture | Use in-code                      |
| ------------------------------------------------------- | ------------- | -------------------------------- |
| "User typed sequence X, final state should be Y"        | ✓             | works but ceremony               |
| Reference identity (`t.is(third, second)` on no-op cap) | —             | required (can't express in JSON) |
| Intermediate state inspection between actions           | —             | required                         |
| Throws / errors                                         | —             | required                         |
| Recorded bug report → regression test                   | ✓             | —                                |

The two layers coexist; one isn't the upgrade path to the other.

## Integration and flow tests

Reducer tests cover the engine. They **don't** cover the wiring between the React component and the engine — specifically:

- Pressing the Enter key produces a `TYPE_CHAR` with `char='\n'`.
- Pressing the macOS Delete key produces a `BACKSPACE`.
- The visible frame correctly shows green for matched chars, red for mismatches, and the cursor highlight at the right column.
- The status row updates when the session completes.

These are now covered. The deferral trigger was hit: recurring rendering/flicker bugs and the need to verify that the rendered frame fits the terminal geometry made a committed harness the right call.

### The TUI harness (`source/ink-harness.ts`)

`ink-testing-library@3` and `ink@4` disagree about how input and size reach the component. Rather than re-inventing the shim in every test file, `source/ink-harness.ts` centralizes it. The harness installs three patches on the mock stdin/stdout before any test can run:

1. **`ref`/`unref` stub** — Ink calls `stdin.ref()` when it enables raw mode; the mock has neither, so `useInput`'s first effect would throw. The harness adds no-op stubs.
2. **`read()`/`'readable'` bridge** — `ink@4` reads input by attaching a `'readable'` listener and draining `stdin.read()` until it returns `null`. The mock only emits `'data'` (which Ink ignores), so the harness queues keystroke bytes and feeds them through `read()` + a `'readable'` emit instead.
3. **`resize` with listener-safe timing** — the `'resize'` event is emitted _after_ the effect that attaches the listener has had one tick to run, so the first resize actually reaches the hook.

The public API is:

```ts
renderApp(props); // mounts <App> with the shims
renderComponent(element); // mounts any element — used by Racer-direct tests
```

Both return a `RenderedApp` with `press(bytes)`, `type(text)`, `pressEnter()`, `pressBackspace()`, `resize({columns, rows})`, `tick()`, `frameLines()`, `lastFrame()`, and `unmount()`.

Wrinkles encoded in the harness:

- **Terminal Enter is `\r`, not `\n`.** Ink translates `\r` from stdin into `key.return: true`; the app's `useInput` maps that to a `TYPE_CHAR` with `char='\n'`. `pressEnter()` sends `'\r'` to exercise the full chain.
- **`lastFrame()` includes ANSI escape codes.** Assert on substrings or glyph counts (`frame.match(/▁/g)`), not full styled strings — full frame comparison is too brittle.
- **Render timing** — effects (raw-mode setup, input listener, resize listener) run after the first commit, not during `render()`. The harness waits one tick before the first keystroke or resize so those listeners are attached.
- **macOS Delete key is `\x7f` (DEL)**, not `\x08` (BS). `pressBackspace()` sends the real byte.

### What is tested

**`source/viewport.test.ts`** — geometry guard: for several passage shapes (a 60-line tall chunk, a 150-char wide line, a diff in split mode, a narrow-terminal footer, a live-typing frame) the emitted frame must fit within the terminal dimensions. The test renders via the harness, resizes when needed, and checks `lines.length < rows && every line width < columns`. This is a geometry invariant, not a brittle content snapshot.

**`source/cloze-render.test.ts`** — the cloze contract and flow:

- A cloze run hides untyped blank positions as `▁`; a normal run masks nothing.
- Typing a blank reveals it (the masking resolves as the cursor passes through).
- On the results screen, pressing `c` remounts a new run with the fumbled words blanked.
- With `--cloze`, completing the warm-up auto-advances into the masked re-drill without pressing `c`.

The masking tests drive `Racer` directly via `renderComponent`; the flow tests drive the full `App` via `renderApp`.

### Remaining limit

The harness can model keystroke wiring and frame geometry but **cannot model real-terminal auto-wrap** — that requires a real frame capture or a human's eyes. True end-to-end real-terminal testing remains out of scope. Cloze and other features are dogfooded interactively to cover what the harness cannot.

## The categories together

Roughly, what each layer is suited for:

- **Reducer unit tests** — invariants, edge cases, reference identity, error paths.
- **Replay fixtures** — scenarios, regression tests for bug reports, anything that fits "given a session, the final state should be X."
- **Integration / flow tests** — keyboard wiring, the rendered frame geometry, end-to-end feature flows (cloze re-drill, auto-advance, masking).

The boundary you're testing across should match the layer you're using. A failed reducer test points at the reducer; a failed fixture points at the engine end-to-end; a failed integration test points at the wiring or the rendered frame. Mixing layers obscures which thing actually broke.
