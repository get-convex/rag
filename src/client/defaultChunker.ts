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
    minCharsSoftLimit = 200,
    maxCharsSoftLimit = 2000,
    maxCharsHardLimit = 10000,
    delimiter = "\n\n",
  }: {
    minLines?: number;
    minCharsSoftLimit?: number;
    maxCharsSoftLimit?: number;
    maxCharsHardLimit?: number;
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

      // Split the line if it exceeds hard limit
      const splitLines = maybeSplitLine(line, maxCharsHardLimit);
      // Add all but the last split piece as separate chunks
      for (let j = 0; j < splitLines.length - 1; j++) {
        chunks.push(splitLines[j]);
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
        // Single line too long - split it if it exceeds hard limit
        const splitLines = maybeSplitLine(line, maxCharsHardLimit);
        if (splitLines.length > 1) {
          // Line was split - add all but the last piece as separate chunks
          for (let j = 0; j < splitLines.length - 1; j++) {
            chunks.push(splitLines[j]);
          }
          // Keep the last piece for potential combination with next lines
          currentChunk = [splitLines[splitLines.length - 1]];
        } else {
          // Line doesn't exceed hard limit, keep it as is
          chunks.push(line);
          currentChunk = [];
        }
      } else {
        // Remove last line and finalize chunk
        const lastLine = currentChunk.pop()!;
        const trimmedChunk = removeTrailingEmptyLines(currentChunk);
        chunks.push(trimmedChunk.join("\n"));
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
      chunks.push(...splitLines);
    } else {
      const trimmedChunk = removeTrailingEmptyLines(currentChunk);
      chunks.push(trimmedChunk.join("\n"));
    }
  }

  return chunks;
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
