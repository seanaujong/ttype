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
	| 'diff-context';

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

	for (const line of lines) {
		if (line.startsWith('@@')) {
			spans.push({start: pos, end: pos + line.length, style: 'diff-header'});
		} else if (
			line.startsWith('diff --git') ||
			line.startsWith('index ') ||
			line.startsWith('--- ') ||
			line.startsWith('+++ ')
		) {
			spans.push({start: pos, end: pos + line.length, style: 'diff-metadata'});
		} else if (line.startsWith('+')) {
			spans.push({start: pos, end: pos + 1, style: 'diff-add'});
		} else if (line.startsWith('-')) {
			spans.push({start: pos, end: pos + 1, style: 'diff-remove'});
		} else if (line.startsWith(' ')) {
			spans.push({start: pos, end: pos + 1, style: 'diff-context'});
		}

		pos += line.length + 1; // +1 for the \n that split() consumed
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
