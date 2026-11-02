// What apiFetch (lib/api.ts) decides about a request and its answer. Pure: no React Native
// imports, so it is unit-tested on its own.

// How long a request may take: AI and photo routes wait on the model or the scan server (the
// server gives OpenAI 45 s and one retry, Forma 90 s), everything else answers in a moment
export const REQUEST_TIMEOUT_MS = 30_000;
export const SLOW_REQUEST_TIMEOUT_MS = 100_000;
const SLOW_PATHS = /^\/api\/(coach|workout|fitness|body-composition|macro\/(scan|estimate)|admin\/portal\/(exercises|programs))(\/|\?|$)/;
export const timeoutFor = (path: string) => (SLOW_PATHS.test(path) ? SLOW_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS);

export const TIMED_OUT = "The server is taking too long. Please try again.";
export const serverProblem = (status: number) => `The server had a problem (${status}). Please try again in a moment.`;

// The answer read as JSON. `json: false` for an empty body or a proxy's HTML page; JSON null is
// a real answer (GET /api/profile before setup is finished).
export type ReadBody = { json: true; value: unknown } | { json: false };
export function readJson(text: string): ReadBody {
  if (!text) return { json: false };
  try {
    return { json: true, value: JSON.parse(text) };
  } catch {
    return { json: false };
  }
}

// The server's own error line when it sent one
export const errorLine = (body: ReadBody): string | null => {
  if (!body.json || body.value === null || typeof body.value !== "object") return null;
  const error = (body.value as { error?: unknown }).error;
  return typeof error === "string" && error ? error : null;
};
