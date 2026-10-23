/**
 * Make streamed WebM files seekable with a correct duration, without buffering
 * the whole file.
 *
 * MediaRecorder writes WebM whose Segment>Info has no Duration element, so players
 * show an unknown length. When the first chunk (which always holds the header and
 * the Info element) arrives, we insert a Duration element with a placeholder value
 * and remember its byte offset. On stop we overwrite those 8 bytes in place.
 */
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

interface Vint {
  value: number;
  length: number;
}

/** EBML element ID: the leading 1-bit marker is kept as part of the ID. */
function readId(buf: Uint8Array, pos: number): Vint {
  const first = buf[pos]!;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i]!;
  return { value, length };
}

/** EBML size: marker bit removed. All-ones means "unknown size" (returned as -1). */
function readSize(buf: Uint8Array, pos: number): Vint {
  const first = buf[pos]!;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i]!;
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value: allOnes ? -1 : value, length };
}

function writeSize(value: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0]! |= 0x80 >> (length - 1);
  return out;
}

function readUint(buf: Uint8Array, pos: number, length: number): number {
  let v = 0;
  for (let i = 0; i < length; i++) v = v * 256 + buf[pos + i]!;
  return v;
}

export interface DurationPatch {
  /** The first chunk with a Duration element inserted (write this instead). */
  data: Uint8Array;
  /** Byte offset of the 8-byte float to overwrite at the end. */
  durationOffset: number;
  /** Nanoseconds per timecode unit (usually 1 000 000 = 1 ms). */
  timecodeScale: number;
}

/** Returns null if the chunk does not look like the start of a WebM file. */
export function insertDurationPlaceholder(first: Uint8Array): DurationPatch | null {
  let pos = 0;
  // EBML header
  const header = readId(first, pos);
  if (header.value !== 0x1a45dfa3) return null;
  const headerSize = readSize(first, pos + header.length);
  pos += header.length + headerSize.length + headerSize.value;
  // Segment
  const segment = readId(first, pos);
  if (segment.value !== ID_SEGMENT) return null;
  const segmentSize = readSize(first, pos + segment.length);
  pos += segment.length + segmentSize.length;
  // Find Info among the Segment's children.
  while (pos < first.length) {
    const id = readId(first, pos);
    const size = readSize(first, pos + id.length);
    const contentStart = pos + id.length + size.length;
    if (id.value === ID_INFO) {
      if (size.value < 0 || contentStart + size.value > first.length) return null;
      const contentEnd = contentStart + size.value;
      let timecodeScale = 1_000_000;
      for (let p = contentStart; p < contentEnd; ) {
        const cid = readId(first, p);
        const csize = readSize(first, p + cid.length);
        const cstart = p + cid.length + csize.length;
        if (cid.value === ID_DURATION) return { data: first, durationOffset: cstart, timecodeScale }; // already present
        if (cid.value === ID_TIMECODE_SCALE) timecodeScale = readUint(first, cstart, csize.value);
        p = cstart + csize.value;
      }
      // Duration element: ID 0x4489, size 8, float64 placeholder 0.
      const element = new Uint8Array([0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]);
      const newSize = size.value + element.length;
      if (newSize >= 2 ** (7 * size.length) - 1) return null;
      const sizeBytes = writeSize(newSize, size.length);
      const out = new Uint8Array(first.length + element.length);
      out.set(first.subarray(0, pos + id.length), 0);
      out.set(sizeBytes, pos + id.length);
      out.set(first.subarray(contentStart, contentEnd), contentStart);
      out.set(element, contentEnd);
      out.set(first.subarray(contentEnd), contentEnd + element.length);
      return { data: out, durationOffset: contentEnd + 3, timecodeScale };
    }
    if (size.value < 0) return null;
    pos = contentStart + size.value;
  }
  return null;
}

/** The 8 bytes to write at `durationOffset` for a duration in milliseconds. */
export function encodeDuration(durationMs: number, timecodeScale: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, (durationMs * 1_000_000) / timecodeScale, false);
  return bytes;
}

/** Read the Duration (ms) back from a file header; for tests and diagnostics. */
export function readDurationMs(head: Uint8Array): number | null {
  const patch = insertDurationPlaceholder(head);
  if (!patch || patch.data !== head) return null;
  const view = new DataView(head.buffer, head.byteOffset + patch.durationOffset, 8);
  return (view.getFloat64(0, false) * patch.timecodeScale) / 1_000_000;
}
