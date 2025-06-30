export function guessMimeTypeFromExtension(
  filename: string
): string | undefined {
  const extension = filename.split(".").pop();
  if (!extension || extension.includes(" ")) {
    return undefined;
  }
  switch (extension.toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "txt":
    case "rtf":
      return "text/plain";
    case "json":
      return "application/json";
    case "xml":
      return "application/xml";
    case "html":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
    case "cjs":
    case "mjs":
    case "jsx":
    case "ts":
    case "tsx":
      return "text/javascript";
    case "md":
    case "mdx":
      return "text/markdown";
    case "csv":
      return "text/csv";
    case "zip":
      return "application/zip";
    case "apng":
      return "image/apng";
    case "png":
      return "image/png";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "tiff":
      return "image/tiff";
    case "ico":
      return "image/x-icon";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "mp1":
    case "mp2":
    case "mp3":
      return "audio/mpeg";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}
/**
 * Return a best-guess MIME type based on the magic-number signature
 * found at the start of an ArrayBuffer.
 *
 * @param buf – the source ArrayBuffer
 * @returns the detected MIME type, or `"application/octet-stream"` if unknown
 */

export function guessMimeTypeFromContents(buf: ArrayBuffer | string): string {
  if (typeof buf === "string") {
    if (buf.match(/^data:\w+\/\w+;base64/)) {
      return buf.split(";")[0].split(":")[1]!;
    }
    return "text/plain";
  }
  if (buf.byteLength < 4) return "application/octet-stream";

  // Read the first 12 bytes (enough for all signatures below)
  const bytes = new Uint8Array(buf.slice(0, 12));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Helper so we can look at only the needed prefix
  const startsWith = (sig: string) => hex.startsWith(sig.toLowerCase());

  // --- image formats ---
  if (startsWith("89504e47")) return "image/png"; // PNG  - 89 50 4E 47
  if (
    startsWith("ffd8ffdb") ||
    startsWith("ffd8ffe0") ||
    startsWith("ffd8ffee") ||
    startsWith("ffd8ffe1")
  )
    return "image/jpeg"; // JPEG
  if (startsWith("47494638")) return "image/gif"; // GIF
  if (startsWith("424d")) return "image/bmp"; // BMP
  if (startsWith("52494646") && hex.substr(16, 8) === "57454250")
    return "image/webp"; // WEBP (RIFF....WEBP)
  if (startsWith("49492a00")) return "image/tiff"; // TIFF

  // <svg in hex is 3c 3f 78 6d 6c
  if (startsWith("3c737667")) return "image/svg+xml"; // <svg
  if (startsWith("3c3f786d")) return "image/svg+xml"; // <?xm

  // --- audio/video ---
  if (startsWith("494433")) return "audio/mpeg"; // MP3 (ID3)
  if (startsWith("000001ba") || startsWith("000001b3")) return "video/mpeg"; // MPEG container
  if (startsWith("1a45dfa3")) return "video/webm"; // WEBM / Matroska
  if (startsWith("00000018") && hex.substr(16, 8) === "66747970")
    return "video/mp4"; // MP4
  if (startsWith("4f676753")) return "audio/ogg"; // OGG / Opus

  // --- documents & archives ---
  if (startsWith("25504446")) return "application/pdf"; // PDF
  if (
    startsWith("504b0304") ||
    startsWith("504b0506") ||
    startsWith("504b0708")
  )
    return "application/zip"; // ZIP / DOCX / PPTX / XLSX / EPUB
  if (startsWith("52617221")) return "application/x-rar-compressed"; // RAR
  if (startsWith("7f454c46")) return "application/x-elf"; // ELF binaries
  if (startsWith("1f8b08")) return "application/gzip"; // GZIP
  if (startsWith("425a68")) return "application/x-bzip2"; // BZIP2
  if (startsWith("3c3f786d6c")) return "application/xml"; // XML

  // Plain text, JSON and others are trickier—fallback:
  return "application/octet-stream";
}
/**
 * Make a contentHash of a Blob that matches the File Storage metadata, allowing
 * identifying when content is identical.
 * @param blob The contents to hash
 * @returns sha256 hash of the contents
 */

export async function contentHashFromArrayBuffer(buffer: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Split a filename into a keyword-friendly string. Specifically adds sections
 * of camelCase and TitleCase into a space-separated strings.
 * e.g. "MyFile is soGreat.txt" -> "MyFile is soGreat.txt My File so Great"
 * Note: it doesn't split up titles that don't have a file extension.
 */
export function splitFilename(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const parts = title.split(".");
  if (parts.pop()?.includes(" ")) {
    // There isn't an extension, so don't treat it as a filename
    return title;
  }
  // split up camelCase into "camel Case"
  return [
    title,
    ...parts.flatMap((part) => {
      const words = part.split(" ");
      const camelCaseWords = words.flatMap((word) => {
        const pieces = word.split(/(?=[A-Z])/);
        if (pieces.length === 1) {
          // This will already be verbatim in the regular title parts
          return [];
        }
        return pieces;
      });
      return camelCaseWords;
    }),
  ].join(" ");
}
