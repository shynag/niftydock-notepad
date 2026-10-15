export type Note = {
  id: string;
  title: string;
  slug: string;
  content: string;
  updatedAt: number;
  version: number;
};

export type ApiNote = {
  id: string;
  title: string;
  slug: string;
  content: string;
  updated_at: string;
  version: number | string;
};

export type SaveState = "saved" | "saving" | "error";

export function fromApiNote(note: ApiNote): Note {
  return {
    id: note.id,
    title: note.title,
    slug: note.slug,
    content: note.content,
    updatedAt: new Date(note.updated_at).getTime(),
    version: Number(note.version),
  };
}

export function latestTimestamp(...timestamps: number[]) {
  const validTimestamps = timestamps.filter(Number.isFinite);
  return validTimestamps.length > 0 ? Math.max(...validTimestamps) : 0;
}

export function normalizeNoteSlug(slug: string) {
  return slug.replace(/^catatan-([a-z0-9]{6})$/i, "$1");
}

export function createRandomSlug(existingSlugs: Iterable<string>) {
  const usedSlugs = new Set(existingSlugs);
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let slug = "";
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    slug = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  } while (usedSlugs.has(slug));
  return slug;
}
