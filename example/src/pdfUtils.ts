import * as pdfjsLib from "pdfjs-dist";

// Set the worker source for PDF.js - using local worker file to avoid CORS issues
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf-worker/pdf.worker.min.js';

export interface PdfExtractionResult {
  text: string;
  pages: number;
  title?: string;
  author?: string;
  subject?: string;
}

export async function extractTextFromPdf(
  file: File
): Promise<PdfExtractionResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = "";
    const numPages = pdf.numPages;

    // Extract text from all pages
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Combine text items with proper spacing and line breaks
      const pageText = textContent.items
        .map((item) => {
          if ("str" in item) {
            // Check if this text item is followed by a line break
            return item.str + (item.hasEOL ? "\n" : "");
          }
          return "";
        })
        .filter(Boolean)
        .join(" ")
        .replace(/\s+\n/g, "\n"); // Clean up spaces before newlines
      // .replace(/\n\s+/g, "\n"); // Clean up spaces after newlines

      fullText += pageText + "\n\n";
    }

    // Get metadata
    const metadata = await pdf.getMetadata();
    const info = metadata.info as any;

    return {
      text: fullText.trim(),
      pages: numPages,
      title: info?.Title,
      author: info?.Author,
      subject: info?.Subject,
    };
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw new Error(
      "Failed to extract text from PDF. The file may be corrupted or password-protected."
    );
  }
}

export function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}
