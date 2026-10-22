// Geometry shared by the importers: faces as rings of 3D points in a
// projected CRS in metres, their WKT and their orientation.

export type Point = [number, number, number];

export function polygonWkt(rings: Point[][]): string {
  return `POLYGON Z (${rings.map((ring) => `(${closed(ring).map((p) => `${p[0]} ${p[1]} ${p[2]}`).join(',')})`).join(',')})`;
}

export function closed(ring: Point[]): Point[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] && first[2] === last[2] ? ring : [...ring, first];
}

/**
 * The outward unit normal of a face by Newell's method, its tilt (degrees
 * from horizontal) and its azimuth in the grid of the face's CRS (degrees
 * clockwise from grid north). Rings are counter-clockwise seen from
 * outside, in a projected CRS in metres. The imports measure the azimuth
 * against true north instead, since grid north drifts from it away from a
 * projection's central meridian.
 */
export function orientation(ring: Point[]): { azimuth: number; tilt: number | null; normal: [number, number, number] } {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return { azimuth: 0, tilt: null, normal: [0, 0, 0] };
  const tilt = (Math.acos(nz / length) * 180) / Math.PI;
  const azimuth = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
  return { azimuth, tilt, normal: [nx / length, ny / length, nz / length] };
}
