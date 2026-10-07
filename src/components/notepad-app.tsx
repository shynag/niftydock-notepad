"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  Bold,
  Check,
  Code2,
  FileCode2,
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
  Redo2,
  Undo2,
} from "lucide-react";
import { RichEditor } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";

type Note = { id: string; title: string; slug: string; content: string; updatedAt: number; version: number };
type SaveState = "saved" | "saving" | "error";

const starterNotes: Note[] = [
  {
    id: "note-welcome",
    title: "Getting started",
    slug: "mulai-di-sini",
    updatedAt: Date.now() - 1000 * 60 * 12,
    version: 1,
    content: `# Notes, always within reach.\n\nWelcome to **NiftyDock Notepad** — a simple space for ideas, plans, and anything you want to keep close.\n\nWrite freely. Open your notes from any device with a single link, no account required.\n\n## Try the editor\n\n- **Bold**, *italic*, and links\n- Checkable lists\n- Quotes and code blocks\n\n## Share in three steps\n\n1. Write a note\n2. Copy its link\n3. Open it on another device\n\n> Tip: Press / to add formatting.\n\n## Today's plan\n\n- [x] Open your first note\n- [ ] Write down something to remember\n- [ ] Share a link with another device\n\n---\n\n*Your draft is saved on this device while the backend is being set up.*`,
  },
  {
    id: "note-ideas",
    title: "Product ideas",
    slug: "ide-produk",
    updatedAt: Date.now() - 1000 * 60 * 60 * 3,
    version: 1,
    content: `## What to build\n\n- Notes that open quickly from anywhere\n- Markdown that's comfortable to write and read\n- Lightweight collaboration without accounts\n\n## A question\n\n> What if sharing a note were as simple as sharing a link?\n\nSave an idea here and come back to it anytime.`,
  },
  {
    id: "note-list",
    title: "Weekend shopping",
    slug: "belanja-akhir-pekan",
    updatedAt: Date.now() - 1000 * 60 * 60 * 25,
    version: 1,
    content: `## Grocery store\n- [ ] Avocados\n- [ ] Sourdough bread\n- [x] Oat milk\n\n## Don't forget\n\nBring a reusable bag.`,
  },
];

const rootDraftNote: Note = {
  id: "root-draft",
  title: "New note",
  slug: "",
  content: "",
  updatedAt: 0,
  version: 0,
};

type ApiNote = {
  id: string;
  title: string;
  slug: string;
  content: string;
  updated_at: string;
  version: number | string;
};

function fromApiNote(note: ApiNote): Note {
  return {
    id: note.id,
    title: note.title,
    slug: note.slug,
    content: note.content,
    updatedAt: new Date(note.updated_at).getTime(),
    version: Number(note.version),
  };
}

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `Today, ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function normalizeNoteSlug(slug: string) {
  return slug.replace(/^catatan-([a-z0-9]{6})$/i, "$1");
}

function createRandomSlug(existingSlugs: Iterable<string>) {
  const usedSlugs = new Set(existingSlugs);
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let slug = "";
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    slug = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  } while (usedSlugs.has(slug));
  return slug;
}

function LoadingSkeleton() {
  return (
    <div className="document-scroll" aria-label="Loading note content" aria-busy="true">
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
      title: "New note",
      slug: requestedSlug,
      content: "",
      updatedAt: 0,
      version: 0,
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
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<"connecting" | "connected" | "offline">("connecting");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const versionsRef = useRef<Record<string, number>>({});
  const lastSavedRef = useRef<Record<string, string>>({});
  const pendingSavesRef = useRef<Record<string, boolean>>({});
  const notesRef = useRef<Note[]>(notes);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  notesRef.current = notes;

  useEffect(() => {
    let active = true;

    const loadRouteNote = async () => {
      let stored: Note[] = [];
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem("niftydock-notes-v12") ?? "null");
        if (Array.isArray(parsed)) {
          stored = parsed.map((item) => ({
            id: typeof item?.id === "string" ? item.id : `local-${Math.random().toString(36).slice(2, 9)}`,
            title: typeof item?.title === "string" ? item.title : "New note",
            slug: typeof item?.slug === "string" ? normalizeNoteSlug(item.slug) : "",
            content: typeof item?.content === "string" ? item.content : "",
            updatedAt: typeof item?.updatedAt === "number" ? item.updatedAt : Date.now(),
            version: Number.isInteger(item?.version) ? item.version : 0,
          }));
        }
      } catch {
        // Invalid local cache is ignored; Supabase remains the source of truth.
      }

      const requestedSlug = initialSlug ? normalizeNoteSlug(initialSlug) : "";
      const cachedNote = requestedSlug ? stored.find((note) => note.slug === requestedSlug) : undefined;
      let loadedNote: Note | null = null;
      let loadError = false;

      try {
        if (!requestedSlug) {
          loadedNote = {
            id: `local-${Date.now()}`,
            title: "New note",
            slug: createRandomSlug(stored.map((note) => note.slug)),
            content: "",
            updatedAt: Date.now(),
            version: 0,
          };
        } else {
          const response = await fetch(`/api/notes/${encodeURIComponent(requestedSlug)}`, { cache: "no-store" });
          if (response.status === 404) {
            loadedNote = cachedNote
              ? { ...cachedNote, version: 0 }
              : {
                  id: `local-${Date.now()}`,
                  title: "New note",
                  slug: requestedSlug,
                  content: "",
                  updatedAt: Date.now(),
                  version: 0,
                };
          } else if (!response.ok) {
            throw new Error("Could not load the note.");
          } else {
            const result = await response.json();
            loadedNote = fromApiNote(result.note as ApiNote);
          }
        }
      } catch {
        loadError = true;
        loadedNote = {
          id: `offline-${Date.now()}`,
          title: cachedNote?.title ?? "New note",
          slug: requestedSlug || createRandomSlug(stored.map((note) => note.slug)),
          content: cachedNote?.content ?? "",
          updatedAt: Date.now(),
          version: 0,
        };
      }

      if (!active || !loadedNote) return;
      const nextNotes = [loadedNote, ...stored.filter((note) => note.slug !== loadedNote?.slug)];
      setNotes(nextNotes);
      setSelectedId(loadedNote.id);
      if (loadedNote.version > 0) {
        versionsRef.current[loadedNote.slug] = loadedNote.version;
        lastSavedRef.current[loadedNote.slug] = JSON.stringify([loadedNote.title, loadedNote.content]);
      } else {
        delete versionsRef.current[loadedNote.slug];
        const fingerprint = JSON.stringify([loadedNote.title, loadedNote.content]);
        if (loadedNote.title === "New note" && loadedNote.content === "") {
          lastSavedRef.current[loadedNote.slug] = fingerprint;
        } else {
          delete lastSavedRef.current[loadedNote.slug];
        }
      }
      setSaveState(loadError && loadedNote.version > 0 ? "error" : "saved");
      setRealtimeState("connecting");
      if (!requestedSlug) window.history.replaceState(null, "", `/${encodeURIComponent(loadedNote.slug)}`);
      setHydratedRoute(routeKey);
    };

    void loadRouteNote();
    return () => {
      active = false;
    };
  }, [initialSlug, routeKey]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem("niftydock-notes-v12", JSON.stringify(notes));
    } catch {
      // The current session can continue if browser storage is unavailable.
    }
  }, [isHydrated, notes]);

  useEffect(() => {
    const handlePopState = () => {
      const pathSlug = window.location.pathname.replace(/^\/+/, "");
      if (pathSlug) {
        const found = notesRef.current.find((n) => n.slug === pathSlug);
        if (found) {
          setSelectedId(found.id);
        } else {
          window.location.reload();
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const selected = notes.find((note) => note.id === selectedId) ?? notes[0];
  const storedContent = selected?.content;
  const selectedContent = typeof storedContent === "string" ? storedContent : "";

  const persistNote = useCallback((note: Note, force = false) => {
    const task = saveQueueRef.current.then(async () => {
      const latestNote = notesRef.current.find((current) => current.slug === note.slug) ?? note;
      const fingerprint = JSON.stringify([latestNote.title, latestNote.content]);
      const version = versionsRef.current[latestNote.slug] ?? latestNote.version;
      if (version > 0 && lastSavedRef.current[latestNote.slug] === fingerprint) return;
      if (version === 0 && !force && lastSavedRef.current[latestNote.slug] === fingerprint) return;

      setSaveState("saving");
      pendingSavesRef.current[latestNote.slug] = true;
      try {
        const response = version > 0
          ? await fetch(`/api/notes/${encodeURIComponent(latestNote.slug)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: latestNote.title, content: latestNote.content, version }),
            })
          : await fetch("/api/notes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug: latestNote.slug, title: latestNote.title, content: latestNote.content }),
            });

        if (response.status === 409) {
          setConflictError("This note changed on another device. Reload to see the latest version.");
          setSaveState("error");
          return;
        }

        if (!response.ok) throw new Error("Could not save the note.");
        const result = await response.json();
        const savedNote = fromApiNote(result.note as ApiNote);
        versionsRef.current[savedNote.slug] = savedNote.version;
        lastSavedRef.current[savedNote.slug] = JSON.stringify([savedNote.title, savedNote.content]);
        setNotes((current) => current.map((currentNote) => currentNote.slug === savedNote.slug
          ? { ...currentNote, id: savedNote.id, version: savedNote.version, updatedAt: savedNote.updatedAt }
          : currentNote));
        setSelectedId((currentSelectedId) => {
          const currentSelected = notesRef.current.find((n) => n.id === currentSelectedId);
          if (currentSelected?.slug === savedNote.slug) {
            return savedNote.id;
          }
          return currentSelectedId;
        });
        setSaveState("saved");
        setConflictError(null);
      } finally {
        delete pendingSavesRef.current[latestNote.slug];
      }
    });
    saveQueueRef.current = task.catch(() => undefined);
    return task;
  }, []);

  useEffect(() => {
    if (!isHydrated || !selected) return;
    const fingerprint = JSON.stringify([selected.title, selectedContent]);
    if (lastSavedRef.current[selected.slug] === fingerprint) return;

    const timeout = window.setTimeout(() => {
      void persistNote(selected).catch(() => setSaveState("error"));
    }, 650);

    return () => window.clearTimeout(timeout);
  }, [isHydrated, persistNote, selected, selectedContent]);

  const isSaved = (selected?.version ?? 0) > 0;
  useEffect(() => {
    if (!isHydrated || !selected?.slug || !isSaved) {
      setRealtimeState("offline");
      return;
    }

    let active = true;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      setRealtimeState("offline");
      return;
    }

    const channel = supabase
      .channel(`note:${selected.slug}`, { config: { private: true } })
      .on("broadcast", { event: "note_updated" }, async ({ payload }) => {
        if (!active) return;
        const incomingVersion = Number(payload?.version);
        if (!Number.isFinite(incomingVersion)) return;
        if (pendingSavesRef.current[selected.slug]) return;
        const current = notesRef.current.find((note) => note.slug === selected.slug);
        if (!current) return;
        if (incomingVersion <= (versionsRef.current[selected.slug] ?? current.version)) return;

        const currentFingerprint = JSON.stringify([current.title, current.content]);
        if (lastSavedRef.current[selected.slug] !== currentFingerprint) {
          setSaveState("error");
          return;
        }

        try {
          const response = await fetch(`/api/notes/${encodeURIComponent(selected.slug)}`, { cache: "no-store" });
          if (!response.ok) return;
          const result = await response.json();
          const remoteNote = fromApiNote(result.note as ApiNote);
          if (!active) return;
          const latest = notesRef.current.find((note) => note.slug === selected.slug);
          if (!latest || JSON.stringify([latest.title, latest.content]) !== currentFingerprint) {
            setSaveState("error");
            return;
          }

          versionsRef.current[remoteNote.slug] = remoteNote.version;
          lastSavedRef.current[remoteNote.slug] = JSON.stringify([remoteNote.title, remoteNote.content]);
          setNotes((currentNotes) => currentNotes.map((note) => note.slug === remoteNote.slug
            ? { ...note, title: remoteNote.title, content: remoteNote.content, updatedAt: remoteNote.updatedAt, version: remoteNote.version }
            : note));
          setSaveState("saved");
        } catch {
          // A later Realtime event or a reload will fetch the latest saved note.
        }
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setRealtimeState("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeState("offline");
        }
      });

    return () => {
      active = false;
      setRealtimeState("offline");
      void supabase.removeChannel(channel);
    };
  }, [isHydrated, selected?.slug, isSaved]);

  const updateContent = useCallback((markdown: unknown) => {
    const content = typeof markdown === "string" ? markdown : "";
    const updatedAt = Date.now();
    setNotes((current) => {
      return current.map((note) => (note.id === selectedId || (selected?.slug && note.slug === selected.slug)) ? { ...note, content, updatedAt } : note);
    });
  }, [selectedId, selected?.slug]);

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
        text: "link text",
        marks: [{ type: "link", attrs: { href: destination } }],
      }).run();
    } else {
      editor.chain().focus().setLink({ href: destination }).run();
    }
    setLinkUrl("");
    setLinkEditorOpen(false);
  };

  const createNote = () => {
    if (selected) {
      const currentFingerprint = JSON.stringify([selected.title, selectedContent]);
      if (lastSavedRef.current[selected.slug] !== currentFingerprint) {
        void persistNote(selected, selected.version === 0);
      }
    }

    const now = Date.now();
    const slug = createRandomSlug(notesRef.current.map((item) => item.slug));
    const note: Note = {
      id: `local-${now}-${slug}`,
      title: "New note",
      slug,
      content: "",
      updatedAt: now,
      version: 0,
    };
    lastSavedRef.current[slug] = JSON.stringify([note.title, note.content]);
    setSaveState("saved");
    setConflictError(null);
    setNotes((current) => [note, ...current]);
    setSelectedId(note.id);
    window.history.pushState(null, "", `/${encodeURIComponent(note.slug)}`);
  };

  const copyLink = async () => {
    try {
      await persistNote(selected, selected.version === 0);
    } catch {
      setSaveState("error");
      return;
    }

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

  const toggleSourceMode = () => {
    const nextSourceMode = !sourceMode;
    setLinkEditorOpen(false);
    setSourceMode(nextSourceMode);
    if (!nextSourceMode) window.requestAnimationFrame(() => editor?.commands.focus());
  };

  const ToolbarButton = ({ label, onClick, children, active = false, disabled = false }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || !isHydrated || sourceMode}
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
            <Button variant="ghost" size="default" className="share-button" onClick={copyLink} disabled={!isHydrated}>{copied ? <Check size={17} /> : <Share2 size={17} />}<span>{copied ? "Copied" : copyFailed ? "Copy failed" : "Share"}</span></Button>
            <Button variant="subtle" size="default" className="new-note-button" onClick={createNote} disabled={!isHydrated}><Plus size={18} /><span>New note</span></Button>
          </div>
        </header>

        <div className="editor-toolbar-wrap">
          <div className="editor-toolbar">
            <div className="toolbar-group">
              <ToolbarButton label="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()}><Undo2 size={16} /></ToolbarButton>
              <ToolbarButton label="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()}><Redo2 size={16} /></ToolbarButton>
            </div>
            <span className="toolbar-separator" />
            <div className="toolbar-group">
              <ToolbarButton label="Heading 1" onClick={() => applyMarkdown("h1")} active={!!editor?.isActive("heading", { level: 1 })}><Heading1 size={16} /></ToolbarButton>
              <ToolbarButton label="Heading 2" onClick={() => applyMarkdown("h2")} active={!!editor?.isActive("heading", { level: 2 })}><Heading2 size={16} /></ToolbarButton>
            </div>
            <span className="toolbar-separator" />
            <div className="toolbar-group">
              <ToolbarButton label="Bold" onClick={() => applyMarkdown("bold")} active={!!editor?.isActive("bold")}><Bold size={15} /></ToolbarButton>
              <ToolbarButton label="Italic" onClick={() => applyMarkdown("italic")} active={!!editor?.isActive("italic")}><Italic size={15} /></ToolbarButton>
              <div className="link-toolbar-group">
                <ToolbarButton label="Link" onClick={() => setLinkEditorOpen((open) => !open)} active={linkEditorOpen || !!editor?.isActive("link")}><Link2 size={15} /></ToolbarButton>
                {linkEditorOpen && <form className="link-popover" onSubmit={applyLink}>
                  <Input autoFocus aria-label="Link URL" placeholder="https://example.com" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} className="link-url-input" />
                  <Button type="submit" size="sm" className="link-apply-button">Apply</Button>
                </form>}
              </div>
            </div>
            <span className="toolbar-separator" />
            <div className="toolbar-group toolbar-group-last">
              <ToolbarButton label="Bulleted list" onClick={() => applyMarkdown("bullet")} active={!!editor?.isActive("bulletList")}><List size={16} /></ToolbarButton>
              <ToolbarButton label="Numbered list" onClick={() => applyMarkdown("ordered")} active={!!editor?.isActive("orderedList")}><ListOrdered size={16} /></ToolbarButton>
              <ToolbarButton label="Checklist" onClick={() => applyMarkdown("checklist")} active={!!editor?.isActive("taskList")}><ListChecks size={16} /></ToolbarButton>
              <ToolbarButton label="Block quote" onClick={() => applyMarkdown("quote")} active={!!editor?.isActive("blockquote")}><Quote size={15} /></ToolbarButton>
              <ToolbarButton label="Code block" onClick={() => applyMarkdown("code")} active={!!editor?.isActive("codeBlock")}><Code2 size={15} /></ToolbarButton>
              <ToolbarButton label="Table" onClick={() => applyMarkdown("table")}><Table2 size={15} /></ToolbarButton>
              <span className="toolbar-separator" />
              <button
                type="button"
                title={sourceMode ? "Switch to visual editor" : "Switch to Markdown source"}
                aria-label={sourceMode ? "Switch to visual editor" : "Switch to Markdown source"}
                aria-pressed={sourceMode}
                disabled={!isHydrated}
                onMouseDown={(event) => event.preventDefault()}
                onClick={toggleSourceMode}
                className={cn("toolbar-button", "source-mode-toggle", sourceMode && "toolbar-button-active")}
              ><FileCode2 size={16} /></button>
            </div>
          </div>
        </div>

        {!isHydrated ? <LoadingSkeleton /> : <div className="document-scroll">
          <article className="document-canvas">
            <input
              aria-label="Note title"
              className="document-title"
              value={selected.title}
              onChange={(event) => {
                const title = event.target.value;
                const updatedAt = Date.now();
                setNotes((current) => {
                  return current.map((note) => (note.id === selectedId || (selected?.slug && note.slug === selected.slug)) ? { ...note, title, updatedAt } : note);
                });
              }}
              placeholder="Untitled note"
            />
            <div className="document-meta">{isHydrated ? `Last edited ${formatDate(selected.updatedAt).toLowerCase()}` : "Last edited"}</div>
            <div className="rich-editor">
              <RichEditor key={selected.slug || selected.id} value={selectedContent} sourceMode={sourceMode} onChange={updateContent} onPlainTextChange={(text) => setCharacterCount(Array.from(text).length)} onEditorReady={setEditor} />
            </div>
          </article>
          <div className="page-bottom-spacer" />
        </div>}

        <div className="statusbar" role="status" aria-label="Note status">
          <div className="status-left">
            <span>
              <span className={cn("status-purple-dot", (saveState === "error" || conflictError) && "bg-destructive")} />
              {!isHydrated
                ? "Loading note..."
                : saveState === "saving"
                ? "Saving"
                : saveState === "error"
                ? conflictError || "Save failed"
                : selected.version > 0
                ? "Saved to Supabase"
                : "Saved on this device"}
            </span>
            {conflictError && (
              <button
                type="button"
                className="ml-2 underline text-xs text-[#cebaff] hover:text-white"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            )}
          </div>
          <div className="status-right">
            <span>{isHydrated ? `${characterCount} characters` : "— characters"}</span>
            <span className="status-divider" />
            <span>{selected.version === 0 ? "Live after first save" : realtimeState === "connected" ? "Live active" : realtimeState === "connecting" ? "Connecting..." : "Live disconnected"}</span>
          </div>
        </div>
      </section>
    </main>
  );
}
