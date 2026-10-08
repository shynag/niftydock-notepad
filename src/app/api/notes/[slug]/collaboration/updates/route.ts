import { NextRequest, NextResponse } from "next/server";
import * as Y from "yjs";
import { createServiceClient } from "@/utils/supabase/service";

type RouteContext = { params: Promise<{ slug: string }> };
const MAX_UPDATE_CHARS = 4_000_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function isValidSlug(slug: string) {
  return slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug.toLowerCase();
  if (!isValidSlug(slug)) return jsonError("Invalid note slug.", 400);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return jsonError("Invalid JSON body.", 400);

  const updates = (payload as Record<string, unknown>).updates;
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 50) {
    return jsonError("Provide between 1 and 50 collaboration updates.", 400);
  }

  const rows: { note_slug: string; update_id: string; update_data: string }[] = [];
  let totalChars = 0;
  for (const item of updates) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return jsonError("Invalid collaboration update.", 400);
    const update = item as Record<string, unknown>;
    if (
      typeof update.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(update.id) ||
      typeof update.data !== "string" || update.data.length < 4 || update.data.length > MAX_UPDATE_CHARS ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(update.data)
    ) return jsonError("Invalid collaboration update.", 400);

    totalChars += update.data.length;
    if (totalChars > MAX_UPDATE_CHARS) return jsonError("Collaboration update batch is too large.", 413);

    const bytes = Buffer.from(update.data, "base64");
    if (bytes.toString("base64") !== update.data) return jsonError("Invalid collaboration update encoding.", 400);
    const validationDoc = new Y.Doc();
    try {
      Y.applyUpdate(validationDoc, new Uint8Array(bytes));
    } catch {
      validationDoc.destroy();
      return jsonError("Invalid collaboration update data.", 400);
    }
    validationDoc.destroy();

    rows.push({ note_slug: slug, update_id: update.id, update_data: update.data });
  }

  const supabase = createServiceClient();
  const { data: document, error: documentError } = await supabase
    .from("note_collaboration_documents")
    .select("note_slug")
    .eq("note_slug", slug)
    .maybeSingle();
  if (documentError) {
    console.error("Supabase collaboration document lookup failed:", documentError.message);
    return jsonError("Could not verify the collaboration document.", 500);
  }
  if (!document) return jsonError("Collaboration document is not initialized yet.", 409);

  const { error } = await supabase
    .from("note_collaboration_updates")
    .upsert(rows, { onConflict: "note_slug,update_id", ignoreDuplicates: true });
  if (error) {
    console.error("Supabase collaboration update save failed:", error.message);
    return jsonError("Could not save collaboration updates.", 500);
  }

  return NextResponse.json({ saved: true, ids: rows.map((row) => row.update_id) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
