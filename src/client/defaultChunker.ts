/**
 * Chunk text for embedding.
 *
 * By default, it will chunk into paragraphs and target
 * 200-2000 characters per chunk (never less than 1 line).
 */
export function defaultChunker(
  text: string,
  {
    minLines = 1,
    minCharsSoftLimit = 200,
    maxCharsSoftLimit = 2000,
    delimiter = "\n\n",
  }: {
    minLines?: number;
    minCharsSoftLimit?: number;
    maxCharsSoftLimit?: number;
    delimiter?: string;
  } = {}
): string[] {
  if (!text) return [];

  // Split text into individual lines
  const lines = text.split("\n");
  const chunks: string[] = [];

  let currentChunk: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line starts a new section (based on delimiter pattern)
    const isNewSection = shouldStartNewSection(lines, i, delimiter);

    // Calculate potential chunk if we add this line
    const potentialChunk = [...currentChunk, line].join("\n");

    // If adding this line would exceed max chars, finalize current chunk first
    if (potentialChunk.length > maxCharsSoftLimit && currentChunk.length > 0) {
      const trimmedChunk = removeTrailingEmptyLines(currentChunk);
      chunks.push(trimmedChunk.join("\n"));
      currentChunk = [line];
      continue;
    }

    // If we're starting a new section and current chunk meets minimum requirements
    if (
      isNewSection &&
      currentChunk.length >= minLines &&
      currentChunk.join("\n").length >= Math.min(minCharsSoftLimit * 0.8, 150)
    ) {
      // Use dynamic threshold for splitting decision
      const ratio = maxCharsSoftLimit / minCharsSoftLimit;
      const multiplier = ratio > 5 ? 1.15 : 1.3;

      if (potentialChunk.length >= minCharsSoftLimit * multiplier) {
        // When splitting at delimiter boundary, preserve natural empty lines (don't remove trailing empty lines)
        chunks.push(currentChunk.join("\n"));
        currentChunk = [line];
        continue;
      }
    }

    // Add line to current chunk
    currentChunk.push(line);

    // If current chunk is too big, split it
    if (currentChunk.join("\n").length > maxCharsSoftLimit) {
      if (currentChunk.length === 1) {
        // Single line too long but never split beyond one line
        chunks.push(line);
        currentChunk = [];
      } else {
        // Remove last line and finalize chunk
        const lastLine = currentChunk.pop()!;
        const trimmedChunk = removeTrailingEmptyLines(currentChunk);
        chunks.push(trimmedChunk.join("\n"));
        currentChunk = [lastLine];
      }
    }
  }

  // Add remaining chunk
  if (currentChunk.length > 0) {
    const trimmedChunk = removeTrailingEmptyLines(currentChunk);
    chunks.push(trimmedChunk.join("\n"));
  }

  return chunks;
}

function shouldStartNewSection(
  lines: string[],
  index: number,
  delimiter: string
): boolean {
  if (index === 0) return false;

  // For default "\n\n" delimiter, check for blank lines
  if (delimiter === "\n\n") {
    return lines[index - 1] === "";
  }

  // For custom delimiters, check if previous lines match the delimiter pattern
  const delimiterLines = delimiter.split("\n");
  if (delimiterLines.length <= 1) return false;

  // Check if the delimiter pattern appears before this line
  for (let i = 0; i < delimiterLines.length - 1; i++) {
    const checkIndex = index - delimiterLines.length + 1 + i;
    if (checkIndex < 0 || lines[checkIndex] !== delimiterLines[i]) {
      return false;
    }
  }

  return true;
}

function removeTrailingEmptyLines(lines: string[]): string[] {
  // Don't remove anything if there's only one line
  if (lines.length <= 1) {
    return lines;
  }

  // Find the last non-empty line
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== "") {
      return lines.slice(0, i + 1);
    }
  }

  // If all lines are empty, keep at least one
  return lines.length > 0 ? [lines[0]] : [];
}

export default defaultChunker;
