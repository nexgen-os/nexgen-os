// A meter's clock to UTC. A DSMR meter writes its local time without an
// offset, `YYMMDDhhmmssX`, and a season letter X: S when its clock is on
// summer time, W otherwise. The zone is the caller's; the letter tells the
// two instants of the hour repeated in autumn apart. Nothing here knows a
// zone.

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The offset of a zone at an instant, in milliseconds east of UTC. */
function offsetAt(timeZone: string, utcMs: number): number {
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

/** The instants (ascending) a wall-clock time names in a zone: one, two in the hour repeated, none in the hour skipped. */
function instantsOf(timeZone: string, wallMs: number): number[] {
  const day = 86_400_000;
  const offsets = new Set([offsetAt(timeZone, wallMs - day), offsetAt(timeZone, wallMs), offsetAt(timeZone, wallMs + day)]);
  const out = new Set<number>();
  for (const o of offsets) {
    const u = wallMs - o;
    if (offsetAt(timeZone, u) === o) out.add(u);
  }
  return [...out].sort((a, b) => a - b);
}

/** Whether a zone is on summer time at an instant: its offset is above the lower of January's and July's that year. */
function summerAt(timeZone: string, utcMs: number): boolean {
  const year = new Date(utcMs).getUTCFullYear();
  const standard = Math.min(offsetAt(timeZone, Date.UTC(year, 0, 1)), offsetAt(timeZone, Date.UTC(year, 6, 1)));
  return offsetAt(timeZone, utcMs) > standard;
}

export type MeterTime =
  | { at: string }
  | { problem: 'date_unreadable' | 'local_time_nonexistent' | 'local_time_ambiguous' | 'season_mismatch' | 'time_zone_required'; detail: string };

/** A meter's stamp, `YYMMDDhhmmssX`, as an instant in UTC with the zone of its place. */
export function meterTime(stamp: string, timeZone: string | undefined): MeterTime {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([SW])?$/.exec(stamp.trim());
  if (!m) return { problem: 'date_unreadable', detail: `${stamp} is not YYMMDDhhmmssX` };
  const [, yy, mo, dd, hh, mi, ss, season] = m;
  const wall = Date.UTC(2000 + +yy!, +mo! - 1, +dd!, +hh!, +mi!, +ss!);
  const check = new Date(wall);
  if (check.getUTCMonth() !== +mo! - 1 || check.getUTCDate() !== +dd! || +hh! > 23 || +mi! > 59 || +ss! > 59) {
    return { problem: 'date_unreadable', detail: `${stamp} is not a date` };
  }
  if (!timeZone) return { problem: 'time_zone_required', detail: `${stamp} is the meter's local time; the zone of its place is needed` };
  const instants = instantsOf(timeZone, wall);
  if (instants.length === 0) return { problem: 'local_time_nonexistent', detail: `${stamp} does not exist in ${timeZone}: the clocks went forward` };
  const matching = season ? instants.filter((u) => summerAt(timeZone, u) === (season === 'S')) : instants;
  if (matching.length === 0) {
    return { problem: 'season_mismatch', detail: `${stamp} says ${season === 'S' ? 'summer' : 'winter'} time, which ${timeZone} is not on then` };
  }
  if (matching.length > 1) {
    return { problem: 'local_time_ambiguous', detail: `${stamp} is in the hour ${timeZone} repeats, and carries no season letter to tell which` };
  }
  return { at: new Date(matching[0]!).toISOString() };
}
