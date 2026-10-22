// Local wall-clock time to UTC, with the zone the caller gives: the one
// conversion a file dated in legal time without an offset needs. Nothing
// here knows a zone; an hour repeated when the clocks go back has two
// instants, an hour skipped when they go forward has none.

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The offset of a zone at an instant, in milliseconds east of UTC. */
export function offsetAt(timeZone: string, utcMs: number): number {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instants (UTC milliseconds, ascending) a wall-clock time names in a
 * zone: one, two in the hour repeated in autumn, none in the hour skipped
 * in spring. `wallMs` is the wall-clock time read as if it were UTC.
 */
export function instantsOf(timeZone: string, wallMs: number): number[] {
  const day = 86_400_000;
  const offsets = new Set([offsetAt(timeZone, wallMs - day), offsetAt(timeZone, wallMs), offsetAt(timeZone, wallMs + day)]);
  const out = new Set<number>();
  for (const o of offsets) {
    const u = wallMs - o;
    if (offsetAt(timeZone, u) === o) out.add(u);
  }
  return [...out].sort((a, b) => a - b);
}

/** An ISO 8601 duration of hours, minutes or seconds (`PT5M`, `PT1H`, `P1D`) in milliseconds; null otherwise. */
export function durationMs(iso: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m || iso === 'P' || iso.endsWith('T')) return null;
  return ((+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 60_000 + +(m[4] ?? 0) * 1000;
}
