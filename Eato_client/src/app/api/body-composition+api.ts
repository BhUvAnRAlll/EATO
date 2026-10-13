import { requireUser } from "@/server/auth";
import { ExtractionError, extractReport } from "@/server/bodyComposition/extract";
import { checkUpload } from "@/server/bodyComposition/upload";

// POST { data: base64, mediaType } → { report } (unconfirmed values for the user to check)
// The uploaded file is never stored or logged; only the extracted values are returned.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The upload couldn't be read." }, { status: 400 });
  }

  const upload = checkUpload(body);
  if (!upload.ok) return Response.json({ error: upload.error }, { status: upload.status });

  try {
    const report = await extractReport({
      base64: (body as { data: string }).data.replace(/\s/g, ""),
      mediaType: upload.mediaType,
      layout: "inbody",
      reportId: crypto.randomUUID(),
    });
    return Response.json({ report });
  } catch (error) {
    if (error instanceof ExtractionError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Report extraction failed unexpectedly");
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
