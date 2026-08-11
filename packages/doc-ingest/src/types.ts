/**
 * A file exactly as the user uploaded it. `name` is used for reporting and for
 * format detection; the bytes are never modified.
 */
export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

/** Image formats Claude's vision can read directly. */
export type IngestedImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/**
 * One piece of model-ready material extracted from an upload. Deliberately
 * vendor-neutral (no Anthropic types here) so this package stays a pure
 * file-format concern — llm-extraction maps these onto content blocks.
 */
export type IngestedAsset =
  | { kind: "image"; mediaType: IngestedImageMediaType; base64: string; label: string }
  | { kind: "pdf"; base64: string; label: string }
  /** Structured material read deterministically out of a file (Visio shapes, draw.io XML, document text). */
  | { kind: "text"; text: string; label: string };

export interface IngestResult {
  /** In upload order; one file can yield several assets (a .docx with three pasted screenshots). */
  assets: IngestedAsset[];
  /**
   * Plain-language notes about what was read, converted or skipped — e.g.
   * "diagram.docx: read 2 embedded images". These are forwarded into the
   * design's assumptions so the engineer can see how their file was treated.
   */
  notes: string[];
}

/** Thrown for a file this package cannot turn into anything a model can read. */
export class UnsupportedUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedUploadError";
  }
}
