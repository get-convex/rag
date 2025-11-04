import { openai } from "@ai-sdk/openai";
import { generateText, experimental_transcribe as transcribe } from "ai";
import { assert } from "convex-helpers";
import { Id } from "./_generated/dataModel";
import { StorageActionWriter } from "convex/server";

const describeImage = openai.chat("o4-mini");
const describeAudio = openai.transcription("whisper-1");
const describePdf = openai.chat("gpt-4.1");
const describeHtml = openai.chat("gpt-4.1");

export async function getText(
  ctx: { storage: StorageActionWriter },
  {
    storageId,
    filename,
    bytes,
    mimeType,
  }: {
    storageId: Id<"_storage">;
    filename: string;
    bytes?: ArrayBuffer;
    mimeType: string;
  },
) {
  const url = await ctx.storage.getUrl(storageId);
  assert(url);
  if (
    ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)
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
  } else if (mimeType.startsWith("audio/")) {
    const audioResult = await transcribe({
      model: describeAudio,
      audio: new URL(url),
    });
    return audioResult.text;
  } else if (mimeType.toLowerCase().includes("pdf")) {
    const pdfResult = await generateText({
      model: describePdf,
      system: "You transform PDF files into text.",
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: new URL(url), mediaType: mimeType, filename },
            {
              type: "text",
              text: "Extract the text from the PDF and print it without explaining that you'll do so.",
            },
          ],
        },
      ],
    });
    return pdfResult.text;
  } else if (mimeType.toLowerCase().includes("text")) {
    const arrayBuffer =
      bytes || (await (await ctx.storage.get(storageId))!.arrayBuffer());
    const text = new TextDecoder().decode(arrayBuffer);
    if (mimeType.toLowerCase() !== "text/plain") {
      const result = await generateText({
        model: describeHtml,
        system: "You transform content into markdown.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: text },
              {
                type: "text",
                text: "Extract the text and print it in a markdown format without explaining that you'll do so.",
              },
            ],
          },
        ],
      });
      return result.text;
    }
    return text;
  } else {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }
}
