// A GeoTIFF of one band of 32-bit floats, uncompressed, in strips or tiles:
// what a Web Coverage Service gives for a height model. Enough to read it,
// nothing more; any other TIFF is refused by name.

/** A grid of values, north-up: cell (col, row) covers x0 + col·dx … and y0 − row·dy …, row 0 at the top. */
export interface Raster {
  /** The x of the west edge of the grid, in the coverage's reference system. */
  x0: number;
  /** The y of the north edge of the grid. */
  y0: number;
  /** The width of a cell along x. */
  dx: number;
  /** The height of a cell along y, positive. */
  dy: number;
  width: number;
  height: number;
  /** Row by row from the north, `NaN` where the coverage has no value. */
  values: Float32Array;
}

const TAG = {
  width: 256, height: 257, bitsPerSample: 258, compression: 259, stripOffsets: 273, samplesPerPixel: 277,
  rowsPerStrip: 278, tileWidth: 322, tileLength: 323, tileOffsets: 324, sampleFormat: 339,
  pixelScale: 33550, tiepoint: 33922, nodata: 42113,
} as const;

const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

/**
 * The first TIFF in `bytes` — a file, or the `multipart/related` answer of a
 * WCS 2.0 GetCoverage whose second part is the TIFF — as a `Raster`. Refuses
 * `tiff_not_found` without one and `tiff_unsupported` for anything but one
 * band of uncompressed 32-bit floats placed by a pixel scale and a tie point.
 */
export function readGeoTiff(bytes: Uint8Array): Raster {
  const start = findTiff(bytes);
  if (start < 0) throw new Error('tiff_not_found: the answer holds no TIFF');
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.byteLength - start);
  const little = view.getUint8(0) === 0x49;
  if (view.getUint16(2, little) !== 42) throw new Error('tiff_unsupported: BigTIFF or not a TIFF');

  const ifd = view.getUint32(4, little);
  const count = view.getUint16(ifd, little);
  const tags = new Map<number, number[]>();
  const strings = new Map<number, string>();
  for (let i = 0; i < count; i += 1) {
    const at = ifd + 2 + 12 * i;
    const tag = view.getUint16(at, little);
    const type = view.getUint16(at + 2, little);
    const n = view.getUint32(at + 4, little);
    const size = (SIZE[type] ?? 1) * n;
    const offset = size <= 4 ? at + 8 : view.getUint32(at + 8, little);
    if (type === 2) {
      strings.set(tag, new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + offset, n)).replace(/\0+$/, ''));
      continue;
    }
    const values: number[] = [];
    for (let k = 0; k < n; k += 1) {
      const p = offset + k * (SIZE[type] ?? 1);
      values.push(type === 3 ? view.getUint16(p, little) : type === 4 ? view.getUint32(p, little)
        : type === 12 ? view.getFloat64(p, little) : type === 11 ? view.getFloat32(p, little) : view.getUint8(p));
    }
    tags.set(tag, values);
  }
  const one = (tag: number, fallback?: number) => {
    const v = tags.get(tag)?.[0] ?? fallback;
    if (v === undefined) throw new Error(`tiff_unsupported: tag ${tag} missing`);
    return v;
  };

  if (one(TAG.compression, 1) !== 1) throw new Error('tiff_unsupported: compressed');
  if (one(TAG.samplesPerPixel, 1) !== 1) throw new Error('tiff_unsupported: more than one band');
  if (one(TAG.bitsPerSample) !== 32 || one(TAG.sampleFormat, 1) !== 3) throw new Error('tiff_unsupported: not 32-bit floats');
  const scale = tags.get(TAG.pixelScale);
  const tie = tags.get(TAG.tiepoint);
  if (!scale || !tie) throw new Error('tiff_unsupported: not placed by a pixel scale and a tie point');

  const width = one(TAG.width);
  const height = one(TAG.height);
  const nodataText = strings.get(TAG.nodata);
  const nodata = nodataText !== undefined && nodataText.trim() !== '' ? Number(nodataText) : null;
  const values = new Float32Array(width * height).fill(Number.NaN);
  const put = (col: number, row: number, p: number) => {
    const v = view.getFloat32(p, little);
    values[row * width + col] = nodata !== null && v === nodata ? Number.NaN : v;
  };

  if (tags.has(TAG.tileOffsets)) {
    const tw = one(TAG.tileWidth);
    const th = one(TAG.tileLength);
    const across = Math.ceil(width / tw);
    tags.get(TAG.tileOffsets)!.forEach((offset, t) => {
      const c0 = (t % across) * tw;
      const r0 = Math.floor(t / across) * th;
      for (let r = 0; r < th && r0 + r < height; r += 1) {
        for (let c = 0; c < tw && c0 + c < width; c += 1) put(c0 + c, r0 + r, offset + 4 * (r * tw + c));
      }
    });
  } else {
    const rowsPerStrip = one(TAG.rowsPerStrip, height);
    (tags.get(TAG.stripOffsets) ?? []).forEach((offset, s) => {
      for (let r = 0; r < rowsPerStrip && s * rowsPerStrip + r < height; r += 1) {
        for (let c = 0; c < width; c += 1) put(c, s * rowsPerStrip + r, offset + 4 * (r * width + c));
      }
    });
  }

  // The tie point gives the model point of a raster point: (i, j) ↦ (x, y).
  const [i, j, , x, y] = tie;
  return { x0: x - i * scale[0], y0: y + j * scale[1], dx: scale[0], dy: scale[1], width, height, values };
}

function findTiff(bytes: Uint8Array): number {
  for (let i = 0; i + 4 <= bytes.length; i += 1) {
    if (bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 42 && bytes[i + 3] === 0) return i;
    if (bytes[i] === 0x4d && bytes[i + 1] === 0x4d && bytes[i + 2] === 0 && bytes[i + 3] === 42) return i;
  }
  return -1;
}
