export type ChunkKind =
	| 'prose'
	| 'code'
	| 'heading'
	| 'fenced-code'
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
	| 'md-fence';

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
	const chunks: Chunk[] = [];
	let lastStart = 0;

	for (const match of text.matchAll(/^@@/gm)) {
		const matchStart = match.index;
		if (matchStart > lastStart) {
			chunks.push({
				start: lastStart,
				end: matchStart,
				kind: 'diff-hunk',
				spans: computeSpans(text, lastStart, matchStart),
			});
		}

		lastStart = matchStart;
	}

	if (lastStart < text.length) {
		chunks.push({
			start: lastStart,
			end: text.length,
			kind: 'diff-hunk',
			spans: computeSpans(text, lastStart, text.length),
		});
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
			// Added content: just the leading marker is cosmetic; user types the rest.
			spans.push({start: pos, end: pos + 1, style: 'diff-add'});
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

// Markdown chunker. Walks lines once, building three chunk kinds:
//   - `heading`   — a single `#…` line; the `#+ ` prefix becomes cosmetic
//   - `fenced-code` — content between ```...``` fences; the fence lines themselves
//     are cosmetic, content inside is typeable as-is (verbatim code)
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
	return baseIndices.filter(i => !cosmeticPositions.has(i));
}

// Characters that render fine but can't be reasonably typed on a standard
// keyboard *and* have no clean 1:1 ASCII substitute. These are entirely skipped
// (cursor jumps past). Chars that do have an ASCII partner (em-dash → `-`,
// smart quotes → `"`/`'`, NBSP → space) live in engine.ts's substitution table
// instead — they stay typeable and accept the partner keystroke as correct.
const untypeableChars = new Set([
	'…', // … horizontal ellipsis (no 1:1 — `...` is three keystrokes)
]);

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
			for (let i = firstContent; i < line.length; i++) {
				// Skip mid-line tab whitespace
				if (line[i] === '\t') continue;
				// Skip unmappable typographic chars (see untypeableChars).
				if (untypeableChars.has(line[i]!)) continue;
				indices.push(pos + i);
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
