# ttype use cases

Concrete walkthroughs of how someone uses ttype. We start here — before any engine code, before any type definitions — because **user flows are the cheapest test of design correctness**. If the architecture we have in mind can't comfortably express what someone trying to do X would actually do, the architecture is wrong, and we'd rather find that out from a one-page walkthrough than after writing it.

Each case names the **goal** in [../CLAUDE.md](../CLAUDE.md) it validates and the **open questions** it surfaces. Together they anchor every downstream decision (in [engine-design.md](engine-design.md), [typing-feel.md](typing-feel.md), and the rest) back to concrete user behavior.

## At a glance

- **Smoke — built-in sample** — `ttype` with no args; engine runs end-to-end over a built-in paragraph.
- **Type an essay or article from a file** — `ttype path/to/essay.txt`; the file adapter doesn't require engine changes.
- **Type from stdin** — `curl ... | ttype`, `cat ... | ttype`; identical engine state to the file case.
- **Type a git diff, commit, or PR** — `git diff | ttype`; engine doesn't know what a diff is; `--diff` rendering is a future additive layer.
- **Type a whole source file** — `ttype source/app.tsx`; exposes tabs / trailing whitespace / long lines / non-printables. Also the **dogfood** entry point for the _self-hosting_ goal.
- **Cloze / active recall** — `ttype --cloze <file>` (or press `c` on the results screen); re-drills only the words you fumbled, with the rest of the text shown as dim context — focused recall, not a second full pass.

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

Identical screen to the _smoke_ case — only the text source changed. Long text wraps to terminal width and the view scrolls as you progress.

**Validates the general-purpose engine goal:** adding file input must not require engine changes. If it does, the boundary between "engine" and "adapter" is leaking.

## Type from stdin

For piping in anything: `curl`, `cat`, `pbpaste`, `git`, `gh`.

```
$ curl -s https://example.com/essay.txt | ttype
$ cat src/lib/parser.ts | ttype
$ pbpaste | ttype
```

Behaviorally identical to the _file_ case. Just a different adapter feeding the same engine.

**Validates the general-purpose engine goal from the other side:** `ttype foo` and `cat foo | ttype` should produce the same in-engine state. If they don't, an adapter is doing too much (or too little).

## Type a git diff, commit, or PR

For learning a monorepo by typing through its changes.

```
$ git diff main | ttype
$ git show HEAD | ttype
$ gh pr diff 1234 | ttype
```

In the v1 plain renderer, **every character of the diff is part of the text to type** — including `+`, `-`, ` `, and `@@` hunk markers. That's intentional: the engine doesn't know what a diff is, and we want to keep it that way.

A later `--diff` flag (the _layerable rendering_ goal) layers diff-awareness on top of the plain renderer: dim hunk headers, color `+`/`-` lines, optionally auto-skip the leading marker so you only type the _content_ of changed lines. None of that requires engine changes — that's the whole point.

**Validates the layerable rendering goal** — but only when we add the `--diff` layer later. For now, this case just exercises the general-purpose engine with messy input.

**Open question:** should the `--diff` layer auto-skip line markers (`+ `, `- `, ` `)? That changes how an "advance cursor" rule needs to be defined in the engine — it can't be hardcoded to "advance by 1 char" if a renderer wants to skip ranges. Worth deciding before we lock the engine API.

## Type a whole source file

Mechanically the same as the _file_ or _stdin_ cases, but the _content_ exposes UX decisions that prose doesn't.

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

**Dogfood note:** this case has a privileged role — it covers typing through _this very repo's_ `.tsx`, markdown, and diff output. See the _self-hosting_ goal in [../CLAUDE.md](../CLAUDE.md). If `ttype source/app.tsx`, `cat docs/typing-feel.md | ttype`, and `git show HEAD | ttype` don't all feel right, the engine isn't done.

## Cloze / active recall

For internalizing text — not just measuring speed, but actually remembering what you typed.

After any run you can press `c` on the results screen to launch a cloze re-drill. ttype picks the words you fumbled (the slowest and most-mistyped, identified by the same second-fold analysis that feeds the results panel), then re-scopes the run to just those positions. The surrounding text stays on screen as dim context; each blank renders as `▁` until you type it, at which point it reveals green or red the same way a normal run does. You fill in only the blanks — the cursor skips everything else.

```
$ ttype --cloze ~/notes/paul-graham-makers.txt
```

With `--cloze`, ttype starts with a normal warm-up pass over the full text (it needs that pass to gather slow/wrong data), then automatically drops into the fill-in-the-blank re-drill when the warm-up finishes. No separate step, no flags to juggle.

You can also reach the re-drill from any run — including a _smoke_ or stdin run — by pressing `c` on the results screen:

```
done in 42.1s

slowest spots:  "idempotent", "mutex", "coroutine"
typos:          fixed 5 · 1 remains

<enter> retry · <c> re-drill blanks · <q> quit
```

Pressing `c` remounts the racer with just those fumbled positions as the typeable set. WPM and accuracy in the cloze run measure recall of the blanks specifically.

**Connection to the "internalize the text" motivation:** ttype's goal isn't to clock the fastest WPM — it's to engage with the text deeply enough that it sticks. Cloze makes that explicit: instead of re-typing the whole passage until it's rote, you focus attention on exactly what gave you trouble. The spirit is closer to Anki than to TypeRacer.

**Validates the _general-purpose engine_ goal and the _layerable rendering_ goal together:** cloze is implemented as a pure selection (`clozeBlanks` in `review.ts`) + a `typeableIndices` re-scope + a render flag. The engine is untouched. If realizing cloze had required engine changes, those goals would be violated.

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
- **Cross-session spaced repetition** — decks, scheduling, and persistence that would let ttype track your fumbled words across runs and resurface them on an Anki-style interval. The single-session cloze re-drill (above) is shipped and works; the cross-session layer is a separate, larger project deferred until there's a concrete consumer.
