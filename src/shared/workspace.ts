import type { EditorTab, TabGroup, WorkspaceState } from './types';

const GROUP_COLORS = ['blue', 'green', 'orange', 'pink', 'teal'] as const;

export function tabIdForPath(path: string): string {
  return `tab-${encodeURIComponent(path)}`;
}

export function normalizeState(input: unknown): WorkspaceState {
  if (!input || typeof input !== 'object') return emptyState();
  const raw = input as Partial<WorkspaceState>;
  if (raw.version !== 1 && raw.version !== 2) return emptyState();
  const groups = Array.isArray(raw.groups)
    ? raw.groups.filter(isGroup).map((group, index) => ({ ...group, id: group.id || `group-${index + 1}` }))
    : [];
  const knownGroups = new Set(groups.map((group) => group.id));
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.filter(isTab).map((tab, index) => ({
        ...tab,
        id: typeof tab.id === 'string' && tab.id ? tab.id : tabIdForPath(tab.path),
        title: typeof tab.title === 'string' ? tab.title : fileName(tab.path),
        dirty: tab.dirty === true,
        missing: tab.missing === true,
        ...(tab.draft === true ? { draft: true } : {}),
        groupId: tab.groupId && knownGroups.has(tab.groupId) ? tab.groupId : null,
      }))
    : [];
  const uniqueTabs = dedupeById(tabs);
  const activeTabId = uniqueTabs.some((tab) => tab.id === raw.activeTabId)
    ? raw.activeTabId!
    : uniqueTabs[0]?.id ?? null;
  return {
    version: 2,
    rootPath: typeof raw.rootPath === 'string' && raw.rootPath ? raw.rootPath : null,
    groups,
    tabs: uniqueTabs,
    activeTabId,
  };
}

export function emptyState(): WorkspaceState {
  return { version: 2, rootPath: null, groups: [], tabs: [], activeTabId: null };
}

export function openFile(state: WorkspaceState, path: string, title = fileName(path)): WorkspaceState {
  const existing = state.tabs.find((tab) => tab.path === path);
  if (existing) return { ...state, activeTabId: existing.id };
  const id = tabIdForPath(path);
  const tab: EditorTab = { id, path, title, groupId: null, dirty: false, missing: false };
  return { ...state, tabs: [...state.tabs, tab], activeTabId: id };
}

export function closeTab(state: WorkspaceState, tabId: string): WorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  let activeTabId = state.activeTabId === tabId ? tabs[index]?.id ?? tabs[index - 1]?.id ?? null : state.activeTabId;
  return { ...state, tabs, activeTabId };
}

export function setTabDirty(state: WorkspaceState, tabId: string, dirty: boolean): WorkspaceState {
  return replaceTab(state, tabId, (tab) => ({ ...tab, dirty }));
}

export function setTabMissing(state: WorkspaceState, tabId: string, missing: boolean): WorkspaceState {
  return replaceTab(state, tabId, (tab) => ({ ...tab, missing }));
}

export function assignTabToGroup(state: WorkspaceState, tabId: string, groupId: string | null): WorkspaceState {
  if (groupId !== null && !state.groups.some((group) => group.id === groupId)) return state;
  return replaceTab(state, tabId, (tab) => ({ ...tab, groupId }));
}

export function reorderTab(
  state: WorkspaceState,
  sourceTabId: string,
  targetTabId: string,
  placement: 'before' | 'after',
): WorkspaceState {
  if (sourceTabId === targetTabId) return state;
  const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceTabId);
  const targetIndex = state.tabs.findIndex((tab) => tab.id === targetTabId);
  if (sourceIndex === -1 || targetIndex === -1) return state;

  const tabs = [...state.tabs];
  const [movedTab] = tabs.splice(sourceIndex, 1);
  if (!movedTab) return state;

  const target = state.tabs[targetIndex]!;
  const adjustedTargetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
  tabs.splice(placement === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1, 0, { ...movedTab, groupId: target.groupId });
  return { ...state, tabs };
}

export function orderedTabs(workspace: WorkspaceState): WorkspaceState['tabs'] {
  const grouped = workspace.groups.flatMap((group) => workspace.tabs.filter((tab) => tab.groupId === group.id));
  const ungrouped = workspace.tabs.filter((tab) => !tab.groupId);
  return [...grouped, ...ungrouped];
}

export function visibleTabsForState(workspace: WorkspaceState): WorkspaceState['tabs'] {
  return orderedTabs(workspace).filter((tab) => !tab.groupId || !workspace.groups.find((group) => group.id === tab.groupId)?.collapsed);
}

export function moveTabByOffset(state: WorkspaceState, tabId: string, offset: -1 | 1): WorkspaceState {
  const visible = visibleTabsForState(state);
  const visibleIndex = visible.findIndex((tab) => tab.id === tabId);
  const neighbour = visible[visibleIndex + offset];
  if (!neighbour) return state;

  const currentIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  const neighbourIndex = state.tabs.findIndex((tab) => tab.id === neighbour.id);
  const tabs = [...state.tabs];
  const [movedTab] = tabs.splice(currentIndex, 1);
  if (!movedTab) return state;
  tabs.splice(neighbourIndex > currentIndex ? neighbourIndex - 1 : neighbourIndex, 0, movedTab);
  return { ...state, tabs };
}

export function upsertGroup(state: WorkspaceState, group: TabGroup): WorkspaceState {
  const exists = state.groups.some((item) => item.id === group.id);
  return {
    ...state,
    groups: exists ? state.groups.map((item) => (item.id === group.id ? group : item)) : [...state.groups, group],
  };
}

export function toggleGroupCollapsed(state: WorkspaceState, groupId: string): WorkspaceState {
  return {
    ...state,
    groups: state.groups.map((group) => (group.id === groupId ? { ...group, collapsed: !group.collapsed } : group)),
  };
}

export function moveGroup(
  state: WorkspaceState,
  sourceGroupId: string,
  targetGroupId: string,
  placement: 'before' | 'after',
): WorkspaceState {
  if (sourceGroupId === targetGroupId) return state;
  const sourceIndex = state.groups.findIndex((group) => group.id === sourceGroupId);
  const targetIndex = state.groups.findIndex((group) => group.id === targetGroupId);
  if (sourceIndex === -1 || targetIndex === -1) return state;

  const groups = [...state.groups];
  const [movedGroup] = groups.splice(sourceIndex, 1);
  if (!movedGroup) return state;
  const adjustedTargetIndex = groups.findIndex((group) => group.id === targetGroupId);
  groups.splice(placement === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1, 0, movedGroup);
  return { ...state, groups };
}

export function nextGroupColor(groupCount: number): (typeof GROUP_COLORS)[number] {
  return GROUP_COLORS[groupCount % GROUP_COLORS.length]!;
}

export function fileName(path: string): string {
  const parts = path.split('/');
  return parts.at(-1) ?? path;
}

function replaceTab(
  state: WorkspaceState,
  tabId: string,
  updater: (tab: EditorTab) => EditorTab,
): WorkspaceState {
  const exists = state.tabs.some((tab) => tab.id === tabId);
  if (!exists) return state;
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)) };
}

function dedupeById(tabs: EditorTab[]): EditorTab[] {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
}

function isGroup(value: unknown): value is TabGroup {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TabGroup>;
  return typeof item.name === 'string'
    && typeof item.description === 'string'
    && typeof item.icon === 'string'
    && typeof item.color === 'string';
}

function isTab(value: unknown): value is EditorTab {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<EditorTab>;
  return typeof item.path === 'string' && item.path.length > 0;
}
