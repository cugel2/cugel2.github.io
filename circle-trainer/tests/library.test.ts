import { describe, expect, it } from "vitest";
import { bookKindOf, newBookId } from "../src/copy/library";

describe("copy library helpers", () => {
  it("recognises PDFs by type or extension and images by type", () => {
    expect(bookKindOf({ name: "Loomis.pdf", type: "application/pdf" })).toBe("pdf");
    expect(bookKindOf({ name: "scan.PDF", type: "" })).toBe("pdf");
    expect(bookKindOf({ name: "page.jpg", type: "image/jpeg" })).toBe("image");
    expect(bookKindOf({ name: "notes.txt", type: "text/plain" })).toBeNull();
  });

  it("makes ids without crypto.randomUUID", () => {
    expect(newBookId(0, () => 0)).toBe("book-0-000000");
    expect(newBookId(1_700_000_000_000, () => 0.5)).not.toBe(newBookId(1_700_000_000_000, () => 0.25));
  });
});
