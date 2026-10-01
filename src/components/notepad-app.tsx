"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  Bold,
  Check,
  Code2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Plus,
  Quote,
  Share2,
  Table2,
} from "lucide-react";
import { RichEditor } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Note = { id: string; title: string; slug: string; content: string; updatedAt: number; locked: boolean };
type SaveState = "saved" | "saving" | "error";

const starterNotes: Note[] = [
  {
    id: "note-welcome",
    title: "Mulai di sini",
    slug: "mulai-di-sini",
    updatedAt: Date.now() - 1000 * 60 * 12,
    locked: false,
    content: `# Catatan yang selalu dekat.\n\nSelamat datang di **NiftyDock Notepad** — ruang kecil untuk ide, rencana, dan hal-hal yang ingin kamu bawa ke mana saja.\n\nTulis dengan bebas. Catatanmu bisa dibuka lewat satu tautan, tanpa perlu membuat akun.\n\n## Coba editor ini\n\n- **Tebal**, *miring*, dan tautan\n- Daftar yang bisa dicentang\n- Kutipan dan blok kode\n\n## Bagikan dalam tiga langkah\n\n1. Tulis catatan\n2. Salin tautannya\n3. Buka dari perangkat lain\n\n> Tip: tekan tombol / untuk mulai menambahkan format.\n\n## Rencana hari ini\n\n- [x] Buka catatan pertama\n- [ ] Tulis sesuatu yang ingin diingat\n- [ ] Bagikan tautan ke perangkat lain\n\n---\n\n*Draf tersimpan di perangkat ini selama backend belum tersambung.*`,
  },
  {
    id: "note-ideas",
    title: "Ide produk",
    slug: "ide-produk",
    updatedAt: Date.now() - 1000 * 60 * 60 * 3,
    locked: false,
    content: `## Yang ingin dibuat\n\n- Catatan yang cepat dibuka dari mana saja\n- Markdown yang nyaman ditulis dan dibaca\n- Kolaborasi ringan tanpa akun\n\n## Pertanyaan\n\n> Bagaimana jika berbagi catatan sesederhana berbagi link?\n\nSimpan ide kecil di sini, lalu kembali lagi kapan pun.`,
  },
  {
    id: "note-list",
    title: "Belanja akhir pekan",
    slug: "belanja-akhir-pekan",
    updatedAt: Date.now() - 1000 * 60 * 60 * 25,
    locked: false,
    content: `## Pasar\n- [ ] Alpukat\n- [ ] Roti sourdough\n- [x] Susu oat\n\n## Jangan lupa\n\nBawa tas belanja dari rumah.`,
  },
];

const rootDraftNote: Note = {
  id: "root-draft",
  title: "Catatan baru",
  slug: "",
  content: "",
  updatedAt: 0,
  locked: false,
};

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `Hari ini, ${date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function wordCount(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeNoteSlug(slug: string) {
  return slug.replace(/^catatan-([a-z0-9]{6})$/i, "$1");
}

function createRandomSlug(existingSlugs: Iterable<string>) {
  const usedSlugs = new Set(existingSlugs);
  let slug = "";
  do {
    slug = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  } while (usedSlugs.has(slug));
  return slug;
}

function LoadingSkeleton() {
  return (
    <div className="document-scroll" aria-label="Memuat isi catatan" aria-busy="true">
      <article className="document-canvas">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-meta" />
        <div className="skeleton-editor-panel">
          <div className="skeleton skeleton-line skeleton-line-long" />
          <div className="skeleton skeleton-line skeleton-line-medium" />
          <div className="skeleton skeleton-line skeleton-line-short" />
          <div className="skeleton skeleton-line skeleton-line-long skeleton-line-spaced" />
          <div className="skeleton skeleton-line skeleton-line-medium" />
        </div>
      </article>
    </div>
  );
}

export function NotepadApp({ initialSlug }: { initialSlug?: string }) {
  const routeKey = initialSlug ? `slug:${initialSlug}` : "root";
  const [notes, setNotes] = useState<Note[]>(() => {
    if (!initialSlug) return [rootDraftNote, ...starterNotes];
    const requestedSlug = normalizeNoteSlug(initialSlug);
    if (starterNotes.some((note) => note.slug === requestedSlug)) return starterNotes;
    return [{
      id: "route-placeholder",
      title: "Catatan baru",
      slug: requestedSlug,
      content: "",
      updatedAt: 0,
      locked: false,
    }, ...starterNotes];
  });
  const [selectedId, setSelectedId] = useState(() => {
    if (!initialSlug) return rootDraftNote.id;
    const requestedSlug = normalizeNoteSlug(initialSlug);
    return starterNotes.find((note) => note.slug === requestedSlug)?.id ?? "route-placeholder";
  });
  const [hydratedRoute, setHydratedRoute] = useState<string | null>(null);
  const isHydrated = hydratedRoute === routeKey;
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const initializedRouteRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializedRouteRef.current === routeKey) return;
    initializedRouteRef.current = routeKey;

    try {
      const raw = localStorage.getItem("niftydock-notes-v12");
      const parsed = raw ? JSON.parse(raw) : starterNotes;
      const stored: Note[] = Array.isArray(parsed)
        ? parsed.map((item) => ({
            id: typeof item?.id === "string" ? item.id : `note-${Math.random().toString(36).slice(2, 9)}`,
            title: typeof item?.title === "string" ? item.title : "Catatan tanpa judul",
            slug: typeof item?.slug === "string" ? normalizeNoteSlug(item.slug) : "catatan-baru",
            content: typeof item?.content === "string"
              ? item.content
              : starterNotes.find((note) => note.slug === item?.slug)?.content ?? "",
            updatedAt: typeof item?.updatedAt === "number" ? item.updatedAt : Date.now(),
            locked: item?.locked === true,
          }))
        : starterNotes;
      if (stored.length) setNotes(stored);
      const rawRequestedSlug = initialSlug ?? window.location.pathname.slice(1);
      if (!rawRequestedSlug) {
        const now = Date.now();
        const slug = createRandomSlug(stored.map((note) => note.slug));
        const note: Note = {
          id: `note-${now}-${slug}`,
          title: "Catatan baru",
          slug,
          content: "",
          updatedAt: now,
          locked: false,
        };
        const nextNotes = [note, ...stored];
        setNotes(nextNotes);
        setSelectedId(note.id);
        try {
          localStorage.setItem("niftydock-notes-v12", JSON.stringify(nextNotes));
        } catch {
          // Keep the new note available for this session if local storage is unavailable.
        }
        window.history.replaceState(null, "", `/${encodeURIComponent(slug)}`);
        setHydratedRoute(routeKey);
        return;
      }
      const requestedSlug = normalizeNoteSlug(rawRequestedSlug);
      const match = stored.find((note) => note.slug === requestedSlug);
      if (match) setSelectedId(match.id);
      else if (requestedSlug) {
        const note: Note = {
          id: `note-${Date.now()}`,
          title: requestedSlug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
          slug: requestedSlug,
          content: "# Catatan baru\n\n",
          updatedAt: Date.now(),
          locked: false,
        };
        setNotes((current) => [note, ...current]);
        setSelectedId(note.id);
      }
    } catch {
      // Ignore an invalid local draft and keep the starter notes.
    }
    setHydratedRoute(routeKey);
  }, [initialSlug, routeKey]);

  useEffect(() => {
    if (!isHydrated) return;
    setSaveState("saving");
    let saved = true;
    try {
      localStorage.setItem("niftydock-notes-v12", JSON.stringify(notes));
    } catch {
      saved = false;
    }
    const timeout = window.setTimeout(() => setSaveState(saved ? "saved" : "error"), 450);
    return () => window.clearTimeout(timeout);
  }, [isHydrated, notes]);

  const selected = notes.find((note) => note.id === selectedId) ?? notes[0];
  const storedContent = selected?.content;
  const selectedContent = typeof storedContent === "string" ? storedContent : "";
  const updateContent = useCallback((markdown: unknown) => {
    const content = typeof markdown === "string" ? markdown : "";
    const updatedAt = Date.now();
    setNotes((current) => {
      return current.map((note) => note.id === selectedId ? { ...note, content, updatedAt } : note);
    });
  }, [selectedId]);

  const applyMarkdown = (operation: "h1" | "h2" | "bold" | "italic" | "bullet" | "ordered" | "checklist" | "quote" | "code" | "table") => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (operation === "h1") chain.toggleHeading({ level: 1 }).run();
    else if (operation === "h2") chain.toggleHeading({ level: 2 }).run();
    else if (operation === "bold") chain.toggleBold().run();
    else if (operation === "italic") chain.toggleItalic().run();
    else if (operation === "bullet") chain.toggleBulletList().run();
    else if (operation === "ordered") chain.toggleOrderedList().run();
    else if (operation === "checklist") chain.toggleTaskList().run();
    else if (operation === "quote") {
      if (!editor.isActive("codeBlock")) chain.toggleBlockquote().run();
    } else if (operation === "code") {
      if (!editor.isActive("blockquote")) chain.toggleCodeBlock().run();
    } else if (operation === "table") {
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    }
  };

  const applyLink = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !linkUrl.trim()) return;
    const destination = /^(https?:|mailto:|tel:)/i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`;
    const { empty } = editor.state.selection;
    if (empty) {
      editor.chain().focus().insertContent({
        type: "text",
        text: "tautan",
        marks: [{ type: "link", attrs: { href: destination } }],
      }).run();
    } else {
      editor.chain().focus().setLink({ href: destination }).run();
    }
    setLinkUrl("");
    setLinkEditorOpen(false);
  };

  const createNote = () => {
    const now = Date.now();
    const slug = createRandomSlug(notes.map((note) => note.slug));
    const note: Note = {
      id: `note-${now}-${slug}`,
      title: "Catatan baru",
      slug,
      content: "",
      updatedAt: now,
      locked: false,
    };
    setNotes((current) => [note, ...current]);
    setSelectedId(note.id);
    window.history.replaceState(null, "", `/${encodeURIComponent(note.slug)}`);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/${encodeURIComponent(selected.slug)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyFailed(true);
      window.setTimeout(() => setCopyFailed(false), 2200);
    }
  };

  const ToolbarButton = ({ label, onClick, children, active = false, disabled = false }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || !isHydrated}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onClick();
      }}
      className={cn("toolbar-button", active && "toolbar-button-active")}
    >{children}</button>
  );

  if (!selected) return null;

  return (
    <main className="app-shell">
      <section className="app-main" suppressHydrationWarning aria-busy={!isHydrated}>
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-brand">
              <div className="brand-mark"><span /></div>
              <div className="brand-copy"><span>NiftyDock</span><span>NOTEPAD</span></div>
            </div>
          </div>
          <div className="topbar-right">
            <Button variant="ghost" size="sm" className="new-note-button" onClick={createNote} disabled={!isHydrated}><Plus size={15} /><span>Catatan baru</span></Button>
            <Button variant="subtle" size="sm" className="share-button" onClick={copyLink} disabled={!isHydrated}>{copied ? <Check size={14} /> : <Share2 size={14} />}<span>{copied ? "Tersalin" : copyFailed ? "Gagal menyalin" : "Bagikan"}</span></Button>
          </div>
        </header>

        <div className="editor-toolbar-wrap">
          <div className="editor-toolbar">
            <div className="toolbar-group">
              <ToolbarButton label="Judul 1" onClick={() => applyMarkdown("h1")} active={!!editor?.isActive("heading", { level: 1 })}><Heading1 size={16} /></ToolbarButton>
              <ToolbarButton label="Judul 2" onClick={() => applyMarkdown("h2")} active={!!editor?.isActive("heading", { level: 2 })}><Heading2 size={16} /></ToolbarButton>
            </div>
            <span className="toolbar-separator" />
            <div className="toolbar-group">
              <ToolbarButton label="Tebal" onClick={() => applyMarkdown("bold")} active={!!editor?.isActive("bold")}><Bold size={15} /></ToolbarButton>
              <ToolbarButton label="Miring" onClick={() => applyMarkdown("italic")} active={!!editor?.isActive("italic")}><Italic size={15} /></ToolbarButton>
              <div className="link-toolbar-group">
                <ToolbarButton label="Tautan" onClick={() => setLinkEditorOpen((open) => !open)} active={linkEditorOpen || !!editor?.isActive("link")}><Link2 size={15} /></ToolbarButton>
                {linkEditorOpen && <form className="link-popover" onSubmit={applyLink}>
                  <Input autoFocus aria-label="Alamat tautan" placeholder="https://alamat.com" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} className="link-url-input" />
                  <Button type="submit" size="sm" className="link-apply-button">Terapkan</Button>
                </form>}
              </div>
            </div>
            <span className="toolbar-separator" />
            <div className="toolbar-group">
              <ToolbarButton label="Daftar berpoin" onClick={() => applyMarkdown("bullet")} active={!!editor?.isActive("bulletList")}><List size={16} /></ToolbarButton>
              <ToolbarButton label="Daftar bernomor" onClick={() => applyMarkdown("ordered")} active={!!editor?.isActive("orderedList")}><ListOrdered size={16} /></ToolbarButton>
              <ToolbarButton label="Checklist" onClick={() => applyMarkdown("checklist")} active={!!editor?.isActive("taskList")}><ListChecks size={16} /></ToolbarButton>
              <ToolbarButton label="Kutipan" onClick={() => applyMarkdown("quote")} active={!!editor?.isActive("blockquote")}><Quote size={15} /></ToolbarButton>
              <ToolbarButton label="Blok kode" onClick={() => applyMarkdown("code")} active={!!editor?.isActive("codeBlock")}><Code2 size={15} /></ToolbarButton>
              <ToolbarButton label="Tabel" onClick={() => applyMarkdown("table")}><Table2 size={15} /></ToolbarButton>
            </div>
          </div>
        </div>

        {!isHydrated ? <LoadingSkeleton /> : <div className="document-scroll">
          <article className="document-canvas">
            <input
              aria-label="Judul catatan"
              className="document-title"
              value={selected.title}
              onChange={(event) => {
                const title = event.target.value;
                const updatedAt = Date.now();
                setNotes((current) => {
                  return current.map((note) => note.id === selectedId ? { ...note, title, updatedAt } : note);
                });
              }}
              placeholder="Judul catatan"
            />
            <div className="document-meta">{isHydrated ? `Terakhir diubah ${formatDate(selected.updatedAt).toLowerCase()}` : "Terakhir diubah"}</div>
            <div className="rich-editor">
              <RichEditor key={selected.id} value={selectedContent} onChange={updateContent} onEditorReady={setEditor} />
            </div>
          </article>
          <div className="page-bottom-spacer" />
        </div>}

        <footer className="statusbar">
          <div className="status-left"><span><span className="status-purple-dot" />{!isHydrated ? "Memuat catatan..." : saveState === "saving" ? "Menyimpan" : saveState === "error" ? "Gagal menyimpan" : "Tersimpan di perangkat ini"}</span></div>
          <div className="status-right"><span>{isHydrated ? `${wordCount(selectedContent)} kata` : "— kata"}</span><span className="status-divider" /><span>Sinkronisasi belum aktif</span></div>
        </footer>
      </section>
    </main>
  );
}
