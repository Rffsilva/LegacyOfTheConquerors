/** Little-endian cursor over a byte buffer, mirroring the SDL_RWread calls in the original loaders. */
export class ByteReader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private need(count: number): void {
    if (this.offset + count > this.bytes.length) {
      throw new RangeError(`Read of ${count} bytes at ${this.offset} overruns buffer of ${this.bytes.length}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.offset++];
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  take(count: number): Uint8Array {
    this.need(count);
    const out = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }

  skip(count: number): void {
    this.need(count);
    this.offset += count;
  }

  /** Reads a fixed-width field and returns the text up to the first NUL. */
  cString(width: number): string {
    const raw = this.take(width);
    const end = raw.indexOf(0);
    return latin1(end === -1 ? raw : raw.subarray(0, end));
  }
}

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
