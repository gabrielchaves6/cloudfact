const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Parses "30m", "24h", "7d", "2w", "90s" (or plain seconds) into milliseconds. */
export function parseDuration(input: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smhdw])?\s*$/i.exec(input);
  if (!m) throw new Error(`invalid duration "${input}" (use e.g. 30m, 24h, 7d)`);
  const ms = Number(m[1]) * UNITS[(m[2] ?? 's').toLowerCase()];
  if (!(ms > 0)) throw new Error(`invalid duration "${input}"`);
  return ms;
}

export function expiryFrom(duration: string | undefined, now = Date.now()): string | null {
  return duration ? new Date(now + parseDuration(duration)).toISOString() : null;
}
