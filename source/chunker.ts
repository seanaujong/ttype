import {segmentGraphemes} from './grapheme.js';

export type ChunkKind =
	| 'prose'
	| 'code'
	| 'heading'
	| 'fenced-code'
	| 'comment'
	| 'diff-hunk';

export type Chunk = {
	start: number; // Character offset (inclusive)
	end: number; // Character offset (exclusive)
	label?: string; // Optional — human-readable name
	kind?: ChunkKind; // Optional — see docs/rendering.md "Hybrid documents"
	spans?: Span[]; // Cosmetic ranges within this chunk
};

export type SpanKind =
	| 'diff-add'
	| 'diff-remove'
	| 'diff-header'
	| 'diff-metadata'
	| 'diff-context'
	| 'md-heading-prefix'
	| 'md-list-marker'
	| 'md-quote-prefix'
	| 'md-emphasis-marker'
	| 'md-link-syntax'
	| 'md-code-span'
	| 'md-fence'
	| 'md-comment';

// A region within a chunk that the engine should treat as cosmetic
// (rendered but not in the typing path). Style is a hint for renderer
// decoration; the engine doesn't read it.
export type Span = {
	style: SpanKind;
	start: number; // Character offset (inclusive)
	end: number; // Character offset (exclusive)
};

export type Chunker = (text: string) => Chunk[];

// The default chunker — splits on blank lines (one or more consecutive
// whitespace-only lines). Handles prose well, and code surprisingly well since
// well-formatted code has blank lines between functions.
export const blankLineChunker: Chunker = text => {
	const chunks: Chunk[] = [];
	let lastEnd = 0;

	// Match runs of "newline + blank/whitespace + newline" greedily, so
	// multiple consecutive blank lines collapse into one separator.
	for (const match of text.matchAll(/\n\s*\n/g)) {
		const chunkEnd = match.index;
		if (chunkEnd > lastEnd) {
			chunks.push({start: lastEnd, end: chunkEnd});
		}

		lastEnd = match.index + match[0].length;
	}

	// The final chunk (after the last blank-line separator)
	if (lastEnd < text.length) {
		chunks.push({start: lastEnd, end: text.length});
	}

	return chunks;
};

// Splits unified-diff output into hunks. Lines starting with "@@" delimit
// hunks; metadata before the first @@ becomes one preceding chunk.
export const diffChunker: Chunker = text => {
	// Hunk headers (@@) are the natural chunk boundaries. The text before the
	// first @@ is the file preamble (diff --git / index / --- / +++) — all
	// cosmetic, nothing to type — so it doesn't get a chunk of its own; that would
	// open the run on "chunk 2", as if chunk 1 had been skipped. Fold it into the
	// first hunk by treating the first @@ as a non-boundary, so the run starts on
	// chunk 1 with the preamble shown (dimmed) above the first typed line. Later
	// files' preambles already ride on the end of the preceding hunk's chunk, so
	// only the leading one needs this.
	const hunkStarts = [...text.matchAll(/^@@/gm)].map(match => match.index);
	const boundaries = [0, ...hunkStarts.slice(1)];

	const chunks: Chunk[] = [];
	for (const [i, start] of boundaries.entries()) {
		const end = boundaries[i + 1] ?? text.length;
		if (end > start) {
			chunks.push({
				start,
				end,
				kind: 'diff-hunk',
				spans: computeSpans(text, start, end),
			});
		}
	}

	return chunks;
};

function computeSpans(
	text: string,
	chunkStart: number,
	chunkEnd: number,
): Span[] {
	const spans: Span[] = [];
	const chunkText = text.slice(chunkStart, chunkEnd);
	const lines = chunkText.split('\n');
	let pos = chunkStart;

	for (const [lineIdx, line] of lines.entries()) {
		const isLastLine = lineIdx === lines.length - 1;
		const wholeLineEnd = isLastLine ? pos + line.length : pos + line.length + 1;

		if (line.startsWith('@@')) {
			spans.push({start: pos, end: wholeLineEnd, style: 'diff-header'});
		} else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
			// File-path metadata — must come before the +/- content checks since
			// they share a prefix char.
			spans.push({start: pos, end: wholeLineEnd, style: 'diff-metadata'});
		} else if (line.startsWith('+')) {
			// Added content: the '+' marker AND the line's own indentation are
			// cosmetic — you type the content, not the leading whitespace. Covering
			// the indentation here is what keeps it out of the typeable set; the
			// generic leading-whitespace skip can't, because the '+' is a non-space
			// char at column 0, so the indentation after it isn't "leading." (Without
			// this, a space-indented diff would make you type the indentation; tabs
			// were only spared by the mid-line-tab skip.)
			const afterIndent = line.slice(1).search(/[^ \t]/);
			const markerEnd = afterIndent === -1 ? line.length : 1 + afterIndent;
			spans.push({start: pos, end: pos + markerEnd, style: 'diff-add'});
		} else if (line.startsWith('-')) {
			// Removed content: the entire line is cosmetic. Typing through a diff
			// practices the *new* file; old text isn't part of the result.
			spans.push({start: pos, end: wholeLineEnd, style: 'diff-remove'});
		} else if (line.startsWith(' ')) {
			// Context line: leading space is cosmetic; user types the content.
			spans.push({start: pos, end: pos + 1, style: 'diff-context'});
		} else if (line.length > 0) {
			// Anything else non-blank — `new file mode`, `index ...`, `similarity
			// index`, `rename from/to`, `\ No newline at end of file`, etc. The
			// catch-all is intentional: rather than enumerate every git metadata
			// pattern, treat anything that isn't a known content/header line as
			// metadata.
			spans.push({start: pos, end: wholeLineEnd, style: 'diff-metadata'});
		}

		pos += line.length + 1;
	}

	return spans;
}

// Markdown chunker. Walks lines once, building these chunk kinds:
//   - `heading`   — a single `#…` line; the `#+ ` prefix becomes cosmetic
//   - `fenced-code` — content between ```...``` fences; the fence lines themselves
//     are cosmetic, content inside is typeable as-is (verbatim code)
//   - `comment` — an `<!-- … -->` HTML comment block; the whole block is cosmetic
//     (rendered dim, nothing typed) since the prose inside is editorial, not text
//     you're drilling on
//   - `prose` — blank-line-delimited paragraphs; spans mark `**bold**`,
//     `_italic_`, inline `` `code` ``, link `[`/`](url)` syntax, list markers
//     (`- `, `1. `), and block-quote `> ` prefixes (content stays typeable)
//
// Common-case markdown only: nested-list renumbering, lazy continuation, and
// loose/tight distinctions are intentionally out of scope.
export const markdownChunker: Chunker = text => {
	const chunks: Chunk[] = [];
	const lines = text.split('\n');

	// Precompute each line's starting offset so the per-line logic below can
	// index into `text` without re-counting characters every iteration.
	const lineStarts: number[] = [];
	let pos = 0;
	for (const line of lines) {
		lineStarts.push(pos);
		pos += line.length + 1;
	}

	// Tracks the start of the prose chunk currently being accumulated, or
	// undefined when not inside a prose run.
	let proseStart: number | undefined;

	// Close the in-progress prose chunk (if any) at the end of the line *before*
	// `nextLineIdx`. Called when a blank line, heading, fence, or end-of-text
	// ends the prose run.
	const flushProse = (nextLineIdx: number) => {
		if (proseStart === undefined) return;
		// The last content line of this prose run is at nextLineIdx - 1.
		const lastIdx = nextLineIdx - 1;
		const end = lineStarts[lastIdx]! + lines[lastIdx]!.length;
		chunks.push({
			start: proseStart,
			end,
			kind: 'prose',
			spans: computeProseSpans(text, proseStart, end),
		});
		proseStart = undefined;
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		const lineStart = lineStarts[i]!;

		// Blank line: ends any in-progress prose run.
		if (line.trim() === '') {
			flushProse(i);
			i++;
			continue;
		}

		// Heading: single-line chunk. The `#+ ` prefix is cosmetic.
		const headingPrefix = /^(#{1,6})\s+/.exec(line);
		if (headingPrefix) {
			flushProse(i);
			chunks.push({
				start: lineStart,
				end: lineStart + line.length,
				kind: 'heading',
				spans: [
					{
						start: lineStart,
						end: lineStart + headingPrefix[0].length,
						style: 'md-heading-prefix',
					},
				],
			});
			i++;
			continue;
		}

		// Fenced code block: from this ``` line through the next ``` line.
		// If unclosed, the chunk extends to end-of-text (still typeable content).
		if (line.startsWith('```')) {
			flushProse(i);
			const fenceStart = lineStart;
			let j = i + 1;
			while (j < lines.length && !lines[j]!.startsWith('```')) j++;

			const hasClose = j < lines.length;
			const chunkEnd = hasClose
				? lineStarts[j]! + lines[j]!.length
				: text.length;

			const spans: Span[] = [
				// Open fence: includes its trailing \n so the cursor lands on the first
				// content line, not on a "newline after the fence."
				{
					start: fenceStart,
					end: lineStart + line.length + 1,
					style: 'md-fence',
				},
			];
			if (hasClose) {
				spans.push({
					start: lineStarts[j]!,
					end: lineStarts[j]! + lines[j]!.length,
					style: 'md-fence',
				});
			}

			chunks.push({
				start: fenceStart,
				end: chunkEnd,
				kind: 'fenced-code',
				spans,
			});
			i = j + 1; // Resume after the closing fence
			continue;
		}

		// HTML comment block: `<!-- … -->`, possibly spanning multiple lines — and
		// even blank lines, which is exactly why it's consumed as a unit here
		// instead of left to the prose path, where a blank line inside it would
		// split it in two. The whole block is one cosmetic span: rendered dim,
		// nothing typed. If unclosed, it runs to end-of-text, mirroring the fence
		// rule above. Only own-line comments are handled; an inline `<!-- … -->`
		// mid-prose-line stays typeable (common-case markdown only).
		if (/^\s*<!--/.test(line)) {
			flushProse(i);
			const commentStart = lineStart;
			let j = i;
			while (j < lines.length && !lines[j]!.includes('-->')) j++;

			const hasClose = j < lines.length;
			const commentEnd = hasClose
				? lineStarts[j]! + lines[j]!.length
				: text.length;

			chunks.push({
				start: commentStart,
				end: commentEnd,
				kind: 'comment',
				spans: [{start: commentStart, end: commentEnd, style: 'md-comment'}],
			});
			i = hasClose ? j + 1 : lines.length; // Resume after the closing `-->`
			continue;
		}

		// Regular prose line: start (or continue) the current prose chunk.
		proseStart ??= lineStart;
		i++;
	}

	// Close any prose chunk left open by end-of-text.
	flushProse(lines.length);

	return chunks;
};

// Markdown decoration spans. Inline: bold (`**…**`), italic (`_…_`), inline
// code (`` `…` ``), links (`[text](url)`). Line-prefix: list markers and
// block-quote `>`. Markers are cosmetic; content stays
// typeable. Italics use the underscore form only — single-asterisk italic
// would need lookarounds to avoid matching inside `**bold**`, not worth it
// since we mostly use `_…_` in our own docs.
function computeProseSpans(
	text: string,
	chunkStart: number,
	chunkEnd: number,
): Span[] {
	const spans: Span[] = [];
	const segment = text.slice(chunkStart, chunkEnd);

	// Bold: **content** — push spans for the leading/trailing `**` pair.
	for (const match of segment.matchAll(/\*\*[^*\n]+\*\*/g)) {
		const idx = match.index;
		spans.push(
			{
				start: chunkStart + idx,
				end: chunkStart + idx + 2,
				style: 'md-emphasis-marker',
			},
			{
				start: chunkStart + idx + match[0].length - 2,
				end: chunkStart + idx + match[0].length,
				style: 'md-emphasis-marker',
			},
		);
	}

	// Inline code: `content` — the backtick pair is cosmetic, content typeable.
	// Single-char markers (vs bold's two); otherwise identical to the bold case.
	for (const match of segment.matchAll(/`[^`\n]+`/g)) {
		const idx = match.index;
		spans.push(
			{
				start: chunkStart + idx,
				end: chunkStart + idx + 1,
				style: 'md-code-span',
			},
			{
				start: chunkStart + idx + match[0].length - 1,
				end: chunkStart + idx + match[0].length,
				style: 'md-code-span',
			},
		);
	}

	// Italic: _content_ — guarded against word-internal underscores (`var_name`)
	// by requiring non-alphanumeric (or string-edge) neighbors on both sides.
	for (const match of segment.matchAll(/(^|\W)_([^_\n]+)_(?=$|\W)/g)) {
		// Match[1] is the leading non-word char (possibly empty at string start).
		const openIdx = match.index + match[1]!.length;
		const fullLen = 1 + match[2]!.length + 1; // `_content_`
		spans.push(
			{
				start: chunkStart + openIdx,
				end: chunkStart + openIdx + 1,
				style: 'md-emphasis-marker',
			},
			{
				start: chunkStart + openIdx + fullLen - 1,
				end: chunkStart + openIdx + fullLen,
				style: 'md-emphasis-marker',
			},
		);
	}

	// Links: [text](url) — `[` is cosmetic, `](url)` is cosmetic, text typeable.
	for (const match of segment.matchAll(/\[([^\]\n]+)]\(([^)\n]+)\)/g)) {
		const idx = match.index;
		const textLen = match[1]!.length;
		// Leading `[`
		spans.push(
			{
				start: chunkStart + idx,
				end: chunkStart + idx + 1,
				style: 'md-link-syntax',
			},
			{
				start: chunkStart + idx + 1 + textLen,
				end: chunkStart + idx + match[0].length,
				style: 'md-link-syntax',
			},
		);
	}

	// The two below are *line-prefix* markers (`^`…`/gm`), not inline. The base
	// typeable rules already drop any leading indent, so the span only needs to
	// cover the marker itself, which sits at `chunkStart + index + indent.length`.

	// List markers: `- `, `* `, `+ `, or `1. ` at line start. Marker + trailing
	// space is cosmetic; item text is typed. The `[ \t]+` after the marker is the
	// guard that keeps us off `-5`, `*ptr`, and `---` rules (no space → no match).
	for (const match of segment.matchAll(/^([ \t]*)(?:[-*+]|\d+\.)[ \t]+/gm)) {
		const markerStart = chunkStart + match.index + match[1]!.length;
		spans.push({
			start: markerStart,
			end: chunkStart + match.index + match[0].length,
			style: 'md-list-marker',
		});
	}

	// Block-quote prefix: one or more `>` plus an optional space at line start.
	for (const match of segment.matchAll(/^([ \t]*)>+ ?/gm)) {
		const markerStart = chunkStart + match.index + match[1]!.length;
		spans.push({
			start: markerStart,
			end: chunkStart + match.index + match[0].length,
			style: 'md-quote-prefix',
		});
	}

	return spans;
}

// Narrow a typeable-index set to "this chunk onward": drop every position before
// chunks[startChunkIdx].start. This is what chunk-skipping is — selecting a later
// start chunk re-scopes what's typeable (and so what WPM/accuracy count over),
// rather than feeding a "skip" event into the engine fold. The engine just
// re-inits over the narrower set. startChunkIdx 0 (or no chunks) returns the set
// unchanged; an out-of-range index clamps to the last chunk, so a runaway skip
// counter still resolves to a valid scope.
export function typeableIndicesFromChunk(
	typeableIndices: readonly number[],
	chunks: readonly Chunk[],
	startChunkIdx: number,
): readonly number[] {
	if (startChunkIdx <= 0 || chunks.length === 0) return typeableIndices;
	const idx = Math.min(startChunkIdx, chunks.length - 1);
	const startPos = chunks[idx]!.start;
	return typeableIndices.filter(pos => pos >= startPos);
}

// The chunk indices a cursor can actually stop in: those owning at least one
// typeable position. A fully-cosmetic chunk (a bare-URL line, an `<!-- comment
// -->`, any all-skipped chunk) renders as context but is never a stop. This is
// the one derived "where can you be" list — skip navigation, the chunk counter,
// and scoping all read it, so a cosmetic chunk can't desync them. The structural
// `chunks` array is unchanged; it still drives rendering and viewport sizing.
export function typeableChunkIndices(
	chunks: readonly Chunk[],
	typeableIndices: readonly number[],
): number[] {
	const stops: number[] = [];
	for (const [i, chunk] of chunks.entries()) {
		if (typeableIndices.some(pos => pos >= chunk.start && pos < chunk.end)) {
			stops.push(i);
		}
	}

	return stops;
}

// The stop to land on when skipping `direction` (+1 forward / -1 back) from the
// chunk at raw index `fromChunkIdx`, over a `stops` list (from
// typeableChunkIndices). Steps to the nearest stop strictly past `fromChunkIdx`;
// with none in that direction it returns `fromChunkIdx` unchanged, so a skip at
// the first/last stop is a no-op (and triggers no remount). `fromChunkIdx` need
// not itself be a stop.
export function adjacentTypeableChunk(
	stops: readonly number[],
	fromChunkIdx: number,
	direction: 1 | -1,
): number {
	const target =
		direction === 1
			? stops.find(stop => stop > fromChunkIdx)
			: stops.findLast(stop => stop < fromChunkIdx);
	return target ?? fromChunkIdx;
}

export function computeTypeableIndices(
	text: string,
	chunks: Chunk[] = [],
): readonly number[] {
	// Build base indices from global rules (leading whitespace, blank lines, tabs).
	const baseIndices = computeBaseTypeableIndices(text);

	// Build a set of cosmetic positions from chunk spans.
	const cosmeticPositions = new Set<number>();
	for (const chunk of chunks) {
		for (const span of chunk.spans ?? []) {
			for (let i = span.start; i < span.end; i++) {
				cosmeticPositions.add(i);
			}
		}
	}

	// Filter base by removing cosmetic positions.
	const typeable = baseIndices.filter(i => !cosmeticPositions.has(i));
	return dropOrphanNewlines(text, typeable);
}

// A line break is typeable so you can Enter from one content line to the next.
// But once cosmetic spans and base skips are applied, a whole line can end up
// with nothing typeable on it — a bare-URL line, an `<!-- comment -->` line, a
// closing ``` fence. Its trailing newline would then be the *only* typeable
// position on the line, so the line becomes a chunk you can do nothing in but
// press Enter. Drop such a newline: keep one only if its own line has typeable
// content AND typeable content still follows it (so the last line never sprouts a
// trailing Enter either). The cursor then glides over an all-cosmetic line the
// same way it glides over a blank one.
function dropOrphanNewlines(
	text: string,
	typeable: readonly number[],
): readonly number[] {
	const content = typeable.filter(pos => text[pos] !== '\n');
	const contentPositions = new Set(content);
	const lastContent = content.at(-1) ?? -1;

	return typeable.filter(pos => {
		if (text[pos] !== '\n') return true; // Content is always kept.
		// The newline terminates the line that starts after the previous newline;
		// there's no other newline in between, so any content there is this line's.
		const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
		let hasContentBefore = false;
		for (let i = lineStart; i < pos; i++) {
			if (contentPositions.has(i)) {
				hasContentBefore = true;
				break;
			}
		}

		return hasContentBefore && pos < lastContent;
	});
}

// Characters that render fine but can't be reasonably typed on a standard
// keyboard *and* have no clean 1:1 ASCII substitute. These are entirely skipped
// (cursor jumps past). Chars that do have an ASCII partner (em-dash → `-`,
// smart quotes → `"`/`'`, NBSP → space) live in engine.ts's substitution table
// instead — they stay typeable and accept the partner keystroke as correct.
const untypeableChars = new Set([
	'…', // … horizontal ellipsis (no 1:1 — `...` is three keystrokes)
]);

// Emoji, flags, and pictographic symbols render but can't be keyed on a normal
// keyboard, so they're skipped from the typeable set (the cursor jumps past),
// the same treatment as untypeableChars. Letters (including accented) and CJK
// aren't pictographic, so they stay typeable — one cluster, one keystroke.
const skippableCluster = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function computeBaseTypeableIndices(text: string): readonly number[] {
	const indices: number[] = [];
	let pos = 0;
	const lines = text.split('\n');

	// The last line worth advancing to. Used downstream to decide whether a
	// trailing newline is typeable — it only is if non-blank content still
	// follows.
	const lastNonBlankIdx = lines.findLastIndex(line => line.trim() !== '');

	for (const [lineIdx, line] of lines.entries()) {
		// Skip blank lines
		if (line.trim() === '') {
			pos += line.length + 1;
			continue;
		}

		// Skip leading whitespace by
		// finding the first non-leading-whitespace char in this line, if any
		const firstContent = line.search(/[^ \t]/);
		if (firstContent !== -1) {
			// Char offsets inside a bare `http(s)://…` URL on this line. A long opaque
			// URL is tedious and rarely the point of a drill, in *any* file format —
			// so it's skipped here in the kind-agnostic base layer (alongside the
			// ellipsis/emoji skips), not in a per-kind chunker. URL chars are ASCII, so
			// the cluster index equals the char index and this set reads cleanly below.
			const urlPositions = new Set<number>();
			for (const match of line.matchAll(/https?:\/\/[^\s)\]]+/g)) {
				for (let k = 0; k < match[0].length; k++)
					urlPositions.add(match.index + k);
			}

			// One typeable index per grapheme cluster (so a multi-code-unit accent
			// like e+◌́ is a single cursor stop), not per UTF-16 code unit.
			for (const {segment, index} of segmentGraphemes(line)) {
				if (index < firstContent) continue; // Leading whitespace
				if (segment === '\t') continue; // Mid-line tab whitespace
				if (urlPositions.has(index)) continue; // Inside a bare URL
				// Collapse a run of 2+ spaces to a single keystroke: only the run's
				// first space stays typeable; the rest are skipped (cursor jumps past).
				// Alignment padding — `ttype file.txt    # comment`, lined-up table
				// columns — shouldn't make you type every space, same spirit as the tab
				// skip above. A lone space is ordinary word spacing and stays typeable.
				// (Space, not Tab, is the one key that fills the gap: Tab is bound to
				// chunk-skip, so it never reaches the typing path.)
				if (segment === ' ' && line[index - 1] === ' ') continue;
				// Skip unmappable typographic chars and unkeyable clusters.
				if (untypeableChars.has(segment)) continue;
				if (skippableCluster.test(segment)) continue;
				indices.push(pos + index);
			}
		}

		// Push the trailing newline only if a non-blank line still follows.
		// Otherwise the user has nowhere to advance to via Enter.
		if (lineIdx < lastNonBlankIdx) {
			indices.push(pos + line.length);
		}

		pos += line.length + 1; // +1 for the \n that split() consumed
	}

	return indices;
}
