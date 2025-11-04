/**
 * Chunk text for embedding.
 *
 * By default, it will chunk into paragraphs and target
 * 200-2000 characters per chunk (only less than 1 line if the hard limit is reached).
 */
export function defaultChunker(
  text: string,
  {
    minLines = 1,
    minCharsSoftLimit = 100,
    maxCharsSoftLimit = 1000,
    maxCharsHardLimit = 10000,
    delimiter = "\n\n",
  }: {
    minLines?: number;
    minCharsSoftLimit?: number;
    maxCharsSoftLimit?: number;
    maxCharsHardLimit?: number;
    delimiter?: string;
  } = {},
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
      const processedChunk = processChunkForOutput(
        currentChunk,
        lines,
        i - currentChunk.length,
      );
      if (processedChunk.trim()) {
        chunks.push(processedChunk);
      }

      // Split the line if it exceeds hard limit
      const splitLines = maybeSplitLine(line, maxCharsHardLimit);
      // Add all but the last split piece as separate chunks
      for (let j = 0; j < splitLines.length - 1; j++) {
        if (splitLines[j].trim()) {
          chunks.push(splitLines[j]);
        }
      }
      // Keep the last piece for potential combination with next lines
      currentChunk = [splitLines[splitLines.length - 1]];
      continue;
    }

    // If we're starting a new section and current chunk meets minimum requirements
    if (
      isNewSection &&
      currentChunk.length >= minLines &&
      currentChunk.join("\n").length >= Math.min(minCharsSoftLimit * 0.8, 150)
    ) {
      // Simple logic: only split if potential chunk would exceed the soft max limit
      if (potentialChunk.length > maxCharsSoftLimit) {
        // When splitting at delimiter boundary, preserve natural empty lines and trailing newlines
        const processedChunk = processChunkForOutput(
          currentChunk,
          lines,
          i - currentChunk.length,
        );
        if (processedChunk.trim()) {
          chunks.push(processedChunk);
        }
        currentChunk = [line];
        continue;
      }
    }

    // Add line to current chunk
    currentChunk.push(line);

    // If current chunk is too big, split it
    if (currentChunk.join("\n").length > maxCharsSoftLimit) {
      if (currentChunk.length === 1) {
        // Single line too long - split it if it exceeds hard limit
        const splitLines = maybeSplitLine(line, maxCharsHardLimit);
        if (splitLines.length > 1) {
          // Line was split - add all but the last piece as separate chunks
          for (let j = 0; j < splitLines.length - 1; j++) {
            if (splitLines[j].trim()) {
              chunks.push(splitLines[j]);
            }
          }
          // Keep the last piece for potential combination with next lines
          currentChunk = [splitLines[splitLines.length - 1]];
        } else {
          // Line doesn't exceed hard limit, keep it as is
          if (line.trim()) {
            chunks.push(line);
          }
          currentChunk = [];
        }
      } else {
        // Remove last line and finalize chunk
        const lastLine = currentChunk.pop()!;
        const processedChunk = processChunkForOutput(
          currentChunk,
          lines,
          i - currentChunk.length,
        );
        if (processedChunk.trim()) {
          chunks.push(processedChunk);
        }
        currentChunk = [lastLine];
      }
    }
  }

  // Add remaining chunk, splitting if it exceeds hard limit
  if (currentChunk.length > 0) {
    const remainingText = currentChunk.join("\n");
    if (remainingText.length > maxCharsHardLimit) {
      // Split the remaining chunk if it exceeds hard limit
      const splitLines = maybeSplitLine(remainingText, maxCharsHardLimit);
      chunks.push(...splitLines.filter((chunk) => chunk.trim()));
    } else {
      const processedChunk = processChunkForOutput(
        currentChunk,
        lines,
        lines.length - currentChunk.length,
      );
      if (processedChunk.trim()) {
        chunks.push(processedChunk);
      }
    }
  }

  // Filter out any empty chunks that might have slipped through
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

function processChunkForOutput(
  chunkLines: string[],
  allLines: string[],
  startIndex: number,
): string {
  if (chunkLines.length === 0) return "";

  // Remove trailing empty lines but preserve meaningful structure
  const trimmedLines = removeTrailingEmptyLines(chunkLines);

  // Check if we should preserve some trailing newlines by looking at the original context
  const endIndex = startIndex + chunkLines.length - 1;
  const hasTrailingNewlines =
    endIndex < allLines.length - 1 && chunkLines.length > trimmedLines.length;

  // If we removed empty lines but there are more lines after this chunk,
  // preserve one trailing newline to maintain paragraph separation
  if (hasTrailingNewlines && trimmedLines.length > 0) {
    return trimmedLines.join("\n") + "\n";
  }

  return trimmedLines.join("\n");
}

function maybeSplitLine(line: string, maxCharsHardLimit: number): string[] {
  const inputs = [line]; // in reverse order
  const lines: string[] = [];
  while (inputs.length > 0) {
    const input = inputs.pop()!;
    if (input.length <= maxCharsHardLimit) {
      lines.push(input);
      continue;
    }
    // split it in half
    const splitIndex = Math.floor(input.length / 2);
    const candidate = input.slice(0, splitIndex);
    const rest = input.slice(splitIndex);
    if (candidate.length < maxCharsHardLimit) {
      lines.push(candidate, rest);
    } else {
      inputs.push(rest, candidate);
    }
  }
  return lines;
}

function shouldStartNewSection(
  lines: string[],
  index: number,
  delimiter: string,
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

  // If all lines are empty, return empty array instead of keeping empty strings
  return [];
}

export default defaultChunker;
