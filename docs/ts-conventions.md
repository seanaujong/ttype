# TypeScript conventions

Patterns we use in ttype to make the engine **hard to misuse** and **easy to refactor**. The goal — borrowed from Yaron Minsky's phrasing in the OCaml community — is to **make illegal states unrepresentable**. If a state shouldn't exist, the compiler should refuse to let you write it down. The bug you can't compile is the bug that never ships.

These conventions pair with the event-sourced engine in [engine-design.md](engine-design.md): pure functions over immutable state are easy to reason about, easy to test, and easy to replay. Mutability undoes most of that.

## At a glance

- **Discriminated unions instead of flag bags** — finite mutually-exclusive shapes use a `kind` field; the compiler only lets legal states compile.
- **Exhaustiveness checking with `never`** — every `switch` on a union ends with a `never` assertion so adding a new variant forces an audit of every consumer.
- **Discriminated unions over `T | null` / `T | undefined`** — nullables let "I forgot a check" pass; unions force the check.
- **Branded types** — `TypeableIndex` is not just any `number`; smart constructors prove the brand.
- **`readonly` everywhere in state** — `Readonly<T>` + `ReadonlyArray<T>` make accidental mutation a compile error.
- **Pure functions return new state** — `applyEvent` never mutates; it builds and returns. Pairs with event-sourcing's fold.
- **No array mutators** — prefer the copy-returning equivalents (`[...a, x]`, `arr.toSorted()`, `arr.map(...)`).
- **`as const` for fixed sets** — derive the union type from the values, so the values are the single source of truth.
- **Smart constructors for invariants** — one place gets to assert the brand; everywhere else trusts it.
- **Strict tsconfig** — turn on `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` before writing engine code, not after.
- **No `any`; `unknown` only at boundaries** — `unknown` forces a narrow; `any` silently disables checking.
- **Justify the escape hatches** — `useMemo`, `useEffect`, `as`, `!`, `eslint-disable` all carry a one-line "why" comment. The convention is enforced for `eslint-disable` via a lint rule; the rest is honor-system.

The doc closes with a per-commit **checklist** that converts these into a thing to look at before committing engine code.

## Discriminated unions instead of flag bags

When a value has finite, mutually exclusive shapes, encode the shape in a `kind` field rather than juggling flags.

```ts
// bad — illegal states are representable
type CharState = {
	typed?: boolean;
	correct?: boolean;
	wrong?: boolean;
	autoMissed?: boolean;
};
// what does { typed: true, correct: false, wrong: true, autoMissed: true } mean?

// good — only legal states compile
type CharState =
	| {kind: 'untyped'}
	| {kind: 'correct'; typedChar: string}
	| {kind: 'wrong'; typedChar: string}
	| {kind: 'auto-missed'};
```

The `kind` field is the **discriminator**. TypeScript narrows the type inside `switch`/`if` blocks automatically. You also can't access `typedChar` on an `untyped` state — the compiler won't let you.

## Exhaustiveness checking with `never`

Every `switch` on a discriminated union ends with a `never` assertion:

```ts
function describe(s: CharState): string {
	switch (s.kind) {
		case 'untyped':
			return '';
		case 'correct':
			return s.typedChar;
		case 'wrong':
			return s.typedChar;
		case 'auto-missed':
			return '';
		default: {
			const _exhaustive: never = s;
			return _exhaustive;
		}
	}
}
```

If we later add `{ kind: 'corrected'; ... }` and forget to handle it here, the compiler errors at the `never` line. This is how we make adding a new variant _force_ an audit of every consumer — exactly what we want for an engine.

## Discriminated unions over `T | null` / `T | undefined`

Nullables make pre-existing code silently wrong when you forget a check. Discriminated unions force the check.

```ts
// bad
type Cursor = number | null;
const next = cursor + 1; // typo: cursor might be null; runtime NaN

// good
type Cursor = {kind: 'at'; index: TypeableIndex} | {kind: 'done'};

if (cursor.kind === 'at') {
	// here, cursor.index is a TypeableIndex — guaranteed
}
```

Use `null`/`undefined` only at boundaries (parsing, optional config). Inside the engine, everything is a union.

## Branded types

Plain `number` lets you mix `cursor`, `length`, `index-into-charStates`, `index-into-typeableIndices` — all are `number`. Brand them so they can't be confused.

```ts
type TypeableIndex = number & {readonly __brand: 'TypeableIndex'};
type CharIndex = number & {readonly __brand: 'CharIndex'};

// you can't pass a TypeableIndex where a CharIndex is expected
function charAt(text: string, i: CharIndex): string {
	return text[i];
}

// the only way to construct one is via a smart constructor that proves the invariant
function toTypeableIndex(n: number, indices: readonly number[]): TypeableIndex {
	if (!indices.includes(n)) throw new Error(`${n} is not typeable`);
	return n as TypeableIndex;
}
```

Brands are zero-cost at runtime — they exist only in the type system. Use them sparingly, only where confusion would be expensive (cursor indices are a great fit).

## `readonly` everywhere in state

State is immutable. Mark it.

```ts
type State = Readonly<{
	text: string;
	typeableIndices: ReadonlyArray<number>;
	cursor: Cursor;
	charStates: ReadonlyArray<CharState>;
}>;
```

`Readonly<T>` makes top-level fields read-only; `ReadonlyArray<T>` removes mutating methods (`push`, `splice`, `sort` in place, etc.). If we ever write `state.cursor = ...`, the compiler stops us.

Note: `Readonly` is shallow. Nested objects need their own `Readonly` or the structure needs to be flat enough that shallow is sufficient. For ttype, shallow + `ReadonlyArray` is enough — nothing nests deeply.

## Pure functions return new state

The engine API is one function: `applyEvent(state, event) → state`. Inside it, we _never_ mutate `state`. We build the next state and return it.

```ts
function applyEvent(state: State, event: Event): State {
	switch (event.kind) {
		case 'input': {
			if (state.cursor.kind === 'done') return state;
			const target = state.text[state.cursor.index];
			const correct = event.char === target;
			return {
				...state,
				charStates: state.charStates.map((c, i) =>
					i === state.cursor.index
						? correct
							? {kind: 'correct', typedChar: event.char}
							: {kind: 'wrong', typedChar: event.char}
						: c,
				),
				cursor: nextCursor(state),
			};
		}
		// ...
	}
}
```

This pairs with event-sourcing: `state = events.reduce(applyEvent, initial)`. Immutability is what makes that fold safe — every intermediate state is a real, inspectable value.

## No array mutators

Use the copy-returning versions:

| mutating (avoid)  | non-mutating (prefer)                                    |
| ----------------- | -------------------------------------------------------- |
| `arr.push(x)`     | `[...arr, x]`                                            |
| `arr.pop()`       | `arr.slice(0, -1)`                                       |
| `arr.splice(...)` | spread + slice                                           |
| `arr.sort(...)`   | `arr.slice().sort(...)` or `arr.toSorted(...)` (ES2023+) |
| `arr.reverse()`   | `arr.slice().reverse()` or `arr.toReversed()`            |
| `arr[i] = x`      | `arr.map((v,j) => j===i ? x : v)`                        |

`ReadonlyArray<T>` from _`readonly` everywhere in state_ catches most of these at compile time.

## `as const` for fixed sets

When you have a finite set of literal values, `as const` derives the union type from the values — single source of truth.

```ts
const EVENT_KINDS = ['input', 'backspace', 'enter'] as const;
type EventKind = (typeof EVENT_KINDS)[number]; // 'input' | 'backspace' | 'enter'
```

Add a new kind by editing the array; the type updates automatically.

## Smart constructors for invariants

If a value has an invariant that the type system can't fully express (e.g., "this number is a valid typeable index for _this_ text"), construct it once, in one place, and trust it everywhere else.

```ts
function makeInitialState(text: string): State {
	const typeableIndices = computeTypeableIndices(text);
	const cursor: Cursor =
		typeableIndices.length === 0
			? {kind: 'done'}
			: {kind: 'at', index: typeableIndices[0] as TypeableIndex};
	return {
		text,
		typeableIndices,
		cursor,
		charStates: Array.from(text, () => ({kind: 'untyped' as const})),
	};
}
```

The constructor is the one place that gets to write `as TypeableIndex`. Everywhere else, the brand is enforced.

## Strict tsconfig

The compiler is your fastest test. Turn it up.

The current `@sindresorhus/tsconfig` base is already strict. Of the two flags originally earmarked to enable when the engine landed:

- `noUncheckedIndexedAccess: true` — **already on** in `@sindresorhus/tsconfig`. `arr[0]` is `T | undefined`; array bounds must be handled explicitly.
- `exactOptionalPropertyTypes: true` — **not yet enabled**. Turning it on would mean `{ x?: string }` no longer accepts `{ x: undefined }` — optional means "may be absent," not "may be undefined." Worth enabling if the codebase stays clean.

## Avoid `any`. Tolerate `unknown` at boundaries.

`any` disables typechecking locally and silently. `unknown` is the safe alternative — it forces you to narrow before use.

```ts
// bad
function ingest(raw: any): string {
	return raw.trim();
}

// good — unknown forces a narrow at the boundary
function ingest(raw: unknown): string {
	if (typeof raw !== 'string') throw new Error('expected string');
	return raw.trim();
}
```

Adapters (file, stdin) are the only legitimate place for `unknown`; the engine should never see one.

## Justify the escape hatches

The language and libraries give us tools that are sometimes legitimately needed but always carry a cost — performance trade-offs, type-system bypasses, future-reader confusion. Every use of one is exceptional relative to "just write the obvious code." Each exception gets a one-line preceding comment that explains _why this case earns it_.

The list of constructs that count as opt-in escape hatches:

| Construct                                                 | Why it earns commentary                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `useMemo` / `useCallback`                                 | Caching has invalidation surface; the default is "just recompute"                |
| `useEffect`                                               | Easy to get wrong — deps, cleanup, double-mount behaviour                        |
| `as Foo` (type assertion)                                 | Bypasses the type checker; the reader needs to know what runtime guarantee holds |
| `!` (non-null assertion)                                  | Same as above, narrower                                                          |
| `// eslint-disable-*`                                     | Overrides a project-wide rule                                                    |
| Magic numbers without a name                              | The reader has to infer meaning from context                                     |
| `Math.floor` / `Math.ceil` / `Math.trunc` near boundaries | Often the right choice; sometimes the sign of an off-by-one                      |

```ts
// bad — reader has to guess why useMemo is here
const {lines, lineStarts} = useMemo(() => {
	/* ... */
}, [text]);

// good — the rationale is at the call site
// Recomputed only when text changes. Re-running on every keystroke is wasted
// work — line structure is a property of the source, not of typing progress.
const {lines, lineStarts} = useMemo(() => {
	/* ... */
}, [text]);
```

```ts
// bad
const cursor = state.cursor as TypeableIndex;

// good
// Safe because the state-construction path guarantees the cursor is always
// one of the indices in typeableIndices; the type system can't see that.
const cursor = state.cursor as TypeableIndex;
```

### Enforcement

For `eslint-disable-*` comments, the convention is mechanical: `eslint-comments/require-description` is enabled as an error in the xo config, so disable directives must include a `-- reason` suffix or the gate fails:

```ts
// eslint-disable-next-line react/no-array-index-key -- list is fixed-length and never reorders; index is the natural identity
<Text key={i} color={colorFor(i)}>
	{char}
</Text>
```

The other constructs (`useMemo`, `as`, `!`, etc.) are honor-system. Reviewing your own code (or PR review when there's a reviewer) is the enforcement. The convention exists so future-you knows the question to ask: _"is there a `// because ...` above this?"_

### Why this is in this doc

The deeper principle: **dependency arrays are causality declarations; type assertions are claims to the reader.** The comment makes the implicit claim explicit. A `useMemo` without commentary is the author whispering "trust me, this is worth caching"; a `useMemo` _with_ commentary is the author saying "here's the contract — this depends only on X, and the cost of recomputing it on every render would be Y."

The first leaves the next reader to reconstruct the reasoning. The second locks it in.

## A checklist for adding engine code

When you write or review engine code, run through this list:

- [ ] Does any new state shape have a `kind` discriminator? If it's a finite, mutually exclusive set, it should.
- [ ] Is every `switch` on a discriminated union exhaustive (ends with `const _: never = ...`)?
- [ ] Did I introduce any `T | null` / `T | undefined` that could be a discriminated union instead?
- [ ] Are array fields typed as `ReadonlyArray<T>`?
- [ ] Are object fields wrapped in `Readonly<...>` (or do they already have `readonly` modifiers)?
- [ ] Did I use any of the mutating array methods (`push`, `splice`, `sort` in place)?
- [ ] Did I introduce `any`? (Search for it before committing.)
- [ ] If I added a new event kind / char state / cursor variant, did the compiler force me to handle it everywhere? If not, an `exhaustive` check is missing somewhere.
- [ ] Does every escape hatch (`useMemo`, `useEffect`, `as`, `!`, `eslint-disable`) carry a one-line "why" comment immediately above it?
- [ ] Are boolean React props named with an `is*` or `has*` prefix? (`isClozeRun`, not `clozeRun`; `isAutoCloze`, not `autoCloze`.) The xo `react/boolean-prop-naming` rule enforces this and the gate will fail without it.

## See also

- [engine-design.md](engine-design.md) — the event-sourced architecture these conventions support.
- [scenarios.md](scenarios.md) — the test cases that exercise the engine these conventions help make correct.
- [../CLAUDE.md](../CLAUDE.md) — project-level validation workflows; the "type-level invariants" entry there cross-references this doc.
