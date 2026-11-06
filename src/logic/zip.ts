/**
 * iNaturalist emails its export as a .zip holding the CSV and a README. This
 * reads that zip in the browser (no library): it finds the first .csv file and
 * unpacks it with the browser's built-in DecompressionStream. Only "stored" and
 * "deflate" entries are supported, which is what the zip tool writes.
 */

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function entries(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This zip file looks damaged or incomplete.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out: Entry[] = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL) {
      throw new ZipError("This zip file looks damaged or incomplete.");
    }
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns the text of the first CSV file in the zip. */
export async function readCsvFromZip(bytes: Uint8Array): Promise<string> {
  const csv = entries(bytes).find((e) => /\.csv$/i.test(e.name) && !e.name.startsWith("__MACOSX/"));
  if (!csv) throw new ZipError("There's no CSV file inside this zip. Look for the observations .csv in it, or export again.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = csv.localOffset;
  if (lo + 30 > bytes.length || view.getUint32(lo, true) !== LOCAL) {
    throw new ZipError("This zip file looks damaged or incomplete.");
  }
  const start = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true);
  const data = bytes.subarray(start, start + csv.compressedSize);
  let raw: Uint8Array;
  if (csv.method === 0) raw = data;
  else if (csv.method === 8) {
    if (typeof DecompressionStream === "undefined") {
      throw new ZipError("This browser can't open zip files. Unzip the file first (double-click it), then choose the .csv inside.");
    }
    try {
      raw = await inflateRaw(data);
    } catch {
      throw new ZipError("This zip file looks damaged or incomplete.");
    }
  } else {
    throw new ZipError("This zip file uses a kind of packing the app can't open. Unzip it first, then choose the .csv inside.");
  }
  return new TextDecoder().decode(raw);
}
