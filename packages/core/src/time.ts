// Time zones, read through the platform's `Intl`: what a module needs to cut
// days, weeks and months in a participant's own time, without a dependency.

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Offset of a time zone from UTC at an instant, minutes east (Brussels in
 * winter: 60). Throws `time_zone_unknown` for a name that is not an IANA
 * time zone.
 */
export function offsetAt(timeZone: string, ms: number): number {
  let format = formatters.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    } catch {
      throw new Error(`time_zone_unknown: ${timeZone} is not an IANA time zone`);
    }
    formatters.set(timeZone, format);
  }
  const name = format.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!m) throw new Error(`time_zone_unknown: ${timeZone} gives the offset ${name}`);
  return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
