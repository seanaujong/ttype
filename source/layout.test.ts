import test from 'ava';
import {splitDiffRows, type DiffLine, type SplitRow} from './layout.js';

// Build a DiffLine without caring about real offsets (the grouping logic
// doesn't read `start` — that's only for the renderer's per-char styling).
const line = (kind: DiffLine['kind'], text: string = kind): DiffLine => ({
	text,
	start: 0,
	kind,
});

const kinds = (rows: readonly SplitRow[]) => rows.map(row => row.kind);

test('splitDiffRows: empty input produces no rows', t => {
	t.deepEqual(splitDiffRows([]), []);
});

test('splitDiffRows: context and metadata span the full width', t => {
	t.deepEqual(kinds(splitDiffRows([line('meta'), line('context')])), [
		'full',
		'full',
	]);
});

test('splitDiffRows: a change block pairs a removed line with an added line', t => {
	const removed = line('removed', 'old');
	const added = line('added', 'new');
	t.deepEqual(splitDiffRows([removed, added]), [
		{kind: 'split', removed, added},
	]);
});

test('splitDiffRows: an uneven block pads the shorter side with undefined', t => {
	const r0 = line('removed', 'r0');
	const a = [line('added', 'a0'), line('added', 'a1'), line('added', 'a2')];
	t.deepEqual(splitDiffRows([r0, ...a]), [
		{kind: 'split', removed: r0, added: a[0]},
		{kind: 'split', removed: undefined, added: a[1]},
		{kind: 'split', removed: undefined, added: a[2]},
	]);
});

test('splitDiffRows: a pure addition leaves the removed slot empty', t => {
	const rows = splitDiffRows([line('added', 'x'), line('added', 'y')]);
	t.true(rows.every(row => row.kind === 'split' && row.removed === undefined));
});

test('splitDiffRows: a pure deletion leaves the added slot empty', t => {
	const removed = line('removed', 'x');
	t.deepEqual(splitDiffRows([removed]), [
		{kind: 'split', removed, added: undefined},
	]);
});

test('splitDiffRows: context separates two change blocks', t => {
	const rows = splitDiffRows([
		line('context', 'c1'),
		line('removed', 'r'),
		line('added', 'a'),
		line('context', 'c2'),
		line('added', 'a2'),
	]);
	t.deepEqual(kinds(rows), ['full', 'split', 'full', 'split']);
});
