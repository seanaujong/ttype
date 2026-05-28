# ttype

A type-racer for your terminal. Drill on the text you actually read — prose, source files, git commits, PRs, and diffs — all through one engine. Built on [Ink](https://github.com/vadimdemedes/ink).

It handles the awkward parts of real text: tabs, wide characters (CJK, emoji), and accented letters all render and type correctly; diff markers and indentation are shown but never typed.

## Install

ttype isn't published to npm — install it from a local clone:

```bash
npm install   # installs dependencies and builds dist/ (the prepare script runs the build)
npm link      # symlinks `ttype` onto your PATH
```

`npm link` symlinks the package globally; undo it later with `npm rm -g ttype`.

## Usage

```bash
ttype path/to/essay.txt    # race a file
ttype source/app.tsx       # ...source included — tabs and wide chars are handled
cat notes.md | ttype       # or pipe via stdin
git show HEAD | ttype      # a commit
git diff | ttype --split   # a diff, two-column: typed (+) left, reference (-) right
ttype --cloze essay.txt    # after the run, re-drill the words you fumbled
```

Diff rendering is automatic for `.diff` / `.patch` files; `--diff` forces it and `--split` implies it.

With `--cloze`, finishing a run re-drills the words you fumbled (slowest + most-mistyped) as fill-in-the-blanks — or press `c` on the results screen to start that re-drill after any run.

### Controls

- **Type** to race — correct characters turn green, mistakes red.
- **Tab** / **Shift+Tab** — before you start, skip to the next / previous chunk (paragraph, diff hunk, …).
- **Esc** — restart the run.
- **`c`** (on the results screen) — re-drill the words you fumbled as fill-in-the-blanks; `--cloze` does it automatically.
- **Ctrl+C** — quit.

## Develop

```bash
npx tsx source/cli.tsx <args>   # run straight from source, no build step
npm run dev                     # tsc --watch
npm test                        # prettier + xo + ava
npm run fix                     # auto-format, then lint-fix
```

See [docs/](docs/) for the architecture and design notes.
