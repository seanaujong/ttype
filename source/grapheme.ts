// Grapheme-cluster mechanics — the single Intl.Segmenter the whole app shares,
// so the chunker (which clusters are typeable) and the renderer (which clusters
// become display cells) always agree on where a cluster starts. A "grapheme
// cluster" is what a human calls one character: an emoji can be several UTF-16
// code units (😀 is two, a flag four), and a combining mark folds into its base
// (e + ◌́ → é). Pure: built-in Intl only, no other imports — a leaf util any
// layer may use.

const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

// A string's grapheme clusters, each with its UTF-16 offset (`index`).
export function segmentGraphemes(text: string): Intl.Segments {
	return segmenter.segment(text);
}

// Generous upper bound on one cluster's UTF-16 length (even a ZWJ family emoji is
// ~11) so clusterAt slices a small window instead of the whole text.
const maxClusterUnits = 32;

// The grapheme cluster beginning at `offset` — the unit the cursor sits on, used
// to compare a keystroke against the whole expected cluster (not one code unit).
// `offset` is always a cluster start (it comes from typeableIndices / a cell's
// sourceStart), so the first segment of the window is that cluster.
export function clusterAt(text: string, offset: number): string {
	return segmentFirst(text.slice(offset, offset + maxClusterUnits));
}

// The first grapheme cluster of `text`, or '' if empty. Pulls one item off the
// segmenter's iterator rather than looping (which would only ever run once).
function segmentFirst(text: string): string {
	const result = segmenter.segment(text)[Symbol.iterator]().next();
	return result.done ? '' : result.value.segment;
}
