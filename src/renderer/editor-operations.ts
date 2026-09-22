import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { Transaction } from '@milkdown/kit/prose/state';

export type DocumentTextMatch = { from: number; to: number };

/** Finds matches inside individual text nodes so replacements retain that node's marks. */
export function findDocumentTextMatches(doc: ProseMirrorNode, query: string): DocumentTextMatch[] {
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  const matches: DocumentTextMatch[] = [];

  doc.descendants((node, position) => {
    if (!node.isTextblock) return;
    let blockText = '';
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) {
        blockText += '\u0000';
        positions.push(position + 1 + offset);
        return;
      }
      blockText += child.text;
      for (let index = 0; index < child.text.length; index += 1) {
        positions.push(position + 1 + offset + index);
      }
    });

    const text = blockText.toLocaleLowerCase();
    let from = 0;
    while (from <= text.length - needle.length) {
      const index = text.indexOf(needle, from);
      if (index < 0) break;
      const matchFrom = positions[index];
      const matchLast = positions[index + query.length - 1];
      if (matchFrom !== undefined && matchLast !== undefined) {
        matches.push({ from: matchFrom, to: matchLast + 1 });
      }
      from = index + Math.max(query.length, 1);
    }

    return false;
  });

  return matches;
}

/** Applies all replacements as one transaction, which makes them one undo step. */
export function replaceDocumentTextMatches(
  transaction: Transaction,
  matches: DocumentTextMatch[],
  replacement: string,
): Transaction {
  for (const match of matches.toReversed()) {
    transaction.insertText(replacement, match.from, match.to);
  }
  return transaction;
}
