import { describe, expect, it } from 'vitest';
import { compareCloudfacts, matchesCloudfact, type CloudfactFilters, type CloudfactRow } from '../src/services/gallery-filters.js';

const now = Date.parse('2026-11-16T15:00:00Z');
const row = (over: Partial<CloudfactRow> = {}): CloudfactRow => ({
  name: 'cloudfact-2',
  project: 'vault',
  visibility: 'private',
  kind: 'static',
  modifiedAt: '2026-11-16T14:00:00Z',
  search: 'cloudfact-2 vault private link static https://example.test',
  ...over,
});
const filters = (over: Partial<CloudfactFilters> = {}): CloudfactFilters => ({
  query: '',
  name: '',
  project: '*',
  visibility: '*',
  kind: '*',
  modified: '*',
  ...over,
});

describe('cloudfact column filtering and ordering', () => {
  it('combines global search with every selected column filter', () => {
    const all = filters({
      query: ' EXAMPLE.TEST ',
      name: ' FACT-2 ',
      project: 'vault',
      visibility: 'private',
      kind: 'static',
      modified: 'day',
    });
    expect(matchesCloudfact(row(), all, now)).toBe(true);
    for (const change of [{ name: 'other' }, { project: 'desk' }, { visibility: 'public' }, { kind: 'app' }, { modifiedAt: null }]) {
      expect(matchesCloudfact(row(change), all, now)).toBe(false);
    }
    expect(matchesCloudfact(row(), { ...all, query: 'missing' }, now)).toBe(false);
  });

  it('distinguishes no project from all projects', () => {
    expect(matchesCloudfact(row({ project: null }), filters({ project: '' }), now)).toBe(true);
    expect(matchesCloudfact(row(), filters({ project: '' }), now)).toBe(false);
    expect(matchesCloudfact(row({ project: null }), filters(), now)).toBe(true);
  });

  it('filters recent periods and missing dates without accepting future or invalid dates', () => {
    const old = row({ modifiedAt: '2026-11-10T15:00:00Z' });
    expect(matchesCloudfact(old, filters({ modified: 'day' }), now)).toBe(false);
    expect(matchesCloudfact(old, filters({ modified: 'week' }), now)).toBe(true);
    expect(matchesCloudfact(old, filters({ modified: 'month' }), now)).toBe(true);
    expect(matchesCloudfact(row({ modifiedAt: '2026-10-01T00:00:00Z' }), filters({ modified: 'month' }), now)).toBe(false);
    expect(matchesCloudfact(row({ modifiedAt: '2026-11-17T00:00:00Z' }), filters({ modified: 'day' }), now)).toBe(false);
    for (const modifiedAt of [null, 'invalid']) {
      expect(matchesCloudfact(row({ modifiedAt }), filters({ modified: 'none' }), now)).toBe(true);
      expect(matchesCloudfact(row({ modifiedAt }), filters({ modified: 'week' }), now)).toBe(false);
    }
  });

  it('sorts names naturally in both directions, regardless of project', () => {
    const rows = [
      row({ name: 'cloudfact-10', project: 'a' }),
      row({ name: 'cloudfact-2', project: 'z' }),
      row({ name: 'cloudfact-1', project: null }),
    ];
    expect([...rows].sort((a, b) => compareCloudfacts(a, b, 'name', false)).map((r) => r.name)).toEqual([
      'cloudfact-1',
      'cloudfact-2',
      'cloudfact-10',
    ]);
    expect([...rows].sort((a, b) => compareCloudfacts(a, b, 'name', true)).map((r) => r.name)).toEqual([
      'cloudfact-10',
      'cloudfact-2',
      'cloudfact-1',
    ]);
  });

  it('sorts dates chronologically and keeps missing dates last in either direction', () => {
    const rows = [
      row({ name: 'missing', modifiedAt: null }),
      row({ name: 'new' }),
      row({ name: 'old', modifiedAt: '2026-10-01T00:00:00Z' }),
    ];
    expect([...rows].sort((a, b) => compareCloudfacts(a, b, 'modified', false)).map((r) => r.name)).toEqual(['old', 'new', 'missing']);
    expect([...rows].sort((a, b) => compareCloudfacts(a, b, 'modified', true)).map((r) => r.name)).toEqual(['new', 'old', 'missing']);
  });

  it('filters by size band and by where the cloudfact is served from', () => {
    const MB = 1024 * 1024;
    const sized = (bytes: number | null) => row({ bytes });
    expect(matchesCloudfact(sized(200_000), filters({ size: 'small' }), now)).toBe(true);
    expect(matchesCloudfact(sized(5 * MB), filters({ size: 'small' }), now)).toBe(false);
    expect(matchesCloudfact(sized(5 * MB), filters({ size: 'medium' }), now)).toBe(true);
    expect(matchesCloudfact(sized(30 * MB), filters({ size: 'large' }), now)).toBe(true);
    expect(matchesCloudfact(sized(30 * MB), filters({ size: 'medium' }), now)).toBe(false);
    expect(matchesCloudfact(sized(null), filters({ size: 'none' }), now)).toBe(true);
    expect(matchesCloudfact(sized(null), filters({ size: 'small' }), now)).toBe(false);
    expect(matchesCloudfact(sized(10), filters({ size: 'none' }), now)).toBe(false);
    expect(matchesCloudfact(row({ origin: 'vm' }), filters({ origin: 'vm' }), now)).toBe(true);
    expect(matchesCloudfact(row({ origin: 'cloudflare' }), filters({ origin: 'vm' }), now)).toBe(false);
  });

  it('sorts by size and keeps unknown sizes last in either direction', () => {
    const rows = [row({ name: 'none', bytes: null }), row({ name: 'big', bytes: 9e6 }), row({ name: 'small', bytes: 1e3 })];
    expect([...rows].sort((a, b) => compareCloudfacts(a, b, 'size', false)).map((r) => r.name)).toEqual(['small', 'big', 'none']);
    expect([...rows].sort((a, b) => compareCloudfacts(a, b, 'size', true)).map((r) => r.name)).toEqual(['big', 'small', 'none']);
  });

  it('sorts the displayed project, access and type labels with stable name ties', () => {
    expect(compareCloudfacts(row({ project: 'a' }), row({ project: 'z' }), 'project', false)).toBeLessThan(0);
    expect(
      compareCloudfacts(
        row({ visibility: 'access', visibilityLabel: 'Sign-in' }),
        row({ visibility: 'public', visibilityLabel: 'Public' }),
        'visibility',
        false,
      ),
    ).toBeGreaterThan(0);
    expect(
      compareCloudfacts(row({ kind: 'static', kindLabel: 'Static' }), row({ kind: 'app', kindLabel: 'Server app' }), 'kind', false),
    ).toBeGreaterThan(0);
    expect(compareCloudfacts(row({ name: 'a' }), row({ name: 'b' }), 'project', true)).toBeLessThan(0);
  });
});

describe('size column', () => {
  it('shows sizes in megabytes', async () => {
    const { formatBytes } = await import('../src/services/gallery.js');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(20_000)).toBe('< 0,1 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2,5 MB');
    expect(formatBytes(36.4 * 1024 * 1024)).toBe('36 MB');
  });
});
