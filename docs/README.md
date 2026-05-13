# ttype design docs

Living design docs for ttype. Read in this order if you're new:

1. **[use-cases.md](use-cases.md)** — what people actually use ttype for. Five concrete walkthroughs, each tied to a goal it validates.
2. **[typing-feel.md](typing-feel.md)** — how the act of typing should feel. The principles: chill, whitespace rendered but not required, errors stay local, correction is cheap.
3. **[scenarios.md](scenarios.md)** — frame-by-frame walkthroughs of how the engine responds to keystrokes. The principles from `typing-feel.md`, made concrete. These become unit tests / fixtures.
4. **[review.md](review.md)** — what happens after a run. Not a scoreboard; a short review surface for content reflection and typing habits.
5. **[engine-design.md](engine-design.md)** — the engine architecture (event-sourced, replayable, framework-agnostic) that makes everything above possible.
6. **[ts-conventions.md](ts-conventions.md)** — TypeScript patterns for making illegal states unrepresentable and keeping the engine pure (discriminated unions, exhaustiveness, `readonly`, branded types, no mutation).

Project-level goals and commands live in [../CLAUDE.md](../CLAUDE.md).

## Documentation conventions

- **Each doc opens with an "At a glance" abstract** — bulleted summary of the main items so a reader can skim in 10 seconds.
- **Section headings are unnumbered and named descriptively** — `## Chill > strict`, not `## Principle 1 — Chill > strict`. The abstract is the TOC; section names are the stable interface.
- **Cross-references are by name, never by position** — *"the self-hosting goal"*, not *"goal 4"*; *"the cross-line backspace scenario"*, not *"Scenario 7"*. This makes inserts/reorders cheap. If a referenced section doesn't have a clean name, that's a signal the name needs work.
- In-paragraph enumerations of steps inside a single section can still use 1/2/3 — those aren't section headings and nothing else references them.
