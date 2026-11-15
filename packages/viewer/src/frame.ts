/**
 * The local frame a place is shown in: metres east, north and up from one
 * point of it, on the tangent plane of the WGS 84 ellipsoid there.
 *
 * Geometry is stored in WGS 84 with its height in metres
 * ([0003](../../../docs/decisions/0003-geometry-wgs84-3d-utm.md)); a scene
 * is drawn in metres. A point goes from longitude, latitude and height to
 * earth-centred coordinates and then onto the east and north axes of the
 * origin's tangent plane, exactly, with no map projection between: over a
 * building or a district a metre stays a metre on the ground. Up is the
 * height above the origin's, so that a level floor or a flat roof stays
 * level across the scene instead of following the curve of the earth.
 */

/** Longitude and latitude in degrees, height in metres. */
export type Wgs84 = readonly [lon: number, lat: number, height: number];

/** Metres east and north of the frame's origin on its tangent plane, and metres above its height. */
export type Local = [east: number, north: number, up: number];

export interface LocalFrame {
  /** The point the frame starts from. */
  origin: Wgs84;
  /** A point of WGS 84 in the frame. */
  toLocal(point: Wgs84): Local;
}

// The WGS 84 ellipsoid: semi-major axis and flattening.
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const RAD = Math.PI / 180;

function ecef([lon, lat, h]: Wgs84): [number, number, number] {
  const [l, p] = [lon * RAD, lat * RAD];
  const n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + h) * Math.sin(p)];
}

/** The east-north-up frame at `origin`. */
export function localFrame(origin: Wgs84): LocalFrame {
  const [x0, y0, z0] = ecef(origin);
  const [l, p] = [origin[0] * RAD, origin[1] * RAD];
  const [sl, cl, sp, cp] = [Math.sin(l), Math.cos(l), Math.sin(p), Math.cos(p)];
  return {
    origin,
    toLocal(point) {
      const [x, y, z] = ecef(point);
      const [dx, dy, dz] = [x - x0, y - y0, z - z0];
      return [-sl * dx + cl * dy, -sp * cl * dx - sp * sl * dy + cp * dz, point[2] - origin[2]];
    },
  };
}
