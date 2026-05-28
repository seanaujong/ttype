# Word-aware engine — an idea explored, not built

This doc captures a design the project considered and rejected after using the simpler alternative. It's preserved as a reference, not a roadmap. The current engine is flat-cursor — see the other design docs for what's actually implemented.

## The problem it tries to solve

Flat-cursor engines have a known weakness: **insertion drift**. The cursor is a single index into the source. If the user types an extra character that wasn't expected at that position, the cursor advances by one anyway. Every subsequent expected character is now off-by-one against the source. The user sees a cascade of red — not because they kept making mistakes, but because one mistake shifted the comparison frame.

Example. Source: `hello world`. User types `helllo` (one extra `l`).

- `h` ✓ → cursor 1
- `e` ✓ → cursor 2
- `l` ✓ → cursor 3
- `l` ✓ → cursor 4 (we're at source's `o` now, but the user typed `l`)
- `l` ✗ — source expects `o`. Cursor 5.
- `o` ✗ — source expects ` ` (space). Cursor 6.
- ...and so on through the rest of the line.

The whole tail of the line lights up red until the user notices, backspaces, and corrects. The cost of one inserted keystroke is unbounded — it pollutes the rest of the line.

## The proposed model

Make the cursor **word-relative** instead of an absolute index. Each word is its own context; **whitespace is a sync point** that resets the cursor to the start of the next word regardless of what happened inside the previous one.

The cursor state becomes:

```ts
type Cursor = {
	wordIndex: number; // which word we're on
	charIndexInWord: number; // how far into that word
	extras: string[]; // chars typed past the word's end
};
```

Each keystroke is interpreted against the **current word**, not against the source's next character:

- Type the right char at `charIndexInWord` → advance.
- Type a wrong char → mark wrong, advance.
- Type past the word's last char → push into `extras` (overflow, not advance).
- Type a **whitespace key** (space, Enter, tab) → close the current word, jump to the next word at `charIndexInWord = 0`. Un-typed chars in the previous word are auto-marked missed.
- Backspace within a word → retreat `charIndexInWord` or pop the last extra.
- Backspace from the start of a word → reopen the previous word at its last position; auto-missed marks revert to untyped.

Net effect: drift from one bad keystroke is bounded to one word, not the whole line. Type `helllo `, the engine resets at the space, and `world` starts fresh against the right source chars.

## What "word" means

Whitespace-delimited tokens as a v1 default. Adapters could refine later (a code adapter splitting on operators, a diff adapter splitting on `+`/`-`/` ` line markers).

The engine doesn't define "word" — the adapter passes the boundaries in along with the text.

## The rendered display — two lines per word

The visual change was a column-aligned two-line per-word diff view between source and typed:

- **Mainline** — what the user actually typed, character by character. Correct chars normal; any char that diverges from source (wrongs and extras) struck-through in red. The above-line disambiguates which category each strike is.
- **Above line** — what the user was supposed to type at each column where the mainline disagrees. Correctly-typed columns are blank above. The source line ends at the word's length; columns past that on the mainline have no above-line counterpart — that's how the reader tells extras from wrongs.
- **Above-line color** — a quiet "reference" color (dim cyan, muted yellow). Not green or red, since those carry "correct" / "wrong" meaning on the mainline.

Example. Source: `Hello`. User typed: `Hxxxllo` (7 keys: `H` correctly, then `xxx` instead of `ell`, then `l` instead of `o`, then `lo` as extras).

```
 ello
Hxxxllo
```

Reading by column:

- col 0: above blank, main `H` — correct.
- cols 1–3: above shows `ell` (expected), main shows `xxx` struck-through — three wrongs.
- col 4: above shows `o`, main shows `l` struck-through — wrong at the last source position.
- cols 5–6: no above (source ended at col 5), main shows `lo` struck-through — extras past the end of `Hello`.

A perfectly typed word renders with the above-line completely blank, so the two-line display collapses to one line for clean stretches. Divergence is what makes the above-line appear.

## Why we didn't build it

Dogfooding the flat-cursor engine surfaced a different reality than the design assumed:

- **The cascade is visually obvious and quickly corrected.** Red lights up; the user backspaces; the line is fine. The "rest of the line is red" state lasts seconds, not minutes. Human perception is faster than typing.
- **The flat-cursor model feels like typing.** Users have decades of muscle memory for "type, see mistake, backspace, retype." Adding "whitespace auto-resets your context" is editor magic that interrupts that flow.
- **The two-line per-word display is visually busy.** It introduces chrome that competes with the source text. The clean-stretches collapse is nice in theory, but in practice users often _want_ to see exactly what they're matching against — and the source line above the typed line works against that.
- **Industry convention agrees.** Monkeytype's default (advance-through-errors, single-line display) is the dominant pattern in modern type racers, and it's close to what ttype does today.

The cost of building word-aware was high (engine state shape changes, more reducer cases, two-line rendering, fixture format updates). The benefit was theoretical — solving a problem users notice and correct themselves.

## What would change if we revisited

The boundary is preserved enough that a future revisit isn't from-scratch work:

- The engine is its own module with a state-machine shape. Swapping it for a different state shape is contained.
- The renderer reads engine state through hooks rather than touching state fields directly in JSX. Those hooks would be the porting surface.
- The chunker and adapter layers are unaffected — words are an engine concept, not a chunker concept.

The work would be: rewrite the engine module against a new state shape; rewrite the test fixtures; rewrite the four hooks in `app.tsx` against the new state queries; rewrite the per-line render loop as a per-word render loop. ~3-4 focused sessions if motivated.

## What stays from this design

A few ideas from the word-aware exploration are still useful and survived in the current implementation:

- **Whitespace as cosmetic vs. content distinction.** The flat-cursor engine implements "render the structure, require the content" — leading whitespace, blank lines, and tabs are displayed but skipped from the typing path. That's the most useful slice of the word-aware idea, without the word-relative cursor.
- **No-penalty backspace.** Backspace is the user's drift recovery mechanism. It works seamlessly and doesn't count against accuracy.
- **Lenient accuracy.** Final-state-based; backspaces don't hurt your score. Both engines would compute this the same way.

The flat-cursor engine doesn't need word-aware to feel chill — those properties stand on their own.

## Word-awareness without a word-aware engine

The word-aware engine was originally motivated by two things: bounded drift _during_ typing, and per-word analysis _after_ typing (slow words, mistyped words, hardest letter pairs in a word, etc.).

The first motivation evaporated when dogfooding showed users handle drift themselves. The second motivation doesn't actually require an engine-level concept of "word" at all.

**Post-hoc word analysis can be derived from the event log alone.** A review function takes `{text, actions}`, walks the text to find word boundaries (whitespace-delimited tokens, or whatever definition is useful), buckets the keystrokes into those boundaries, and computes per-word stats. The engine never has to know.

```ts
function analyzeByWord(text: string, actions: Action[]): WordStats[] {
	// 1. Find word boundaries in text by whatever rule (whitespace-delimited, ...).
	// 2. For each keystroke action, determine which word's range it fell in.
	// 3. Aggregate timing, accuracy, etc. per word.
	// 4. Return WordStats[].
}
```

Same shape as the engine reducer — a pure fold over the log — just computing a different summary. This is the **review = second fold** pattern: same data, different aggregation.

So word-awareness as an analytical concept lives in the review layer, not the engine. The engine stays simple; richness lives in downstream consumers. This is a clean architectural separation that the original "make the engine word-aware" design conflated.

**This is now concretely realized.** `source/review.ts` implements `analyzeByWord`, `slowestWords`, and `mostMistypedWords` as pure post-hoc folds over the engine's event log — no engine changes required. The cloze feature (`clozeBlanks` in `review.ts`) builds directly on those word stats: it selects the fumbled positions and re-scopes `typeableIndices` to them for the fill-in-the-blank re-drill. The engine never learned what a word is. The entire "word" concept lives in `review.ts` and was exercised through `--cloze` without a single change to the engine state machine.
