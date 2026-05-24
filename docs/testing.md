# Testing

ttype's tests are layered by what they isolate. Each layer answers different questions cheaply; together they're cheaper than any single layer trying to do everything.

## At a glance

- **Reducer unit tests** — fastest, smallest. Call the reducer with explicit inputs; assert on the returned state. No Ink, no React, no I/O.
- **Replay fixtures** — JSON files describing a session as `{text, events, expected}`. Loaded by a generic runner that folds events through the reducer and compares.
- **Integration tests** (planned, not yet written) — render the actual component with `ink-testing-library`, simulate keystrokes, assert on the rendered frame.

The first two layers are in place. The third is a known gap; this doc names what it would cover and what it costs.

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

## Integration tests (not yet written)

Reducer tests cover the engine. They **don't** cover the wiring between the React component and the engine — specifically:

- Pressing the Enter key produces a `TYPE_CHAR` with `char='\n'`.
- Pressing the macOS Delete key produces a `BACKSPACE`.
- The visible frame correctly shows green for matched chars, red for mismatches, and the cursor highlight at the right column.
- The status row updates when the session completes.

To cover that surface, use `ink-testing-library` (already a devDep). Sketch:

```ts
import test from 'ava';
import {render} from 'ink-testing-library';
import App from './app.js';

test('pressing Enter advances the cursor past a newline', t => {
	const {stdin, lastFrame} = render(<App text="a\nb" />);

	stdin.write('a');
	stdin.write('\r'); // carriage return — what the terminal sends for Enter
	stdin.write('b');

	t.regex(lastFrame() ?? '', /a/);
	t.regex(lastFrame() ?? '', /b/);
});
```

Wrinkles to know about when these get written:

- **Terminal Enter is `\r`, not `\n`.** Ink translates `\r` from stdin into `key.return: true`; the app's useInput then maps that to a `TYPE_CHAR` with `char='\n'`. The test feeds `\r` to exercise the full chain.
- **`lastFrame()` includes ANSI escape codes.** Use `t.regex` against substrings; don't try to compare full styled frames as strings — too brittle.
- **Render timing**: `stdin.write(...)` triggers a re-render, but a microtask tick may be needed before `lastFrame()` reflects it. Some test patterns insert `await new Promise(r => setImmediate(r))` between writes and assertions.
- **macOS Delete key is `\x7f` (DEL)**, not `\x08` (BS). Both map to BACKSPACE/DELETE flags in Ink, but only one is what the user's keyboard actually sends — test with the real byte.

## Why integration tests are deferred

For the current scope (one component, one reducer, a handful of key bindings), the engine-level fixtures cover most behavior worth testing. Integration tests have real costs:

- More brittle than reducer tests; touch Ink internals.
- Slower (component mount + render cycle per test).
- Can break on Ink upgrades even when behavior is unchanged.

The pragmatic point at which to add them is when one of these becomes true:

- You catch yourself manually testing the same key binding repeatedly.
- A useInput refactor scares you.
- A bug ships that was in the useInput → reducer plumbing (not the reducer itself).

Until then, accumulating reducer fixtures is higher leverage. Belt-and-suspenders is worth doing _eventually_; doing it _now_ is premature.

## The categories together

Roughly, what each layer is suited for:

- **Reducer unit tests** — invariants, edge cases, reference identity, error paths.
- **Replay fixtures** — scenarios, regression tests for bug reports, anything that fits "given a session, the final state should be X."
- **Integration tests** — keyboard wiring, the rendered frame, anything visible to the user.

The boundary you're testing across should match the layer you're using. A failed reducer test points at the reducer; a failed fixture points at the engine end-to-end; a failed integration test points at the wiring. Mixing layers obscures which thing actually broke.
