import { openai } from "@ai-sdk/openai";
import { generateText, experimental_transcribe as transcribe } from "ai";
import { assert } from "convex-helpers";
import { Id } from "./_generated/dataModel";
import { StorageActionWriter } from "convex/server";

const describeImage = openai.chat("o4-mini");
const describeAudio = openai.transcription("whisper-1");
const describePdf = openai.chat("gpt-4.1");

export async function getText(
  ctx: { storage: StorageActionWriter },
  {
    storageId,
    filename,
    blob,
  }: { storageId: Id<"_storage">; filename: string; blob: Blob }
) {
  const url = await ctx.storage.getUrl(storageId);
  assert(url);
  if (
    ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(blob.type)
  ) {
    const imageResult = await generateText({
      model: describeImage,
      system:
        "You turn images into text. If it is a photo of a entry, transcribe it. If it is not a entry, describe it.",
      messages: [
        {
          role: "user",
          content: [{ type: "image", image: new URL(url) }],
        },
      ],
    });
    return imageResult.text;
  } else if (blob.type.startsWith("audio/")) {
    const audioResult = await transcribe({
      model: describeAudio,
      audio: new URL(url),
    });
    return audioResult.text;
  } else if (blob.type.toLowerCase().includes("pdf")) {
    const pdfResult = await generateText({
      model: describePdf,
      system: "You transform PDF files into text.",
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: new URL(url), mimeType: blob.type, filename },
            {
              type: "text",
              text: "Extract the text from the PDF and print it without explaining that you'll do so.",
            },
          ],
        },
      ],
    });
    return pdfResult.text;
  } else if (blob.type.toLowerCase().includes("text")) {
    return new TextDecoder().decode(await blob.arrayBuffer());
  } else {
    throw new Error(`Unsupported mime type: ${blob.type}`);
  }
}
