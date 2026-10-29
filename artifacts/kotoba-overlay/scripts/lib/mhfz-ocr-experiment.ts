// Experimental preprocessing only. Not imported by the application:
// it regressed on held-out samples and must not be enabled by default.
export type DialogueRegion = { x: number; y: number; width: number; height: number };

export const MHFZ_NPC_DIALOGUE: DialogueRegion = {
  x: 0.378, y: 0.800, width: 0.243, height: 0.105,
};

export function dialoguePixelBounds(region: DialogueRegion, width: number, height: number) {
  const x = Math.max(0, Math.min(width - 1, Math.round(region.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(region.y * height)));
  return {
    left: x, top: y,
    width: Math.max(1, Math.min(width - x, Math.round(region.width * width))),
    height: Math.max(1, Math.min(height - y, Math.round(region.height * height))),
  };
}

/** Locate horizontal bands using light and yellow glyphs, excluding green/red. */
export function mhfzTextRows(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number) {
  const runs: Array<{ top: number; height: number }> = [];
  let start = -1;
  let last = -1;
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!;
      if ((Math.min(r, g, b) >= 165 && Math.max(r, g, b) - Math.min(r, g, b) <= 75)
        || (r >= 170 && g >= 155 && b < g * .7)) count++;
    }
    if (count >= Math.max(8, width * .012)) {
      if (start < 0) start = y;
      last = y;
    }
    if (start >= 0 && (y - last > 2 || y === height - 1)) {
      if (last - start >= 5) {
        const top = Math.max(0, start - 3);
        runs.push({ top, height: Math.min(height, last + 4) - top });
      }
      start = -1;
    }
  }
  return runs;
}

/** Identical, deterministic bilinear/gray input generation for experiments. */
export function prepareMhfzLine(
  pixels: Uint8ClampedArray | Uint8Array, width: number, height: number,
  row: { top: number; height: number },
) {
  const scale = Math.min(2, 1600 / width);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(row.height * scale));
  const border = 8;
  const outputWidth = targetWidth + border * 2;
  const outputHeight = targetHeight + border * 2;
  const data = new Uint8ClampedArray(outputWidth * outputHeight * 4).fill(255);
  const luminance = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return .2126 * pixels[offset]! + .7152 * pixels[offset + 1]! + .0722 * pixels[offset + 2]!;
  };
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.max(0, Math.min(row.height - 1, (y + .5) / scale - .5)) + row.top;
    const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.max(0, Math.min(width - 1, (x + .5) / scale - .5));
      const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      const top = luminance(x0, y0) * (1 - fx) + luminance(x1, y0) * fx;
      const bottom = luminance(x0, y1) * (1 - fx) + luminance(x1, y1) * fx;
      const value = Math.max(0, Math.min(255, (top * (1 - fy) + bottom * fy) * 1.12 - 15.3));
      const offset = ((y + border) * outputWidth + x + border) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = value;
    }
  }
  return { data, width: outputWidth, height: outputHeight };
}
