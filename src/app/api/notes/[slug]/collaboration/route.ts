import * as Y from "yjs";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/service";

type RouteContext = { params: Promise<{ slug: string }> };
type StoredUpdate = { update_id: string; update_data: string };

const NOTE_FIELDS = "slug, title, content, version, updated_at";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function isValidSlug(slug: string) {
  return slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

async function readDocument(slug: string) {
  return createServiceClient()
    .from("note_collaboration_documents")
    .select("state, revision")
    .eq("note_slug", slug)
    .maybeSingle();
}

async function readUpdates(slug: string) {
  return createServiceClient()
    .from("note_collaboration_updates")
    .select("update_id, update_data")
    .eq("note_slug", slug)
    .order("created_at", { ascending: true });
}

async function readStableSnapshot(slug: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const documentResult = await readDocument(slug);
    if (documentResult.error) return { document: null, updates: [], error: documentResult.error };
    if (!documentResult.data) return { document: null, updates: [], error: null };

    const updatesResult = await readUpdates(slug);
    if (updatesResult.error || !updatesResult.data) {
      return { document: null, updates: [], error: updatesResult.error ?? new Error("Update rows are missing.") };
    }

    const confirmation = await readDocument(slug);
    if (confirmation.error) return { document: null, updates: [], error: confirmation.error };
    if (
      confirmation.data &&
      Number(confirmation.data.revision) === Number(documentResult.data.revision)
    ) {
      return {
        document: documentResult.data,
        updates: updatesResult.data as StoredUpdate[],
        error: null,
      };
    }
  }

  return { document: null, updates: [], error: new Error("Collaboration data changed while loading.") };
}

async function compactUpdates(slug: string, revision: number, state: string, updates: StoredUpdate[]) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(state, "base64")));
  for (const update of updates) {
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(update.update_data, "base64")));
  }
  const mergedState = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  doc.destroy();

  const { data, error } = await createServiceClient().rpc("compact_note_collaboration", {
    p_note_slug: slug,
    p_expected_revision: revision,
    p_state: mergedState,
    p_update_ids: updates.map((update) => update.update_id),
  });

  return { compacted: data === true, error };
}

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug.toLowerCase();
  if (!isValidSlug(slug)) return jsonError("Invalid note slug.", 400);

  const supabase = createServiceClient();
  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select(NOTE_FIELDS)
    .eq("slug", slug)
    .maybeSingle();
  if (noteError) return jsonError("Could not load the note.", 500);
  if (!note) return jsonError("Note not found.", 404);

  let snapshot = await readStableSnapshot(slug);
  if (snapshot.error) {
    console.error("Supabase collaboration state read failed:", snapshot.error.message);
    return jsonError("Could not load collaboration data. Apply the latest Supabase migration and try again.", 503);
  }

  // Existing notes are converted to Yjs on the client, where Tiptap has a DOM.
  // GET stays read-only so concurrent openers can race safely through POST below.
  if (!snapshot.document) {
    return NextResponse.json({
      initialized: false,
      title: note.title,
      markdown: note.content,
      revision: 0,
      updates: [],
    }, { headers: { "Cache-Control": "no-store" } });
  }

  let document = snapshot.document;
  let updates = snapshot.updates;

  if (updates.length >= 100) {
    const result = await compactUpdates(slug, Number(document.revision), document.state, updates);
    if (!result.error && result.compacted) {
      snapshot = await readStableSnapshot(slug);
      if (snapshot.error || !snapshot.document) {
        console.error("Supabase collaboration snapshot refresh failed:", snapshot.error?.message);
        return jsonError("Could not refresh collaboration data.", 500);
      }
      document = snapshot.document;
      updates = snapshot.updates;
    }
  }

  return NextResponse.json({
    initialized: true,
    state: document.state,
    revision: Number(document.revision),
    updates: updates.map((update) => ({ id: update.update_id, data: update.update_data })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug.toLowerCase();
  if (!isValidSlug(slug)) return jsonError("Invalid note slug.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400);
  }
  if (!body || typeof body !== "object" || !("state" in body)) {
    return jsonError("Invalid collaboration state.", 400);
  }
  const state = body.state;
  if (typeof state !== "string" || state.length === 0 || state.length > 4_000_000) {
    return jsonError("Invalid collaboration state.", 400);
  }

  const bytes = Buffer.from(state, "base64");
  if (bytes.length === 0 || bytes.length > 3_000_000 || bytes.toString("base64") !== state) {
    return jsonError("Invalid collaboration state.", 400);
  }

  try {
    const validationDoc = new Y.Doc();
    Y.applyUpdate(validationDoc, new Uint8Array(bytes));
    validationDoc.destroy();
  } catch {
    return jsonError("Invalid collaboration state.", 400);
  }

  const supabase = createServiceClient();
  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (noteError) return jsonError("Could not verify the note.", 500);
  if (!note) return jsonError("Note not found.", 404);

  const { error: insertError } = await supabase
    .from("note_collaboration_documents")
    .insert({ note_slug: slug, state });

  if (insertError && insertError.code !== "23505") {
    console.error("Supabase collaboration state initialization failed:", insertError.message);
    return jsonError("Could not initialize collaboration data.", 503);
  }

  // The unique note_slug constraint elects exactly one initial state. Everyone
  // else adopts that winner, avoiding duplicate copies on simultaneous opens.
  const { data: document, error: readError } = await readDocument(slug);
  if (readError || !document) {
    console.error("Supabase collaboration state read failed:", readError?.message);
    return jsonError("Could not load collaboration data.", 503);
  }

  return NextResponse.json({
    state: document.state,
    revision: Number(document.revision),
  }, { headers: { "Cache-Control": "no-store" } });
}
