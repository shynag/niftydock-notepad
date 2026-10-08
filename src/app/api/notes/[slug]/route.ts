import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/service";

const NOTE_FIELDS = "id, slug, title, content, version, updated_at";
const MAX_CONTENT_BYTES = 1_048_576;

type RouteContext = { params: Promise<{ slug: string }> };

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function isValidSlug(slug: string) {
  return slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug.toLowerCase();
  if (!isValidSlug(slug)) return jsonError("Invalid note slug.", 400);

  const { data, error } = await createServiceClient()
    .from("notes")
    .select(NOTE_FIELDS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase note read failed:", error.message);
    return jsonError("Could not load the note.", 500);
  }
  if (!data) return jsonError("Note not found.", 404);
  return NextResponse.json({ note: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug.toLowerCase();
  if (!isValidSlug(slug)) return jsonError("Invalid note slug.", 400);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonError("Invalid JSON body.", 400);
  }
  const values = payload as Record<string, unknown>;
  const title = values.title;
  const content = values.content;
  const expectedVersion = values.version;
  if (typeof title !== "string" || (content !== undefined && typeof content !== "string")) {
    return jsonError("Title must be a string and content, when provided, must be a string.", 400);
  }
  if (title.length > 200) return jsonError("Title must be 200 characters or fewer.", 400);
  if (typeof content === "string" && Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return jsonError("Note content must be 1 MB or smaller.", 413);
  }
  if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return jsonError("Invalid note version.", 400);
  }

  const supabase = createServiceClient();
  const updateValues: { title: string; content?: string } = { title };
  if (typeof content === "string") updateValues.content = content;
  const { data, error } = await supabase
    .from("notes")
    .update(updateValues)
    .eq("slug", slug)
    .eq("version", expectedVersion)
    .select(NOTE_FIELDS)
    .maybeSingle();

  if (error) {
    console.error("Supabase note save failed:", error.message);
    return jsonError("Could not save the note.", 500);
  }
  if (data) {
    return NextResponse.json({ note: data }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: current, error: lookupError } = await supabase
    .from("notes")
    .select("id, version")
    .eq("slug", slug)
    .maybeSingle();
  if (lookupError) {
    console.error("Supabase note version check failed:", lookupError.message);
    return jsonError("Could not check the note status.", 500);
  }
  if (!current) return jsonError("Note not found.", 404);
  return NextResponse.json({ error: "This note changed on another device. Reload before saving again.", version: current.version }, {
    status: 409,
    headers: { "Cache-Control": "no-store" },
  });
}
