# ttype design docs

Living design docs for ttype. Read in this order if you're new:

1. **[use-cases.md](use-cases.md)** — what people actually use ttype for. Five concrete walkthroughs, each tied to a goal it validates.
2. **[typing-feel.md](typing-feel.md)** — how the act of typing should feel. The principles: chill, whitespace rendered but not required, errors stay local, correction is cheap.
3. **[scenarios.md](scenarios.md)** — frame-by-frame walkthroughs of how the engine responds to keystrokes. The principles from `typing-feel.md`, made concrete. These become unit tests / fixtures.
4. **[review.md](review.md)** — what happens after a run. Not a scoreboard; a short review surface for content reflection and typing habits.
5. **[architecture.md](architecture.md)** — high-level layer map. Adapter → React shell → pure modules. Where everything fits and how data flows.
6. **[engine-design.md](engine-design.md)** — the engine architecture (event-sourced, replayable, framework-agnostic) that makes everything above possible.
7. **[rendering.md](rendering.md)** — the renderer layer. Semantic chunking, viewport policy, layerable source-kind-aware overlays. What turns engine state into a terminal frame.
8. **[testing.md](testing.md)** — testing layers. Reducer unit tests, replay fixtures, and integration/flow tests (the TUI harness + viewport geometry guard + cloze flow); what each layer covers and what it doesn't.
9. **[ts-conventions.md](ts-conventions.md)** — TypeScript patterns for making illegal states unrepresentable and keeping the engine pure (discriminated unions, exhaustiveness, `readonly`, branded types, no mutation).

Project-level goals and commands live in [../CLAUDE.md](../CLAUDE.md).

## Documentation conventions

- **Each doc opens with an "At a glance" abstract** — bulleted summary of the main items so a reader can skim in 10 seconds.
- **Section headings are unnumbered and named descriptively** — `## Chill > strict`, not `## Principle 1 — Chill > strict`. The abstract is the TOC; section names are the stable interface.
- **Cross-references are by name, never by position** — _"the self-hosting goal"_, not _"goal 4"_; _"the cross-line backspace scenario"_, not _"Scenario 7"_. This makes inserts/reorders cheap. If a referenced section doesn't have a clean name, that's a signal the name needs work.
- In-paragraph enumerations of steps inside a single section can still use 1/2/3 — those aren't section headings and nothing else references them.
