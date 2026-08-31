// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { assignTabToGroup, moveGroup, normalizeState, openFile, orderedTabs, reorderTab, toggleGroupCollapsed, upsertGroup } from '../src/shared/workspace';
import type { FileEntry, TabGroup } from '../src/shared/types';
import { createLineDiff, filterFiles, groupTabCount, visibleTabsForState } from '../src/renderer/ui';

const files: FileEntry[] = [
  { path: '/vault/Notes/Launch.md', relativePath: 'Notes/Launch.md', name: 'Launch.md', mtimeMs: 1 },
  { path: '/vault/Notes/Ideas.markdown', relativePath: 'Notes/Ideas.markdown', name: 'Ideas.markdown', mtimeMs: 2 },
  { path: '/vault/Archive/Launch-old.md', relativePath: 'Archive/Launch-old.md', name: 'Launch-old.md', mtimeMs: 3 },
];

const group: TabGroup = { id: 'launch', name: 'Launch', description: '', icon: 'L', color: 'blue', collapsed: false };

describe('renderer view helpers', () => {
  it('searches case-insensitively across relative paths', () => {
    expect(filterFiles(files, 'ideas')).toHaveLength(1);
    expect(filterFiles(files, 'LAUNCH')).toHaveLength(2);
    expect(filterFiles(files, '  ')).toEqual(files);
  });

  it('keeps a change near the top visible in a long assistant diff', () => {
    const before = Array.from({ length: 400 }, (_, index) => `Line ${index + 1}`);
    const after = [...before];
    after[4] = 'Changed line 5';

    const diff = createLineDiff(before.join('\n'), after.join('\n'));

    expect(diff.length).toBeLessThan(20);
    expect(diff.some((row) => row.type === 'removed' && row.text === 'Line 5')).toBe(true);
    expect(diff.some((row) => row.type === 'added' && row.text === 'Changed line 5')).toBe(true);
  });

  it('keeps group membership counted while a group is collapsed', () => {
    let state = upsertGroup(normalizeState(null), group);
    state = openFile(state, files[0]!.path);
    state = assignTabToGroup(state, state.activeTabId!, group.id);
    state = toggleGroupCollapsed(state, group.id);

    expect(groupTabCount(state, group.id)).toBe(1);
    expect(visibleTabsForState(state)).toHaveLength(0);
  });

  it('keeps unassigned tabs visible next to expanded group tabs', () => {
    let state = upsertGroup(normalizeState(null), group);
    state = openFile(state, files[0]!.path);
    state = openFile(state, files[1]!.path);
    const firstTab = state.tabs[0]!;
    state = assignTabToGroup(state, firstTab.id, group.id);

    expect(visibleTabsForState(state).map((tab) => tab.path)).toEqual([files[0]!.path, files[1]!.path]);
    expect(groupTabCount(state, null)).toBe(1);
  });
});

describe('browser-like tab management', () => {
  it('reorders tabs and adopts the target membership', () => {
    let state = normalizeState(null);
    state = openFile(state, '/tmp/one.md');
    state = openFile(state, '/tmp/two.md');
    state = openFile(state, '/tmp/three.md');

    const moved = reorderTab(state, state.tabs[2]!.id, state.tabs[0]!.id, 'before');
    expect(moved.tabs.map((tab) => tab.title)).toEqual(['three.md', 'one.md', 'two.md']);
  });

  it('clusters visible tabs by group order and keeps ungrouped tabs afterwards', () => {
    let state = normalizeState(null);
    state = openFile(openFile(openFile(state, '/tmp/free.md'), '/tmp/b.md'), '/tmp/a.md');
    state = upsertGroup(state, group);
    state = assignTabToGroup(state, state.tabs.find((tab) => tab.title === 'a.md')!.id, group.id);

    expect(orderedTabs(state).map((tab) => tab.title)).toEqual(['a.md', 'free.md', 'b.md']);
  });

  it('moves a whole group while preserving its members', () => {
    let state = normalizeState(null);
    state = upsertGroup(upsertGroup(state, group), { ...group, id: 'qa', name: 'QA', color: 'green' });
    expect(moveGroup(state, 'qa', 'launch', 'before').groups.map((item) => item.id)).toEqual(['qa', 'launch']);
  });
});
