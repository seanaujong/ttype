/* eslint-disable */
// Headless dogfood harness. Exercises the chunker + engine ingestion path
// over realistic inputs and dumps what positions are typeable vs cosmetic.
// Lets me (the agent) verify span behavior without needing a TTY.
//
// Run with: npx tsx scripts/dogfood.tsx
//
// Not part of the test suite or distribution.

import {computeTypeableIndices, diffChunker} from '../source/chunker.js';

const sampleDiff = `diff --git a/source/foo.ts b/source/foo.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/source/foo.ts
@@ -0,0 +1,4 @@
+export function greet(name: string) {
+    return "hello, " + name;
+}
-deleted line
 context line
`;

const chunks = diffChunker(sampleDiff);
const typeable = computeTypeableIndices(sampleDiff, chunks);

const typeableSet = new Set(typeable);

console.log('=== Source ===');
console.log(sampleDiff);

console.log('\n=== Chunks ===');
for (const chunk of chunks) {
	console.log(`  [${chunk.start}, ${chunk.end})  kind=${chunk.kind ?? '-'}`);
	for (const span of chunk.spans ?? []) {
		const text = JSON.stringify(sampleDiff.slice(span.start, span.end));
		console.log(`    span [${span.start}, ${span.end}) ${span.style}: ${text}`);
	}
}

console.log(`\n=== Typeable count: ${typeable.length} ===`);

console.log('\n=== Per-line view (T = typeable, _ = cosmetic) ===');
const lines = sampleDiff.split('\n');
let pos = 0;
for (const [lineIdx, line] of lines.entries()) {
	const marks = [];
	for (let i = 0; i < line.length; i++) {
		marks.push(typeableSet.has(pos + i) ? 'T' : '_');
	}
	const newlinePos = pos + line.length;
	const newlineMark = lineIdx < lines.length - 1
		? (typeableSet.has(newlinePos) ? 'T\\n' : '_\\n')
		: '';
	console.log(`  ${line.padEnd(50)} ${marks.join('')}${newlineMark}`);
	pos += line.length + 1;
}
