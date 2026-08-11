import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { UnsupportedUploadError, ingestUploads } from "../src/ingest.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF_BYTES = strToU8("%PDF-1.7\n1 0 obj\n");

function docx(parts: Record<string, Uint8Array>): Uint8Array {
  return zipSync(parts);
}

describe("ingestUploads — images", () => {
  it("passes a PNG through as an image asset", () => {
    const { assets } = ingestUploads([{ name: "whiteboard.png", bytes: PNG_BYTES }]);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ kind: "image", mediaType: "image/png", label: "whiteboard.png" });
  });

  it("detects an image from its magic bytes when the extension lies", () => {
    const { assets } = ingestUploads([{ name: "sketch.bin", bytes: JPEG_BYTES }]);
    expect(assets[0]).toMatchObject({ kind: "image", mediaType: "image/jpeg" });
  });

  it("rejects an oversized image with advice instead of truncating it", () => {
    const huge = new Uint8Array(6 * 1024 * 1024);
    huge.set(PNG_BYTES.slice(0, 8));
    expect(() => ingestUploads([{ name: "huge.png", bytes: huge }])).toThrow(UnsupportedUploadError);
    expect(() => ingestUploads([{ name: "huge.png", bytes: huge }])).toThrow(/lower resolution/);
  });
});

describe("ingestUploads — PDF", () => {
  it("passes a PDF through as a document asset", () => {
    const { assets } = ingestUploads([{ name: "topology.pdf", bytes: PDF_BYTES }]);
    expect(assets[0]).toMatchObject({ kind: "pdf", label: "topology.pdf" });
  });
});

describe("ingestUploads — Word", () => {
  it("extracts pasted screenshots and the document text", () => {
    const bytes = docx({
      "word/media/image1.png": PNG_BYTES,
      "word/media/image2.jpeg": JPEG_BYTES,
      "word/document.xml": strToU8(
        '<w:document><w:body><w:p><w:r><w:t>Branch office</w:t></w:r></w:p><w:p><w:r><w:t>Two routers &amp; a firewall</w:t></w:r></w:p></w:body></w:document>',
      ),
    });

    const { assets, notes } = ingestUploads([{ name: "design.docx", bytes }]);

    const images = assets.filter((asset) => asset.kind === "image");
    expect(images).toHaveLength(2);
    const text = assets.find((asset) => asset.kind === "text");
    expect(text).toBeDefined();
    expect(text!.kind === "text" && text.text).toBe("Branch office\nTwo routers & a firewall");
    expect(notes.join(" ")).toContain("read 2 embedded images");
  });

  it("says so when a Word file has text but no pasted diagram", () => {
    const bytes = docx({
      "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>See diagram</w:t></w:r></w:p></w:body></w:document>"),
    });
    const { notes } = ingestUploads([{ name: "notes.docx", bytes }]);
    expect(notes.join(" ")).toContain("no pasted images were found");
  });

  it("rejects an empty Word file rather than importing nothing", () => {
    expect(() => ingestUploads([{ name: "blank.docx", bytes: docx({ "docProps/app.xml": strToU8("<a/>") }) }])).toThrow(
      /no diagram images and no readable text/,
    );
  });
});

describe("ingestUploads — legacy formats", () => {
  it("tells the user how to convert a .doc", () => {
    expect(() => ingestUploads([{ name: "old.doc", bytes: strToU8("junk") }])).toThrow(/Save it as \.docx/);
  });

  it("tells the user how to convert a .vsd", () => {
    expect(() => ingestUploads([{ name: "old.vsd", bytes: strToU8("junk") }])).toThrow(/save as \.vsdx/);
  });

  it("names the file it can't read", () => {
    expect(() => ingestUploads([{ name: "topology.zip", bytes: strToU8("junk") }])).toThrow(/topology\.zip/);
  });
});

describe("ingestUploads — multiple files", () => {
  it("keeps every asset, in upload order", () => {
    const { assets } = ingestUploads([
      { name: "page1.png", bytes: PNG_BYTES },
      { name: "notes.pdf", bytes: PDF_BYTES },
    ]);
    expect(assets.map((asset) => asset.label)).toEqual(["page1.png", "notes.pdf"]);
  });
});
