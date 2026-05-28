# ttype design docs

Living design docs for ttype, in two tiers: the **canonical reference** (the system as it is) and **research/** (the design-era exploration behind it — kept for rationale, not as current reference).

Each doc stands alone. Inter-doc links live only here, in this index — doc bodies don't cross-link each other (that web is what rots when files move or get renamed). For current behavior, trust the canonical docs and the code.

## Canonical

- **[architecture.md](architecture.md)** — the high-level layer map (adapter → React shell → pure modules), the layer contracts, and the enforced-invariants table. The best single entry point.
- **[rendering.md](rendering.md)** — the renderer layer: semantic chunking, viewport policy, and layerable source-kind-aware overlays (diff / markdown / split view, cloze masking). What turns engine state into a terminal frame.
- **[review.md](review.md)** — what happens after a run: the second fold over the keystroke log (per-word stats + the cloze blank selection). Not a scoreboard.
- **[testing.md](testing.md)** — the test layers: reducer unit tests, replay fixtures, and the TUI harness + flow tests (geometry guard, cloze flow).

## Research (design-era)

Written before or during the build — why decisions were made, some explicitly pre-implementation. Accurate as rationale; defer to the canonical docs and the code for current behavior.

- **[research/use-cases.md](research/use-cases.md)** — the use cases ttype was designed for, each tied to a goal it validates.
- **[research/typing-feel.md](research/typing-feel.md)** — how typing should feel: chill, structure rendered but not required, errors local, correction cheap.
- **[research/scenarios.md](research/scenarios.md)** — frame-by-frame walkthroughs of how the engine responds to keystrokes; these became the replay fixtures.
- **[research/engine-design.md](research/engine-design.md)** — the event-sourced, replayable, framework-agnostic engine architecture.
- **[research/ts-conventions.md](research/ts-conventions.md)** — TypeScript patterns for making illegal states unrepresentable and keeping the engine pure.
- **[research/word-aware-engine.md](research/word-aware-engine.md)** — a word-aware engine, explored and deliberately not built (cloze later realized the idea without it).

Project-level goals and commands live in [../CLAUDE.md](../CLAUDE.md).

## Documentation conventions

- **Docs are self-contained.** Inter-doc links live only in this index; don't cross-link doc bodies or add "See also" sections — that web is what rots on moves and renames.
- **Each doc opens with an "At a glance" abstract** — a bulleted summary so a reader can skim it in 10 seconds.
- **Section headings are unnumbered and named descriptively** — `## Chill > strict`, not `## Principle 1 — Chill > strict`. The abstract is the TOC; section names are the stable interface.
- **Within-doc cross-references are by name, never by position** — _"the self-hosting goal"_, not _"goal 4"_. References to project goals point at [../CLAUDE.md](../CLAUDE.md) by name.
- In-paragraph enumerations (1/2/3 steps inside one section) are fine — those aren't section headings and nothing else references them.
