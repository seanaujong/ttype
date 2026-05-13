# Kotlin/Android → TypeScript/React translation guide

A reference for mapping the things we're building in ttype to concepts you already know from Kotlin/Android. Skim or search; this is a lookup table, not a tutorial.

## The big idea

The pieces of TS/React we use look surprisingly similar to Kotlin/Android, especially if you've used Jetpack Compose (which was inspired by React) or followed developer.android.com's architecture guide. The two largest *real* differences:

1. **Structural typing.** In TS, types are equivalent if their shapes match. A function that takes `{ name: string }` accepts *anything* with a `.name` field. The opposite of Kotlin's nominal typing — and the reason we use **branded types** (`type TypeableIndex = number & { __brand: ... }`) when we need a number to be specifically *the kind of number it claims to be*.
2. **Opt-in strictness.** Kotlin enforces null-safety, exhaustive `when`, and `val` immutability by default. TS gives you the equivalents — but most require strict compiler flags and conventions on top. The defaults are loose. We've turned the dials up; see [ts-conventions.md](ts-conventions.md).

And one big difference in *culture*, separate from the language:

3. **React doesn't have a prescribed architecture.** developer.android.com gives you a recommended layered structure (UI → Domain → Data, ViewModel exposing `StateFlow<UiState>`, repositories, etc.). React doesn't. The community has many opinions (Redux, Zustand, Context+Reducer, custom hooks, react-query, RTK Query…), and "what the right pattern is" depends on the project. For ttype we're picking one — the event-sourced engine — and sticking to it.

## How a TS/React dev actually thinks (vs. translating from Android)

The translation tables further down let you read TS through Kotlin-shaped glasses, which is great for getting bearings. But a working TS/React developer doesn't write code by "translating from Android." Their instincts are genuinely different. Worth knowing what those instincts are — both so you can choose to follow them and so you can choose *not* to with full information.

### Start small, refactor when state pressure justifies it

An experienced React dev would not start ttype by designing layers. They'd write a single component with `useState` for the cursor, an event handler, and a render — total maybe 80 lines. *Then,* when state pressure makes that ugly (the engine logic gets non-trivial, or they want tests independent of Ink), they'd extract a `useReducer`, then a custom hook, then a pure engine module.

This isn't laziness — it's a real cultural value. The phrase you'll see is **"YAGNI" — you aren't going to need it.** React devs are highly allergic to building layers speculatively. Repositories, services, use-cases, dependency-injection containers: a TS dev would write the underlying function and reach for an abstraction only when it pays for itself.

For ttype, we *are* building the layered structure up front, because (a) the event-sourced engine has a hard correctness bar and (b) this is a learning project where seeing the layers is the point. But the typical TS-native instinct would be to inline-everything and refactor outward.

### Hooks are the unit of reuse, not classes

The mental model shift: where Kotlin/Android reuses behavior via classes (a `ViewModel`, a `Repository`, a base class with overrides), React reuses behavior via **custom hooks**. A custom hook is just a function whose name starts with `use` and that calls other hooks.

```ts
function useEngine(text: string) {
  const [state, dispatch] = useReducer(applyEvent, initialState(text));
  return { state, onEvent: dispatch };
}
```

That's roughly equivalent to a Compose ViewModel exposing `StateFlow<UiState>` + `onEvent`, but it's a *function*, not a class, and it has no lifecycle annotations. A TS dev doesn't ask "should I make a class?" — they ask "should I extract a hook?"

### Plain objects are the canonical data structure

Kotlin/Android devs reach for `data class` for any structured value. TS devs reach for a `type` and an object literal. There's no wrapper class. The shape *is* the type. This pairs with structural typing — anything with the right shape *is* that type.

Practical consequence: you'll see almost no `class` keyword in idiomatic TS code. The handful of places you do see it are usually framework boundaries (Error subclasses, sometimes React class components in legacy code).

### Pure middle, effectful edges

A TS dev separates pure logic from side effects more aggressively than Android coroutines tend to encourage. The pattern: pure functions in the middle of your code; effects (`useEffect`, async fetches, I/O) at the edges. The engine is pure (`applyEvent`); the React component bridges it to the keyboard and the screen; the adapters bridge it to the filesystem.

The cultural reason: pure functions are trivially testable and trivially reasoned-about; effects aren't. So you push them as far out as possible.

### The type/runtime boundary is something you actually think about

In Kotlin, your types are part of the language and persist to runtime (sort of — there's erasure, but the experience is "types are real"). In TS, types **erase entirely at runtime**. `JSON.parse(...)` returns `any` (or `unknown` if you're careful), and there's no compiler check that the JSON matches your `type`.

A TS dev's instinct: when data crosses the runtime boundary (parsing JSON, reading from disk, receiving network responses, accepting user input), **validate it**. The standard tool is a runtime schema library like **Zod**:

```ts
import { z } from 'zod';

const SessionFile = z.object({
  text: z.string(),
  events: z.array(z.object({ kind: z.string(), char: z.string().optional(), t: z.number() })),
});

const session = SessionFile.parse(JSON.parse(raw)); // throws if shape is wrong; types `session` correctly
```

We'll probably want this when we add session persistence in [engine-design.md](engine-design.md). The instinct here — "types are great inside the program; at the edges, validate" — is a strong TS-dev reflex.

### Side effects use `useEffect`, and that's all the lifecycle there is

Android has `onCreate`, `onStart`, `onResume`, `onPause`, `onStop`, `onDestroy`, and the various Compose effect APIs (`LaunchedEffect`, `DisposableEffect`, `SideEffect`, `rememberCoroutineScope`). React has *one* primitive: `useEffect(fn, deps)`. The function runs after render; the optional return value runs before the next run (cleanup).

That's it. There's no separate "mount" vs. "resume" lifecycle. The simplicity is genuine, but the trade-off is that you have to think carefully about dependency arrays. TS devs internalize this quickly; Android devs sometimes find the lack of explicit lifecycle hooks disorienting.

### Folder structure by feature, not by layer

The Android guide encourages `ui/`, `domain/`, `data/` directories. A typical TS/React project organizes by **feature**: `features/type-racer/`, `features/review/`, `features/adapters/`. Inside a feature, you might have `engine.ts`, `component.tsx`, `types.ts`, but they live together.

This is partly because React projects often start small (no need for layers) and grow by adding features (not by deepening layers). For ttype, we'll likely follow this — a `source/engine/`, `source/adapters/`, `source/review/`, `source/components/` mix that's more feature-shaped than layer-shaped.

### Less prescription, more libraries

Where Android tells you "use `ViewModel` and `Repository`," TS culture says "pick a state library that fits": Redux Toolkit for large apps with complex state, Zustand for small apps with shared state, plain hooks for component-local state, react-query/SWR for server state. Each library has strong opinions inside its scope, but the *choice* of library is yours.

For learning purposes, the takeaway: when you read TS/React code in other repos, don't assume any one shape. Three React apps might have wildly different state-management approaches and both be "correct." The skill is reading the patterns from context, not from a guide.

### So what does ttype look like through the TS-native lens?

If we were *strictly* TS-native and not borrowing the Android layered shape, ttype might be:

- A single `useReducer` in the root component with a `(state, event) => state` reducer (which is `applyEvent`, but inlined into the component).
- Adapters as plain async functions, not "the data layer."
- No separate "engine module" — the reducer just lives next to the component.
- Review as a sibling component reading the same event log.

That would be smaller and arguably more idiomatic. The reason we're choosing the layered shape instead:

- The engine needs to be testable without Ink (validation workflow in [../CLAUDE.md](../CLAUDE.md)). That forces extraction.
- The event log needs to be portable across sessions (replayability). That forces a clear data contract.
- This is a learning project — surfacing the layers is the point.

So: we're *informed by* the developer.android.com architecture because it's familiar and the layered shape buys real things here. But it's a deliberate choice, not the only TS-native answer.

## Type system

### Sealed classes ↔ discriminated unions

Kotlin:
```kotlin
sealed class CharState {
  object Untyped : CharState()
  data class Correct(val typedChar: Char) : CharState()
  data class Wrong(val typedChar: Char) : CharState()
  object AutoMissed : CharState()
}
```

TypeScript:
```ts
type CharState =
  | { kind: 'untyped' }
  | { kind: 'correct';     typedChar: string }
  | { kind: 'wrong';       typedChar: string }
  | { kind: 'auto-missed' };
```

The `kind` literal field is the manual equivalent of Kotlin's sealed-class discriminator. Same idea, slightly more ceremony.

### `when` (exhaustive) ↔ `switch` + `never` check

Kotlin's `when` as an *expression* must be exhaustive — the compiler enforces it. TS doesn't enforce exhaustiveness in `switch`, so we add a manual `never` assertion (pattern 2 in [ts-conventions.md](ts-conventions.md)). Same end-state: add a new variant later → compiler errors at every switch that missed it.

### Null safety

| Kotlin | TypeScript |
| ------ | ---------- |
| `String?` | `string \| undefined` (or `string \| null`) |
| `x?.foo` | `x?.foo` (same syntax) |
| `x ?: default` | `x ?? default` |
| `x!!` | `x!` |
| Forced by default | Requires `strict: true` |

Practical advice: in the engine, prefer a discriminated union over a nullable. `Cursor = { kind: 'at' } | { kind: 'done' }` is better than `Cursor = number | null` because each variant can carry its own data.

### `val` / `var` / immutability

| Kotlin | TypeScript |
| ------ | ---------- |
| `val x = 5`        | `const x = 5` |
| `var x = 5`        | `let x = 5` |
| `List<T>`          | `ReadonlyArray<T>` |
| `MutableList<T>`   | `Array<T>` (or `T[]`) |
| `val foo: List<T>` | `readonly foo: ReadonlyArray<T>` |

A subtlety from both languages: `val list = mutableListOf(...)` rebinds the reference immutably but the contents are still mutable. TS is identical — `const arr = []` doesn't stop `arr.push(...)`. Use `ReadonlyArray<T>` to actually block mutation.

### Data classes ↔ object types

`data class Event(val kind: String, val char: Char, val t: Long)` gives you `equals`, `hashCode`, `copy`, destructuring for free.

TS doesn't have data classes. You write a plain object type:
```ts
type Event = { kind: 'input'; char: string; t: number };
```

What you get for free:
- **Destructuring** — `const { char, t } = event`.
- **Copy with overrides** — `const next = { ...event, t: event.t + 1 }` is Kotlin's `.copy()`.

What you don't get for free:
- **Structural equality.** `a === b` is *reference* equality. For deep equality, write/import one.
- **Hashing.** No built-in.

For ttype we don't compare states for equality, so this doesn't bite us. Know it's there.

### Value classes ↔ branded types

Kotlin's `@JvmInline value class TypeableIndex(val n: Int)` is zero-cost at runtime *and* nominally typed. TS doesn't have this. The closest is a **branded type**:

```ts
type TypeableIndex = number & { readonly __brand: 'TypeableIndex' };
```

Trade-off vs. Kotlin: zero runtime cost ✓, but you can `as` past it (`5 as TypeableIndex` compiles). Use smart constructors as the only legitimate way to create one and trust by convention. Kotlin's compiler enforces; TS asks you to follow the rule.

### Extension functions

No clean TS equivalent for `fun String.shoutyCase(): String = ...`. The closest is a standalone `shoutyCase(s: string): string`. Tolerable, just more verbose at call sites.

### Type aliases

Same in both — `typealias` in Kotlin, `type` in TS.

## UI — React vs. Compose

If you've used Compose, **React's mental model will feel very familiar**. Compose was inspired by React. The vocabulary differs; the model is the same.

| Compose | React |
| ------- | ----- |
| `@Composable fun Greeting(name: String)` | `function Greeting({ name }: { name: string })` |
| `remember { mutableStateOf(...) }` | `useState(...)` |
| `LaunchedEffect(key) { ... }` | `useEffect(() => { ... }, [key])` |
| `derivedStateOf { ... }` | `useMemo(() => ..., [deps])` |
| `key(value) { ... }` | `<Foo key={value} />` |
| Recomposition | Re-rendering |
| State hoisting | "Lift state up" |
| Unidirectional Data Flow | Unidirectional data flow |

Two real differences:

1. **Dependency arrays.** Compose tracks reads automatically via its snapshot system — if your `derivedStateOf` reads a state value, that read is tracked. React requires you to **explicitly list dependencies** in `useEffect`/`useMemo`. This is the #1 source of subtle React bugs: forget a dep → stale closure → confusion. There's an ESLint rule (`react-hooks/exhaustive-deps`) that catches most; we'll have it on.
2. **JSX.** Compose UI code is just Kotlin (`Text("hello")`). React UI is **JSX** — looks like HTML inside your TS file (`<Text>hello</Text>`). It compiles down to plain function calls (`Text({ children: 'hello' })`). Visual difference, no semantic one.

**Ink specifically:** ttype uses Ink, not React DOM. Ink renders React components to the terminal. So `<Text>`, `<Box>`, `<Newline>` etc. come from `ink`, not from any DOM. Mental model is identical to web React.

## Architecture — developer.android.com guide ↔ standard TS/React

developer.android.com's recommended app architecture (the "Guide to app architecture") is well-defined and prescriptive:

- **UI Layer** — Composables + a ViewModel that holds `StateFlow<UiState>` and accepts events from the UI.
- **Domain Layer** (optional) — UseCases that wrap repository logic.
- **Data Layer** — Repositories backed by data sources (network, DB, etc.).
- **Unidirectional Data Flow** — state flows down from ViewModel to UI; events flow up via callbacks.
- **State as immutable data.** UiState is a `data class`; updates produce a new value, never mutate.
- **Single source of truth** for each piece of state — usually in the repository or ViewModel.

The React world doesn't have *one* official architecture. It has *patterns* the community converges on, each loosely mapping to a Google layer:

| developer.android.com | Standard TS/React equivalent |
| --------------------- | ---------------------------- |
| Composable + ViewModel | Function component + custom hook owning `useState`/`useReducer` |
| `StateFlow<UiState>`   | A React `useState`/`useReducer` value, or an external store (Zustand, Redux, Jotai, Valtio). For *shared* state you reach for an external store; for *local* state, hooks. |
| Sending events via `viewModel.onEvent(...)` | Calling a function returned by the hook: `const { onEvent } = useEngine();` |
| Immutable `data class` for UiState | TS `Readonly<{...}>` with `ReadonlyArray<...>`; spread-update to produce new state |
| Unidirectional Data Flow | Same name, same idea — state down via props, events up via callback props |
| Repository (suspending functions over data) | Either a plain module of async functions, or a hook layer like react-query / SWR / RTK Query |
| UseCase | Usually skipped in React; sometimes a custom hook or a plain function |
| Single source of truth | Same principle. In React, the *location* of the truth is the design choice — local component, custom hook, context, or external store. |

**The key cultural difference:** Google's guide *prescribes* the shape (ViewModel + StateFlow + Repository) for almost every app. The React equivalent is a *set of options* you pick from based on app complexity. A common rule:

- **Local-only state** → `useState` in the component, hoist up only when needed.
- **State shared across distant components** → `useReducer` + `Context`, or an external store (Zustand for small, Redux Toolkit for large).
- **Server state** → react-query / SWR (do not put server data in component state).

### What ttype's architecture looks like in this framing

We've picked a very specific shape that maps almost 1:1 onto the Google guide:

| Google layer | ttype piece |
| ------------ | ----------- |
| UI Layer (Composable) | React/Ink components in `source/` |
| ViewModel | The engine module — owns `State`, exposes `applyEvent` |
| UiState                | `type State = Readonly<{ text, typeableIndices, cursor, charStates }>` |
| UI Events              | `type Event = { kind: 'input', ... } \| { kind: 'backspace', ... } \| ...` |
| StateFlow<UiState>     | A single `useReducer`'d value (or `useState` if we don't need a reducer wrapper) |
| Repository / Data Layer | The adapter modules (file, stdin, git) — produce text |
| UseCase                | Not needed; adapters are thin enough |

So the "UDF triangle" looks identical:

```
  Adapter ──► Engine state ──► React components (render)
                  ▲                    │
                  └────── Event ───────┘
                       (user input)
```

State flows down (engine state → component props); events flow up (user keypress → engine event). The engine is the ViewModel; the React component is the Composable; adapters are the data layer. The whole event-sourced architecture in [engine-design.md](engine-design.md) is essentially "Google's app guide + a persisted event log."

### What's different in practice

- **No `StateFlow`.** React doesn't have a built-in observable-state primitive analogous to Flow. The component re-renders when `useReducer`'s state changes — same effect, different mechanism. There's no concept of "hot vs. cold" you need to think about for our use case.
- **Hooks instead of ViewModels.** Where Android wraps state in a `ViewModel` class with a lifecycle, React wraps it in a **custom hook** (e.g., `function useEngine(text: string)`). The hook owns the state and returns `{ state, onEvent }`. Same role, less ceremony.
- **No scoped DI by default.** Android has Hilt; React doesn't have a standard DI story. We mostly pass things as props or import modules. For ttype this is fine.
- **No `Repository` abstraction unless we need one.** Our adapters are plain async functions returning a string. Wrapping them in a "Repository" class would be ceremony for ceremony's sake.

## State management — MVI / ViewModel ↔ event-sourced engine

This is the most useful single analogy for the project. If you've seen the MVI (Model-View-Intent) pattern in Android — or the Google guide's UDF — **that's exactly what we're building**.

| MVI / Redux | ttype |
| ----------- | ----- |
| `Action` / `Intent`       | `Event` |
| `Reducer(state, action)`  | `applyEvent(state, event)` |
| `State`                   | `State` |
| `Store` / `ViewModel`     | The React custom hook holding `useReducer` over `applyEvent` |
| Time-travel debugging via action log | Replayability via persisted event log (see [engine-design.md](engine-design.md)) |

The key insight from event-sourcing — also the heart of MVI — is that **state is derived from events**, not stored independently. State is the result of folding actions over an initial state. We make this explicit by persisting the event log itself.

## Async

| Kotlin coroutines | TypeScript |
| ----------------- | ---------- |
| `suspend fun foo(): T` | `async function foo(): Promise<T>` |
| `coroutineScope { ... }` | (no direct equivalent — structured concurrency is weaker in JS) |
| `Job` / `cancel()` | `AbortController` (clunkier) |
| `Flow<T>` | `AsyncIterable<T>` or RxJS Observables (third-party) |
| `withContext(IO) { ... }` | not really a thing — JS is single-threaded by default |

Honest assessment: **Kotlin's concurrency story is significantly nicer than JS's.** Cancellation is harder, structured concurrency is informal, and you'll occasionally curse the absence of `withContext`. We won't hit much of this in ttype — the engine is fully synchronous; only adapters do I/O, and they're tiny.

## Things to actively watch out for

If your intuition is Kotlin-shaped, these are the things that will trip you up:

1. **`==` is type-coercing equality**, *not* reference equality. `'1' == 1` is `true`. Use `===` (strict) by default; you almost never want `==`.
2. **`null` and `undefined` are *different*.** Conventionally pick one and stick to it; we'll use `undefined` (it's what JS produces by default — missing fields, unset variables).
3. **No primary constructors.** TS classes are more verbose than `data class Foo(val x: Int)`. We barely use classes anyway; functions + object types do most of the work.
4. **No first-class enums (usefully).** TS has `enum` but it has historical baggage; most modern TS uses `as const` arrays + string-literal unions (pattern 8 in [ts-conventions.md](ts-conventions.md)).
5. **Mutability is the default.** You have to consciously opt out via `readonly` / `ReadonlyArray<T>`. Kotlin defaults to `val` / `List`. This catches Kotlin people off guard a lot.
6. **No `inline` / `crossinline`.** Function-passing is fine, just less expressive.
7. **JSX makes `<T>x` mean "start of JSX"**, so you can't write `<T>x` for a type assertion inside `.tsx` files — use `x as T`. You'll trip on this exactly once.
8. **React's dependency arrays are *not* automatic.** Compose tracks reads; React makes you type the deps. Forgot a dep → stale closure. Lean on the ESLint rule.

## See also

- [ts-conventions.md](ts-conventions.md) — the TS patterns we use, with rationale.
- [engine-design.md](engine-design.md) — the event-sourced architecture; the MVI / UDF parallel made concrete.
- [typing-feel.md](typing-feel.md) — what we're building, principles-side.
