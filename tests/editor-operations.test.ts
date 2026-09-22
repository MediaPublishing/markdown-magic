import { describe, expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { history, undo } from '@milkdown/kit/prose/history';
import { EditorState } from '@milkdown/kit/prose/state';
import { findDocumentTextMatches, replaceDocumentTextMatches } from '../src/renderer/editor-operations';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
  },
});

describe('visual editor text replacement', () => {
  it('finds an ordinary phrase across a formatting boundary', () => {
    const strong = schema.marks.strong.create();
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('Alpha', [strong]),
        schema.text(' and beta'),
      ]),
    ]);

    expect(findDocumentTextMatches(doc, 'alpha and')).toEqual([{ from: 1, to: 10 }]);
  });

  it('preserves marks and groups replace-all into one undo step', () => {
    const strong = schema.marks.strong.create();
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('Alpha', [strong]),
        schema.text(' and '),
        schema.text('Alpha', [strong]),
      ]),
    ]);
    let state = EditorState.create({ doc, schema, plugins: [history()] });
    const matches = findDocumentTextMatches(state.doc, 'alpha');

    state = state.apply(replaceDocumentTextMatches(state.tr, matches, 'Gamma'));

    expect(state.doc.textContent).toBe('Gamma and Gamma');
    expect(state.doc.firstChild?.child(0).marks[0]?.type.name).toBe('strong');
    expect(state.doc.firstChild?.child(2).marks[0]?.type.name).toBe('strong');

    expect(undo(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    expect(state.doc.textContent).toBe('Alpha and Alpha');
  });
});
