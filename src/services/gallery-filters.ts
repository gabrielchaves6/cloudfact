/** Shared by the generated page and its tests. Keep these functions self-contained for embedding. */
export interface CloudfactRow {
  name: string;
  project: string | null;
  visibility: string;
  kind: string;
  visibilityLabel?: string;
  kindLabel?: string;
  /** Published size in bytes; null when unknown or not applicable (an app). */
  bytes?: number | null;
  origin?: string;
  originLabel?: string;
  modifiedAt: string | null;
  search: string;
}

export interface CloudfactFilters {
  query: string;
  name: string;
  project: string;
  visibility: string;
  kind: string;
  modified: string;
  size?: string;
  origin?: string;
}

export type CloudfactSort = 'name' | 'project' | 'size' | 'origin' | 'visibility' | 'kind' | 'modified';

export function matchesCloudfact(row: CloudfactRow, filters: CloudfactFilters, now = Date.now()): boolean {
  const query = filters.query.trim().toLowerCase();
  const name = filters.name.trim().toLowerCase();
  if (query && !row.search.toLowerCase().includes(query)) return false;
  if (name && !row.name.toLowerCase().includes(name)) return false;
  if (filters.project !== '*' && (row.project ?? '') !== filters.project) return false;
  if (filters.visibility !== '*' && row.visibility !== filters.visibility) return false;
  if (filters.kind !== '*' && row.kind !== filters.kind) return false;
  if (filters.origin && filters.origin !== '*' && row.origin !== filters.origin) return false;
  if (filters.size && filters.size !== '*') {
    const bytes = typeof row.bytes === 'number' && Number.isFinite(row.bytes) ? row.bytes : null;
    if (filters.size === 'none') {
      if (bytes !== null) return false;
    } else {
      const MB = 1024 * 1024;
      if (bytes === null) return false;
      if (filters.size === 'small' && bytes >= MB) return false;
      if (filters.size === 'medium' && (bytes < MB || bytes > 10 * MB)) return false;
      if (filters.size === 'large' && bytes <= 10 * MB) return false;
    }
  }
  if (filters.modified !== '*') {
    const time = row.modifiedAt ? Date.parse(row.modifiedAt) : NaN;
    if (filters.modified === 'none') return !Number.isFinite(time);
    const windows: Record<string, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };
    const window = windows[filters.modified];
    if (!window || !Number.isFinite(time) || time > now || now - time > window) return false;
  }
  return true;
}

export function compareCloudfacts(a: CloudfactRow, b: CloudfactRow, key: CloudfactSort, descending: boolean): number {
  let result = 0;
  if (key === 'modified') {
    const at = a.modifiedAt ? Date.parse(a.modifiedAt) : NaN;
    const bt = b.modifiedAt ? Date.parse(b.modifiedAt) : NaN;
    // Missing dates stay at the end in either direction.
    if (Number.isFinite(at) !== Number.isFinite(bt)) return Number.isFinite(at) ? -1 : 1;
    if (Number.isFinite(at)) result = at - bt;
  } else if (key === 'size') {
    const as = typeof a.bytes === 'number' && Number.isFinite(a.bytes) ? a.bytes : null;
    const bs = typeof b.bytes === 'number' && Number.isFinite(b.bytes) ? b.bytes : null;
    // Unknown sizes stay at the end in either direction.
    if ((as === null) !== (bs === null)) return as === null ? 1 : -1;
    if (as !== null && bs !== null) result = as - bs;
  } else {
    const value = (row: CloudfactRow): string => {
      if (key === 'project') return row.project || 'Sem projeto';
      if (key === 'visibility') return row.visibilityLabel ?? row.visibility;
      if (key === 'kind') return row.kindLabel ?? row.kind;
      if (key === 'origin') return row.originLabel ?? row.origin ?? '';
      return row.name;
    };
    result = value(a).localeCompare(value(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  if (result) return descending ? -result : result;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}
