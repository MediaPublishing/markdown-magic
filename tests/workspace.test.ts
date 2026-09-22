import { describe, expect, it } from 'vitest';
import {
  assignTabToGroup,
  closeTab,
  normalizeState,
  openFile,
  toggleGroupCollapsed,
  upsertGroup,
} from '../src/shared/workspace';
import type { TabGroup } from '../src/shared/types';

const group: TabGroup = {
  id: 'launch',
  name: 'Launch',
  description: 'Copy and QA for launch',
  icon: 'R',
  color: 'blue',
  collapsed: false,
};

describe('workspace model', () => {
  it('normalizes malformed persisted data into a safe empty workspace', () => {
    const state = normalizeState({ version: 99, tabs: 'bad', groups: [{}] });
    expect(state).toEqual({ version: 2, rootPath: null, groups: [], tabs: [], activeTabId: null });
  });

  it('opens the same document only once and focuses its existing tab', () => {
    const first = openFile(normalizeState(null), '/tmp/a.md');
    const second = openFile(first, '/tmp/a.md');
    expect(first.tabs).toHaveLength(1);
    expect(second.tabs).toHaveLength(1);
    expect(second.activeTabId).toBe(first.activeTabId);
  });

  it('keeps groups persistent and removes a group assignment when requested', () => {
    let state = normalizeState({ version: 1, rootPath: '/tmp', groups: [], tabs: [], activeTabId: null });
    state = openFile(upsertGroup(state, group), '/tmp/brief.md');
    state = assignTabToGroup(state, state.activeTabId!, 'launch');
    expect(state.tabs[0]?.groupId).toBe('launch');
    state = assignTabToGroup(state, state.activeTabId!, null);
    expect(state.tabs[0]?.groupId).toBeNull();
  });

  it('collapses a group without deleting its membership', () => {
    let state = upsertGroup(normalizeState(null), group);
    const opened = openFile(state, '/tmp/post.md');
    state = assignTabToGroup(opened, opened.activeTabId!, 'launch');
    state = toggleGroupCollapsed(state, 'launch');
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]?.collapsed).toBe(true);
    expect(state.tabs[0]?.groupId).toBe('launch');
  });

  it('selects an adjacent tab after closing the focused tab', () => {
    let state = normalizeState(null);
    state = openFile(state, '/tmp/one.md');
    state = openFile(state, '/tmp/two.md');
    state = openFile(state, '/tmp/three.md');
    const closed = closeTab(state, state.activeTabId!);
    expect(closed.tabs).toHaveLength(2);
    expect(closed.tabs.find((tab) => tab.id === closed.activeTabId)?.title).toBe('two.md');
  });
});
