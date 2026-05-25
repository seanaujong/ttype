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
			chunks.push({start: lastStart, end: matchStart, kind: 'diff-hunk'});
		}

		lastStart = matchStart;
	}

	if (lastStart < text.length) {
		chunks.push({start: lastStart, end: text.length, kind: 'diff-hunk'});
	}

	return chunks;
};
