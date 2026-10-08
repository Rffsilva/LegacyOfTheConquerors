import { ByteReader } from './binary.ts';

const HEADER = 'GladPack';
const FILENAME_SIZE = 13;

/**
 * Unpacks a GladPack archive (graphics.001, levels.001).
 *
 * Layout: "GladPack", i16 file count, then per file an i32 offset followed by a
 * 13-byte NUL-padded name, then an i32 total archive size. Each entry runs until
 * the next entry's offset (or the archive size for the last one).
 */
export function parseGladPack(bytes: Uint8Array): Map<string, Uint8Array> {
  const r = new ByteReader(bytes);
  const header = r.cString(HEADER.length);
  if (header !== HEADER) throw new Error(`Not a GladPack archive (header "${header}")`);

  const count = r.i16();
  const entries: { name: string; offset: number }[] = [];
  for (let i = 0; i < count; i++) {
    const offset = r.i32();
    const name = r.cString(FILENAME_SIZE).toLowerCase();
    entries.push({ name, offset });
  }
  const totalSize = Math.min(r.i32(), bytes.length);

  const files = new Map<string, Uint8Array>();
  entries.forEach((entry, i) => {
    const end = i + 1 < entries.length ? entries[i + 1].offset : totalSize;
    files.set(entry.name, bytes.subarray(entry.offset, end));
  });
  return files;
}
