// Reads a body composition report with an OpenAI vision model (server only).
// Swapping providers means replacing this file; nothing else depends on OpenAI.
import OpenAI from "openai";

import type { BodyCompositionReport } from "../../lib/nutrition/types.ts";
import { reportLayouts, type ReportLayout } from "./layouts.ts";
import { extractionSchema, normalizeExtraction, type RawExtraction } from "./normalize.ts";
import type { UploadMediaType } from "./upload.ts";

// Vision-capable model with structured outputs; override with OPENAI_MODEL
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const INSTRUCTIONS = `You read body composition analysis (BCA) result sheets and copy the printed values.

Rules:
- Copy each value exactly as printed. Never estimate, calculate or infer a value.
- If a value is missing, cut off, blurry, covered or you are not certain of every digit, return null for it.
- Report the unit the sheet uses for mass (kg or lb) and height (cm or in). If you can't tell, return null.
- Give the test date as YYYY-MM-DD, or null if it isn't printed clearly.
- Gender: "male" or "female" only if printed; otherwise null.
- If the image is not a body composition result sheet, set isBodyCompositionReport to false and every other value to null.`;

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function fileInput(mediaType: UploadMediaType, base64: string): OpenAI.Responses.ResponseInputContent {
  if (mediaType === "application/pdf") {
    return { type: "input_file", filename: "report.pdf", file_data: `data:application/pdf;base64,${base64}` };
  }
  return { type: "input_image", detail: "high", image_url: `data:${mediaType};base64,${base64}` };
}

export async function extractReport(params: {
  base64: string;
  mediaType: UploadMediaType;
  layout: ReportLayout;
  reportId: string;
}): Promise<BodyCompositionReport> {
  const client = new OpenAI(); // reads OPENAI_API_KEY
  const layout = reportLayouts[params.layout];

  let response: OpenAI.Responses.Response;
  try {
    response = await client.responses.create({
      model: MODEL,
      instructions: INSTRUCTIONS,
      store: false, // health data: don't keep the response on OpenAI's side
      input: [
        {
          role: "user",
          content: [
            fileInput(params.mediaType, params.base64),
            { type: "input_text", text: `This should be an ${layout.label}. Where to look:\n${layout.hints}` },
          ],
        },
      ],
      text: {
        format: { type: "json_schema", name: "body_composition_report", strict: true, schema: extractionSchema },
      },
    });
  } catch (error) {
    // Never log request or response content (it's health data) — only the status
    if (error instanceof OpenAI.RateLimitError) throw new ExtractionError("We're busy right now. Please try again in a minute.", 503);
    if (error instanceof OpenAI.APIError) {
      console.error(`Report extraction failed: OpenAI ${error.status ?? "unknown"} ${error.name}`);
      throw new ExtractionError("We couldn't read your report right now. Please try again.", 502);
    }
    throw error;
  }

  const refused = response.output.some(
    (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
  );
  if (refused || response.status === "incomplete" || !response.output_text) {
    throw new ExtractionError("We couldn't read this report. Please enter your details manually.", 422);
  }

  const raw = JSON.parse(response.output_text) as RawExtraction;
  if (!raw.isBodyCompositionReport) {
    throw new ExtractionError("This doesn't look like a body composition report. Try another photo or skip.", 422);
  }
  return normalizeExtraction(raw, params.reportId);
}
