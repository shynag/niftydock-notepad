import { NotepadApp } from "@/components/notepad-app";

export default async function NotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <NotepadApp initialSlug={slug} />;
}
