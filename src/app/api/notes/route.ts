import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/service";

const NOTE_FIELDS = "id, slug, title, content, version, updated_at";
const MAX_CONTENT_BYTES = 1_048_576;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isValidSlug(slug: string) {
  return slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function randomSlug() {
  // Keep the six-character URL style the UI already uses, using crypto randomness.
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join("");
}

async function readPayload(request: Request) {
  try {
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const payload = await readPayload(request);
  if (!payload) return jsonError("Invalid JSON body.", 400);

  const title = typeof payload.title === "string" ? payload.title : "New note";
  const content = typeof payload.content === "string" ? payload.content : "";
  const requestedSlug = typeof payload.slug === "string" ? payload.slug.toLowerCase() : null;

  if (title.length > 200) return jsonError("Title must be 200 characters or fewer.", 400);
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return jsonError("Note content must be 1 MB or smaller.", 413);
  }
  if (requestedSlug && !isValidSlug(requestedSlug)) return jsonError("Invalid note slug.", 400);

  const supabase = createServiceClient();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = requestedSlug ?? randomSlug();
    const { data, error } = await supabase
      .from("notes")
      .insert({ slug, title, content })
      .select(NOTE_FIELDS)
      .single();

    if (!error && data) {
      return NextResponse.json({ note: data }, { status: 201 });
    }

    if (error?.code === "23505") {
      if (requestedSlug || attempt === 3) return jsonError("That note slug is already in use.", 409);
      continue;
    }

    console.error("Supabase note create failed:", error?.message ?? "No note was returned.");
    return jsonError("Could not create the note.", 500);
  }

  return jsonError("Could not generate a note slug.", 500);
}
