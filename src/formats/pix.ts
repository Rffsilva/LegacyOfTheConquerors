/**
 * A "pixie": OpenGlad's palette-indexed image format, used for sprites, tiles and map grids.
 *
 * Layout (graphlib.cpp read_pixie_file): u8 frame count, u8 width, u8 height,
 * then width*height*frames palette indices, frames stored one after another.
 * Index 0 is transparent for sprites. For map grids each "pixel" is a tile id.
 */
export interface Pix {
  frames: number;
  width: number;
  height: number;
  data: Uint8Array;
}

export function parsePix(bytes: Uint8Array): Pix {
  if (bytes.length < 3) throw new Error('Pix file too short');
  const [frames, width, height] = bytes;
  const size = frames * width * height;
  // A few original files are truncated; pad with transparent pixels like the original calloc did.
  const data = new Uint8Array(size);
  data.set(bytes.subarray(3, 3 + size));
  return { frames, width, height, data };
}

export function pixFrame(pix: Pix, frame: number): Uint8Array {
  const size = pix.width * pix.height;
  const f = ((frame % pix.frames) + pix.frames) % pix.frames;
  return pix.data.subarray(f * size, (f + 1) * size);
}
