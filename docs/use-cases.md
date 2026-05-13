# ttype use cases

Concrete walkthroughs of how someone uses ttype. We start here — before any engine code, before any type definitions — because **user flows are the cheapest test of design correctness**. If the architecture we have in mind can't comfortably express what someone trying to do X would actually do, the architecture is wrong, and we'd rather find that out from a one-page walkthrough than after writing it.

Each case names the **goal** in [../CLAUDE.md](../CLAUDE.md) it validates and the **open questions** it surfaces. Together they anchor every downstream decision (in [engine-design.md](engine-design.md), [typing-feel.md](typing-feel.md), and the rest) back to concrete user behavior.

## At a glance

- **Smoke — built-in sample** — `ttype` with no args; engine runs end-to-end over a built-in paragraph.
- **Type an essay or article from a file** — `ttype path/to/essay.txt`; the file adapter doesn't require engine changes.
- **Type from stdin** — `curl ... | ttype`, `cat ... | ttype`; identical engine state to the file case.
- **Type a git diff, commit, or PR** — `git diff | ttype`; engine doesn't know what a diff is; `--diff` rendering is a future additive layer.
- **Type a whole source file** — `ttype source/app.tsx`; exposes tabs / trailing whitespace / long lines / non-printables. Also the **dogfood** entry point for the *self-hosting* goal.

## Smoke — built-in sample

You just installed ttype, or you launched it to mess around.

```
$ ttype
```

The app loads a short built-in paragraph and drops you into typing immediately.

```
The quick brown fox jumps over the lazy dog. Pack my box with
five dozen liquor jugs. How vexingly quick daft zebras jump!
^
```

- Already-typed text is green (correct) or red (wrong).
- A caret (or styled background) marks the next character.
- `esc` quits.

End-of-run review (see [review.md](review.md) — not a score, feedback for next time):
```
done in 18.4s

slowest spots:  "vexingly", "daft zebras", "liquor jugs"
typos:          fixed 3 · 0 remain
skipped:        0 chars

<enter> retry · <r> review in detail · <q> quit
```

**Validates:** the engine works end-to-end with zero adapters wired in. If we can't get this working, nothing else matters.

## Type an essay or article from a file

For drilling on a piece of writing you want to internalize.

```
$ ttype ~/notes/paul-graham-makers.txt
```

Identical screen to the *smoke* case — only the text source changed. Long text wraps to terminal width and the view scrolls as you progress.

**Validates the general-purpose engine goal:** adding file input must not require engine changes. If it does, the boundary between "engine" and "adapter" is leaking.

## Type from stdin

For piping in anything: `curl`, `cat`, `pbpaste`, `git`, `gh`.

```
$ curl -s https://example.com/essay.txt | ttype
$ cat src/lib/parser.ts | ttype
$ pbpaste | ttype
```

Behaviorally identical to the *file* case. Just a different adapter feeding the same engine.

**Validates the general-purpose engine goal from the other side:** `ttype foo` and `cat foo | ttype` should produce the same in-engine state. If they don't, an adapter is doing too much (or too little).

## Type a git diff, commit, or PR

For learning a monorepo by typing through its changes.

```
$ git diff main | ttype
$ git show HEAD | ttype
$ gh pr diff 1234 | ttype
```

In the v1 plain renderer, **every character of the diff is part of the text to type** — including `+`, `-`, ` `, and `@@` hunk markers. That's intentional: the engine doesn't know what a diff is, and we want to keep it that way.

A later `--diff` flag (the *layerable rendering* goal) layers diff-awareness on top of the plain renderer: dim hunk headers, color `+`/`-` lines, optionally auto-skip the leading marker so you only type the *content* of changed lines. None of that requires engine changes — that's the whole point.

**Validates the layerable rendering goal** — but only when we add the `--diff` layer later. For now, this case just exercises the general-purpose engine with messy input.

**Open question:** should the `--diff` layer auto-skip line markers (`+ `, `- `, ` `)? That changes how an "advance cursor" rule needs to be defined in the engine — it can't be hardcoded to "advance by 1 char" if a renderer wants to skip ranges. Worth deciding before we lock the engine API.

## Type a whole source file

Mechanically the same as the *file* or *stdin* cases, but the *content* exposes UX decisions that prose doesn't.

```
$ ttype source/app.tsx
$ cat src/lib/parser.ts | ttype
```

Things that come up:
- **Tabs:** is a tab one keystroke, or expanded to N spaces?
- **Trailing whitespace / blank lines:** part of the drill, or stripped?
- **Very long lines:** wrap, truncate, or horizontal-scroll?
- **Non-printable characters:** how do we render (and require typing of) things like CRLF, BOM, or unicode that the user can't easily input?

These decisions live in the engine's data shape, so we want them settled before we write `type Engine = ...`.

**Dogfood note:** this case has a privileged role — it covers typing through *this very repo's* `.tsx`, markdown, and diff output. See the *self-hosting* goal in [../CLAUDE.md](../CLAUDE.md). If `ttype source/app.tsx`, `cat docs/typing-feel.md | ttype`, and `git show HEAD | ttype` don't all feel right, the engine isn't done.

## Open questions to settle before coding

A consolidated list — we don't need final answers on all of these today, but the answers shape the engine's types:

- **Tabs:** one keystroke or expanded to spaces?
- **Trailing whitespace / blank lines:** keep, or strip on adapter ingestion?
- **Scrolling:** when does the view advance — cursor hits last visible line, middle, somewhere else?
- **Strict vs. lenient mistakes:** must you fix a wrong character before continuing, or can you keep going (counted against accuracy)?
- **End-of-run summary:** WPM, accuracy, elapsed time is baseline. Anything else? (Per-char error breakdown, slowest words, retry-from-mistake?)
- **No-arg invocation (`ttype`):** built-in sample, read stdin if piped, or print `--help`?
- **Diff-layer cursor skipping:** can a renderer ask the engine to treat a range as "display but skip"? If yes, that becomes part of the core API.

## Non-goals (for now)

Calling these out so we don't accidentally creep:

- Multi-player / networked racing.
- Persistent stats across sessions / leaderboards.
- Custom themes / config files.
- Syntax highlighting in v1 (the `--diff` renderer is the first taste of source-aware decoration; syntax highlighting can come after if we still want it).
