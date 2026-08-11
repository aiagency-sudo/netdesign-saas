import { unzipSync } from "fflate";
import { describeVisioPages, parseVisioFile } from "./visio.js";
import {
  UnsupportedUploadError,
  type IngestResult,
  type IngestedAsset,
  type IngestedImageMediaType,
  type UploadedFile,
} from "./types.js";

/** Claude's per-image limit; a larger image is rejected with advice rather than silently truncated. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
/** Structured text (Visio/draw.io/document text) is capped so one huge file can't crowd out the rest. */
const MAX_TEXT_CHARS = 100_000;

const IMAGE_MEDIA_TYPES: Record<string, IngestedImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Turns uploaded files into material a model can actually read.
 *
 * Two paths, chosen per format:
 *  - **Structured** (.vsdx, .drawio, .svg): parsed deterministically into text.
 *    A diagram file records its shapes and connections exactly; reading them is
 *    a parsing problem, not a vision one, and gives far better fidelity than
 *    looking at a rendering.
 *  - **Visual** (.png/.jpg/.gif/.webp, .pdf, images embedded in .docx): handed
 *    to the model as an image or document block.
 *
 * Nothing is ever silently dropped: a format that can't be read raises
 * {@link UnsupportedUploadError} naming the file, and anything converted along
 * the way is described in `notes`.
 */
export function ingestUploads(files: UploadedFile[]): IngestResult {
  if (files.length === 0) {
    throw new UnsupportedUploadError("Upload at least one file.");
  }

  const assets: IngestedAsset[] = [];
  const notes: string[] = [];

  for (const file of files) {
    const result = ingestOne(file);
    assets.push(...result.assets);
    notes.push(...result.notes);
  }

  if (assets.length === 0) {
    throw new UnsupportedUploadError("None of those files contained a diagram or document that could be read.");
  }

  return { assets, notes };
}

function ingestOne(file: UploadedFile): IngestResult {
  const extension = (file.name.split(".").pop() ?? "").toLowerCase();
  const imageMediaType = IMAGE_MEDIA_TYPES[extension] ?? sniffImageMediaType(file.bytes);

  if (imageMediaType) {
    if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new UnsupportedUploadError(
        `${file.name} is ${megabytes(file.bytes.byteLength)} — images must be under ${megabytes(MAX_IMAGE_BYTES)}. Save it at a lower resolution and try again.`,
      );
    }
    return {
      assets: [{ kind: "image", mediaType: imageMediaType, base64: toBase64(file.bytes), label: file.name }],
      notes: [],
    };
  }

  if (extension === "pdf" || startsWith(file.bytes, "%PDF")) {
    if (file.bytes.byteLength > MAX_PDF_BYTES) {
      throw new UnsupportedUploadError(
        `${file.name} is ${megabytes(file.bytes.byteLength)} — PDFs must be under ${megabytes(MAX_PDF_BYTES)}.`,
      );
    }
    return { assets: [{ kind: "pdf", base64: toBase64(file.bytes), label: file.name }], notes: [] };
  }

  if (extension === "vsdx" || extension === "vsdm") {
    return ingestVisio(file);
  }

  if (extension === "docx") {
    return ingestDocx(file);
  }

  if (extension === "drawio" || extension === "svg" || extension === "xml") {
    const text = new TextDecoder().decode(file.bytes);
    return {
      assets: [{ kind: "text", text: truncate(text), label: file.name }],
      notes: [`${file.name}: read as diagram XML.`],
    };
  }

  if (extension === "doc") {
    throw new UnsupportedUploadError(
      `${file.name} is a legacy Word (.doc) file, which can't be read directly. Save it as .docx or export it as a PDF and upload that.`,
    );
  }

  if (extension === "vsd") {
    throw new UnsupportedUploadError(
      `${file.name} is a legacy Visio (.vsd) file, which can't be read directly. Open it in Visio and save as .vsdx, or export it as a PDF or PNG.`,
    );
  }

  throw new UnsupportedUploadError(
    `${file.name} isn't a format that can be read. Upload a PNG, JPEG, PDF, Word (.docx), Visio (.vsdx), draw.io or SVG file.`,
  );
}

function ingestVisio(file: UploadedFile): IngestResult {
  let description: string;
  try {
    description = describeVisioPages(parseVisioFile(file.bytes));
  } catch (cause) {
    throw new UnsupportedUploadError(`${file.name} couldn't be read as a Visio file: ${(cause as Error).message}`);
  }

  return {
    assets: [{ kind: "text", text: truncate(description), label: file.name }],
    notes: [
      `${file.name}: read the Visio shapes and connections directly from the file. Shape positions and styling were ignored — only device names, shape data and links were used.`,
    ],
  };
}

/**
 * A .docx is a zip. Network sketches arrive in Word documents as pasted
 * screenshots, so the embedded images are the diagram — they're extracted and
 * sent as images, with the document's own text sent alongside as context
 * (it often holds the requirements the picture doesn't show).
 */
function ingestDocx(file: UploadedFile): IngestResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(file.bytes);
  } catch (cause) {
    throw new UnsupportedUploadError(`${file.name} couldn't be read as a Word document: ${(cause as Error).message}`);
  }

  const assets: IngestedAsset[] = [];
  const notes: string[] = [];

  const imagePaths = Object.keys(entries)
    .filter((path) => /^word\/media\//i.test(path))
    .sort();

  let skippedLarge = 0;
  for (const path of imagePaths) {
    const bytes = entries[path]!;
    const mediaType = IMAGE_MEDIA_TYPES[(path.split(".").pop() ?? "").toLowerCase()] ?? sniffImageMediaType(bytes);
    if (!mediaType) continue;
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      skippedLarge++;
      continue;
    }
    assets.push({
      kind: "image",
      mediaType,
      base64: toBase64(bytes),
      label: `${file.name} — ${path.replace(/^word\/media\//i, "")}`,
    });
  }

  const documentText = entries["word/document.xml"] ? readDocxText(entries["word/document.xml"]) : "";
  if (documentText) {
    assets.push({ kind: "text", text: truncate(documentText), label: `${file.name} — document text` });
  }

  if (assets.length === 0) {
    throw new UnsupportedUploadError(
      `${file.name} has no diagram images and no readable text. If the diagram is drawn with Word shapes rather than pasted as a picture, export the document as a PDF and upload that instead.`,
    );
  }

  const imageCount = assets.filter((asset) => asset.kind === "image").length;
  notes.push(
    `${file.name}: read ${imageCount} embedded image${imageCount === 1 ? "" : "s"}${documentText ? " and the document text" : ""}.`,
  );
  if (skippedLarge > 0) {
    notes.push(`${file.name}: skipped ${skippedLarge} embedded image(s) larger than ${megabytes(MAX_IMAGE_BYTES)}.`);
  }
  // Word shapes/SmartArt live in the document XML as drawing markup, not as
  // media files, so a diagram drawn that way yields no image — say so rather
  // than letting the model see only the caption.
  if (imageCount === 0) {
    notes.push(
      `${file.name}: no pasted images were found — if the diagram is drawn with Word shapes, export the document as a PDF and upload that for a faithful read.`,
    );
  }

  return { assets, notes };
}

/** Pulls the visible text out of word/document.xml — paragraphs become lines. */
function readDocxText(bytes: Uint8Array): string {
  const xml = new TextDecoder().decode(bytes);
  const paragraphs: string[] = [];

  for (const paragraph of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const runs = [...paragraph[1]!.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((run) => run[1]!);
    const line = decodeXmlEntities(runs.join("")).trim();
    if (line) paragraphs.push(line);
  }

  return paragraphs.join("\n");
}

function sniffImageMediaType(bytes: Uint8Array): IngestedImageMediaType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (startsWith(bytes, "GIF8")) return "image/gif";
  if (startsWith(bytes, "RIFF") && bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function startsWith(bytes: Uint8Array, ascii: string): boolean {
  if (bytes.length < ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function truncate(text: string): string {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n… (truncated)` : text;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
