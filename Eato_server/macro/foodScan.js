// Estimates a meal's calories and macros from one photo with an OpenAI vision model (server
// only). The photo is never stored or logged, and nothing is written to the diary here: the
// member checks the estimate and logs it through POST /api/macro/meals like any other meal.
// In tests (NODE_ENV=test with AI_PROVIDER=fake) a fixed estimate is answered instead.
const OpenAI = require("openai");

const { checkUpload, uploadLimits } = require("../bodyComposition/upload");
const { limits } = require("./validate");

// Vision-capable model with structured outputs; override with OPENAI_MODEL
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const scanLimits = {
  maxItems: 20,
  hintLength: 200,
  // The biggest allowed photo as base64 (4/3 of its bytes) plus the JSON around it
  maxBodyBytes: Math.ceil(uploadLimits.maxImageBytes * (4 / 3)) + 2048,
};

const INSTRUCTIONS = `You estimate the nutrition of the food in a photo for a meal diary used in India.

Rules:
- List each separate food you can see (for example "Roti", "Dal tadka", "Jeera rice") with your best estimate of the portion shown.
- Give the portion as a quantity and a unit: grams ("g") for most foods, "ml" for drinks, or "piece" for countable items like roti, idli or eggs.
- Estimate kcal, protein, carbs and fat in grams for that portion, using typical Indian home or restaurant recipes when the dish is Indian.
- Use the member's note, if any, to correct the dish or the portion.
- Give the meal a short title (at most 60 characters), such as "Dal, rice and roti".
- If the photo does not show food or a drink, set isFood to false, the title to "" and items to [].`;

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    quantity: { type: "number" },
    unit: { type: "string", enum: ["g", "ml", "piece"] },
    kcal: { type: "number" },
    proteinG: { type: "number" },
    carbsG: { type: "number" },
    fatG: { type: "number" },
  },
  required: ["name", "quantity", "unit", "kcal", "proteinG", "carbsG", "fatG"],
};

const scanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    isFood: { type: "boolean" },
    title: { type: "string" },
    items: { type: "array", items: ITEM_SCHEMA },
  },
  required: ["isFood", "title", "items"],
};

// A failure the member can act on: `status` is the HTTP status to answer with
class FoodScanError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "FoodScanError";
    this.status = status;
  }
}

// { data: base64, mediaType, hint? } → { ok, base64, mediaType, hint } or { ok: false, status, error }.
// Photos only (no PDF), checked by their real bytes.
function checkFoodPhoto(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "Send the photo as { data, mediaType }." };
  for (const key of Object.keys(body)) {
    if (!["data", "mediaType", "hint"].includes(key)) return { ok: false, status: 400, error: `The request has an unexpected field: ${key}.` };
  }
  let hint = "";
  if (body.hint !== undefined && body.hint !== null) {
    if (typeof body.hint !== "string") return { ok: false, status: 400, error: "The note must be text." };
    // eslint-disable-next-line no-control-regex
    hint = body.hint.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, scanLimits.hintLength);
  }
  const upload = checkUpload({ data: body.data, mediaType: body.mediaType });
  if (!upload.ok) return upload.status === 400 ? { ...upload, error: "Send the photo as { data, mediaType }." } : upload.status === 415 ? { ...upload, error: "Upload a photo (JPEG, PNG or WebP) of your food." } : upload;
  if (upload.mediaType === "application/pdf") return { ok: false, status: 415, error: "Upload a photo (JPEG, PNG or WebP) of your food." };
  return { ok: true, base64: body.data.replace(/\s/g, ""), mediaType: upload.mediaType, hint };
}

const clean = (value, max) =>
  // eslint-disable-next-line no-control-regex
  (typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim() : "").slice(0, max);
const clamp = (value, max) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value * 10) / 10)) : 0);

// The model's answer → { title, items } that POST /api/macro/meals will accept as it is.
// Pure, so it is unit-tested directly. Throws a 422 when there is no food to log.
function normalizeFoodScan(raw) {
  if (!raw || raw.isFood !== true || !Array.isArray(raw.items)) {
    throw new FoodScanError("We couldn't spot any food in that photo. Try another photo or log it by hand.", 422);
  }
  const items = raw.items
    .slice(0, scanLimits.maxItems)
    .map((item) => ({
      name: clean(item?.name, limits.nameLength),
      quantity: Math.min(limits.quantityMax, Math.max(0.01, Math.round((Number(item?.quantity) || 1) * 100) / 100)),
      unit: ["g", "ml", "piece"].includes(item?.unit) ? item.unit : "serving",
      kcal: clamp(item?.kcal, limits.kcalMax),
      proteinG: clamp(item?.proteinG, limits.macroMax),
      carbsG: clamp(item?.carbsG, limits.macroMax),
      fatG: clamp(item?.fatG, limits.macroMax),
    }))
    .filter((item) => item.name !== "");
  if (items.length === 0) {
    throw new FoodScanError("We couldn't spot any food in that photo. Try another photo or log it by hand.", 422);
  }
  const title = clean(raw.title, limits.nameLength) || items.map((i) => i.name).join(", ").slice(0, limits.nameLength);
  return { title, items };
}

// A fixed answer for tests: never calls OpenAI
const FAKE_SCAN = {
  isFood: true,
  title: "Dal, rice and roti",
  items: [
    { name: "Dal tadka", quantity: 150, unit: "g", kcal: 180, proteinG: 9, carbsG: 22, fatG: 6 },
    { name: "Jeera rice", quantity: 150, unit: "g", kcal: 210, proteinG: 4, carbsG: 42, fatG: 3 },
    { name: "Roti", quantity: 2, unit: "piece", kcal: 200, proteinG: 6, carbsG: 36, fatG: 4 },
  ],
};

// { base64, mediaType, hint } → { title, items }, an UNCONFIRMED estimate
async function scanFood(params, env = process.env) {
  if (env.NODE_ENV === "test" && env.AI_PROVIDER === "fake") return normalizeFoodScan(FAKE_SCAN);

  const client = new OpenAI(); // reads OPENAI_API_KEY
  let response;
  try {
    response = await client.responses.create({
      model: MODEL,
      instructions: INSTRUCTIONS,
      store: false, // don't keep the photo or the answer on OpenAI's side
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", detail: "auto", image_url: `data:${params.mediaType};base64,${params.base64}` },
            { type: "input_text", text: params.hint ? `The member's note: ${params.hint}` : "No note from the member." },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "food_scan", strict: true, schema: scanSchema } },
    });
  } catch (error) {
    // Never log the request or response content, only the status
    if (error instanceof OpenAI.RateLimitError) throw new FoodScanError("We're busy right now. Please try again in a minute.", 503);
    if (error instanceof OpenAI.APIError) {
      console.error(`Food scan failed: OpenAI ${error.status ?? "unknown"} ${error.name}`);
      throw new FoodScanError("We couldn't scan your food right now. Please try again.", 502);
    }
    throw error;
  }

  const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
  if (refused || response.status === "incomplete" || !response.output_text) {
    throw new FoodScanError("We couldn't read that photo. Try another photo or log it by hand.", 422);
  }
  return normalizeFoodScan(JSON.parse(response.output_text));
}

module.exports = { FoodScanError, scanLimits, checkFoodPhoto, normalizeFoodScan, scanFood };
