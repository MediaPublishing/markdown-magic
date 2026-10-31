export type DiffRow = { type: 'same' | 'added' | 'removed'; text: string };

// Separate edit blocks keep unchanged paragraphs readable between distant edits.
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split('\n'); const b = after.split('\n');
  let prefix = 0; let suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const x = a.slice(prefix, a.length - suffix); const y = b.slice(prefix, b.length - suffix);
  const rows: DiffRow[] = a.slice(0, prefix).map(text => ({ type: 'same', text }));
  if (x.length * y.length <= 2_000_000) {
    const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i]![j] = x[i] === y[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    let i = 0; let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { rows.push({ type: 'same', text: x[i++]! }); j++; }
      else if (j < y.length && (i === x.length || table[i]![j + 1]! > table[i + 1]![j]!)) rows.push({ type: 'added', text: y[j++]! });
      else rows.push({ type: 'removed', text: x[i++]! });
    }
  } else {
    rows.push(...x.map(text => ({ type: 'removed' as const, text })), ...y.map(text => ({ type: 'added' as const, text })));
  }
  rows.push(...a.slice(a.length - suffix).map(text => ({ type: 'same' as const, text })));
  return rows;
}

export function compactDiff(rows: DiffRow[], context = 2): DiffRow[] {
  if (!rows.some(row => row.type !== 'same')) return [];
  return rows.filter((row, i) => row.type !== 'same' || rows.slice(Math.max(0, i - context), i + context + 1).some(other => other.type !== 'same') || (i > 0 && rows[i - 1]?.type !== 'same'));
}

/** Maps only a completely unchanged range through separate edit blocks. */
export function mapUnchangedRange(before: string, after: string, from: number, to: number): number | undefined {
  let oldOffset = 0; let newOffset = 0; let blockOld = 0; let blockNew = 0;
  for (const row of [...diffLines(before, after), { type: 'removed' as const, text: '' }]) {
    if (row.type === 'same') { oldOffset += row.text.length + 1; newOffset += row.text.length + 1; continue; }
    if (from >= blockOld && to <= oldOffset) {
      const mapped = blockNew + from - blockOld;
      if (after.slice(mapped, mapped + to - from) === before.slice(from, to)) return mapped;
    }
    if (row.type === 'removed') oldOffset += row.text.length + 1;
    else newOffset += row.text.length + 1;
    blockOld = oldOffset; blockNew = newOffset;
  }
  return undefined;
}
