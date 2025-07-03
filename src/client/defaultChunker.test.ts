import { defaultChunker } from "./defaultChunker.js";
import { describe, test, expect } from "vitest";

describe("defaultChunker", () => {
  test("handles empty text", () => {
    expect(defaultChunker("")).toEqual([]);
    expect(defaultChunker("   ")).toEqual([]);
  });

  test("chunks paragraphs that fit within limits", () => {
    const text = `This is the first paragraph with about 100 characters. It should be combined with others.

This is the second paragraph with similar length to make a good chunk together.

This is the third paragraph that will likely be in the next chunk.`;

    const chunks = defaultChunker(text);

    // Should combine all paragraphs since total length (238 chars) is well within limits
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(text);
    chunks.forEach((chunk: string) => {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length).toBeLessThanOrEqual(2000);
    });
    expect(chunks.join("\n")).toBe(text);
  });

  test("combines small paragraphs to meet minimum character limit", () => {
    const text = `Short para 1.

Short para 2.

Short para 3.

Short para 4.`;

    const chunks = defaultChunker(text, {
      minCharsSoftLimit: 50,
      maxCharsSoftLimit: 200,
    });

    // Should combine multiple short paragraphs
    chunks.forEach((chunk: string) => {
      expect(chunk.length).toBeGreaterThanOrEqual(50);
      expect(chunk.length).toBeLessThanOrEqual(200);
    });
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(
      "Short para 1.\n\nShort para 2.\n\nShort para 3.\n\nShort para 4."
    );
    expect(chunks.join("\n")).toBe(text);
  });

  test("splits large paragraphs by lines", () => {
    const longParagraph = Array(50)
      .fill("This is a line that makes the paragraph very long.")
      .join("\n");

    const chunks = defaultChunker(longParagraph, {
      minLines: 2,
      minCharsSoftLimit: 200,
      maxCharsSoftLimit: 500,
    });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk: string) => {
      expect(chunk.length).toBeLessThanOrEqual(500);
      // Each chunk should have at least 2 lines (minLines)
      expect(chunk.split("\n").length).toBeGreaterThanOrEqual(2);
    });
    expect(chunks.join("\n")).toBe(longParagraph);
  });

  test("respects minLines constraint when splitting", () => {
    const text =
      "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8";

    const chunks = defaultChunker(text, {
      minLines: 3,
      minCharsSoftLimit: 10,
      maxCharsSoftLimit: 30, // Very small to force splitting
    });

    chunks.forEach((chunk: string) => {
      const lineCount = chunk.split("\n").length;
      expect(lineCount).toBeGreaterThanOrEqual(3);
    });
    expect(chunks.join("\n")).toBe(text);
  });

  test("handles mixed content with paragraphs and large sections", () => {
    const text = `Small paragraph 1.

Small paragraph 2.

This is a very long paragraph that definitely exceeds the maximum character limit and should be split by lines instead of being treated as a single paragraph unit.
Line 2 of the long paragraph.
Line 3 of the long paragraph.
Line 4 of the long paragraph.
Line 5 of the long paragraph.

Another small paragraph at the end.`;

    const chunks = defaultChunker(text, {
      minLines: 1,
      minCharsSoftLimit: 100,
      maxCharsSoftLimit: 300,
    });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk: string) => {
      expect(chunk.length).toBeLessThanOrEqual(300);
      expect(chunk.trim().length).toBeGreaterThan(0);
    });
    expect(chunks.join("\n")).toBe(text);
  });

  test("uses custom delimiter", () => {
    const text = "Section 1\n---\nSection 2\n---\nSection 3";

    const chunks = defaultChunker(text, {
      delimiter: "\n---\n",
      minCharsSoftLimit: 5,
      maxCharsSoftLimit: 50,
    });

    expect(chunks.length).toBeGreaterThan(0);
    // Should be able to reconstruct original text with join("\n")
    expect(chunks.join("\n")).toBe(text);
  });

  test("handles single line that exceeds max limit", () => {
    const veryLongLine = "A".repeat(3000);

    const chunks = defaultChunker(veryLongLine, {
      minLines: 1,
      minCharsSoftLimit: 200,
      maxCharsSoftLimit: 1000,
    });

    // Should split even a single line if it's too long
    expect(chunks.length).toBe(1);
    expect(chunks.join("\n")).toBe(veryLongLine);
  });

  test("splits single line exceeding hard limit with custom hard limit", () => {
    const longLine = "A".repeat(15000);

    const chunks = defaultChunker(longLine, {
      minLines: 1,
      minCharsSoftLimit: 200,
      maxCharsSoftLimit: 1000,
      maxCharsHardLimit: 5000,
    });

    // Should be split into multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should not exceed the hard limit
    chunks.forEach((chunk: string) => {
      expect(chunk.length).toBeLessThanOrEqual(5000);
    });

    // Content should be preserved when joined back together
    expect(chunks.join("")).toBe(longLine);
  });

  test("splits extremely long single line with default hard limit", () => {
    // Create a line that exceeds the default hard limit of 10000
    const extremelyLongLine = "B".repeat(25000);

    const chunks = defaultChunker(extremelyLongLine, {
      minLines: 1,
      minCharsSoftLimit: 200,
      maxCharsSoftLimit: 1000,
      // Using default maxCharsHardLimit of 10000
    });

    // Should be split into multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should not exceed the default hard limit
    chunks.forEach((chunk: string) => {
      expect(chunk.length).toBeLessThanOrEqual(10000);
    });

    // Content should be preserved when joined back together
    expect(chunks.join("")).toBe(extremelyLongLine);

    // Should have at least 3 chunks for 25000 characters with 10000 limit
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  test("verifies hard limit splitting with different character patterns", () => {
    const longLine = "A".repeat(15000);

    const chunks = defaultChunker(longLine, {
      minLines: 1,
      minCharsSoftLimit: 200,
      maxCharsSoftLimit: 1000,
      maxCharsHardLimit: 5000,
    });

    // Should be split into multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should not exceed the hard limit
    chunks.forEach((chunk: string) => {
      expect(chunk.length).toBeLessThanOrEqual(5000);
    });

    // Content should be preserved when joined back together
    expect(chunks.join("")).toBe(longLine);
  });

  test("preserves content without losing text", () => {
    const originalText = `Paragraph 1 with some content.

Paragraph 2 with different content.


Paragraph 3 with more content.`;

    const chunks = defaultChunker(originalText);
    const reconstructed = chunks.join("\n");

    // Should be able to reconstruct original text with join("\n")
    expect(reconstructed).toBe(originalText);

    // All original words should be preserved
    const originalWords = originalText.split(/\s+/).filter((w) => w.length > 0);
    const reconstructedWords = reconstructed
      .split(/\s+/)
      .filter((w) => w.length > 0);

    expect(reconstructedWords.length).toBe(originalWords.length);
    originalWords.forEach((word) => {
      expect(reconstructed).toContain(word);
    });
    expect(chunks.join("\n")).toBe(originalText);
  });
});
