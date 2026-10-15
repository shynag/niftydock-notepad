"use client";

import { useEffect, useRef, useState } from "react";
import { getMarkRange, type Editor } from "@tiptap/core";
import {
  Bold,
  Check,
  Code2,
  FileCode2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  LoaderCircle,
  List,
  ListChecks,
  ListOrdered,
  Plus,
  Quote,
  Search,
  Share2,
  Table2,
  Redo2,
  Undo2,
} from "lucide-react";
import { RichEditor } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fromApiNote, normalizeNoteSlug, type ApiNote, type Note } from "@/lib/note-model";
import { useNoteWorkspace } from "@/components/use-note-workspace";

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

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `Today, ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function slugFromTitle(title: string) {
  return title.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
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
  const {
    notes,
    setNotes,
    selectedId,
    setSelectedId,
    selected,
    selectedContent,
    isHydrated,
    saveState,
    setSaveState,
    realtimeState,
    notesRef,
    versionsRef,
    lastSavedTitleRef,
    persistNote,
    handleRemoteNoteUpdate,
    registerCollaborationStatus,
    registerCollaborationFlush,
    flushCollaboration,
    updateContent,
    updateTitle,
  } = useNoteWorkspace({ initialSlug, starterNotes, rootDraftNote });
  const [showSaveSpinner, setShowSaveSpinner] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkIsEditing, setLinkIsEditing] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [newNoteDialogOpen, setNewNoteDialogOpen] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteSlug, setNewNoteSlug] = useState("");
  const [newNoteSlugEdited, setNewNoteSlugEdited] = useState(false);
  const [newNoteError, setNewNoteError] = useState("");
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [searchNoteDialogOpen, setSearchNoteDialogOpen] = useState(false);
  const [searchNoteSlug, setSearchNoteSlug] = useState("");
  const [searchNoteError, setSearchNoteError] = useState("");
  const [isSearchingNote, setIsSearchingNote] = useState(false);
  const linkRangeRef = useRef({ from: 0, to: 0 });

  useEffect(() => {
    const isSaving = saveState === "saving" || realtimeState === "saving";
    if (!isSaving) {
      setShowSaveSpinner(false);
      return;
    }

    const timeout = window.setTimeout(() => setShowSaveSpinner(true), 500);
    return () => window.clearTimeout(timeout);
  }, [realtimeState, saveState]);

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

  const openLinkEditor = () => {
    if (!editor) return;

    const { from, to, empty, $from } = editor.state.selection;
    const activeLinkRange = empty ? getMarkRange($from, editor.schema.marks.link) : undefined;
    const range = activeLinkRange ?? { from, to };
    const existingLink = Boolean(activeLinkRange || editor.isActive("link"));
    const existingText = editor.state.doc.textBetween(range.from, range.to, " ");

    linkRangeRef.current = range;
    setLinkIsEditing(existingLink);
    setLinkText(existingText);
    setLinkUrl(existingLink ? String(editor.getAttributes("link").href ?? "") : "");
    setLinkEditorOpen(true);
  };

  const closeLinkEditor = () => {
    setLinkEditorOpen(false);
  };

  const applyLink = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !linkText.trim() || !linkUrl.trim()) return;
    const destination = /^(https?:|mailto:|tel:)/i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`;
    editor.chain().focus().insertContentAt(linkRangeRef.current, {
      type: "text",
      text: linkText.trim(),
      marks: [{ type: "link", attrs: { href: destination } }],
    }).run();
    setLinkText("");
    setLinkUrl("");
    setLinkEditorOpen(false);
  };

  const openNewNoteDialog = () => {
    setNewNoteTitle("");
    setNewNoteSlug("");
    setNewNoteSlugEdited(false);
    setNewNoteError("");
    setNewNoteDialogOpen(true);
  };

  const createNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newNoteTitle.trim();
    const slug = newNoteSlug.trim().toLowerCase();
    if (!title) {
      setNewNoteError("Enter a note name.");
      return;
    }
    if (title.length > 200) {
      setNewNoteError("Note name must be 200 characters or fewer.");
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      setNewNoteError("Use lowercase letters, numbers, and single hyphens for the slug.");
      return;
    }
    if (notesRef.current.some((note) => note.slug === slug)) {
      setNewNoteError("That slug is already used in this app.");
      return;
    }

    setIsCreatingNote(true);
    setNewNoteError("");
    try {
      if (selected) {
        await persistNote(selected, true);
        if (selected.version > 0) await flushCollaboration();
      }

      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title, content: "" }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setNewNoteError("That slug is already in use. Choose a different one.");
          return;
        }
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Could not create the note.");
      }

      const result = await response.json() as { note: ApiNote };
      const note = fromApiNote(result.note);
      versionsRef.current[note.slug] = note.version;
      lastSavedTitleRef.current[note.slug] = note.title;
      setSaveState("saved");
      setNotes((current) => [note, ...current.filter((item) => item.slug !== note.slug)]);
      setSelectedId(note.id);
      window.history.pushState(null, "", `/${encodeURIComponent(note.slug)}`);
      setNewNoteDialogOpen(false);
    } catch (error) {
      setNewNoteError(error instanceof Error ? error.message : "Could not create the note.");
    } finally {
      setIsCreatingNote(false);
    }
  };

  const searchNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const enteredSlug = searchNoteSlug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    const slug = normalizeNoteSlug(enteredSlug);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      setSearchNoteError("Enter a valid note slug.");
      return;
    }

    setIsSearchingNote(true);
    setSearchNoteError("");
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (response.status === 404) {
        setSearchNoteError("No note found with that slug.");
        return;
      }
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Could not search for the note.");
      }

      if (selected?.slug) {
        await persistNote(selected, true);
        if ((versionsRef.current[selected.slug] ?? selected.version) > 0) {
          await flushCollaboration();
        }
      }

      setSearchNoteDialogOpen(false);
      window.location.assign(`/${encodeURIComponent(slug)}`);
    } catch (error) {
      setSearchNoteError(error instanceof Error ? error.message : "Could not search for the note.");
    } finally {
      setIsSearchingNote(false);
    }
  };

  const copyLink = async () => {
    try {
      await persistNote(selected, selected.version === 0);
      await flushCollaboration();
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
      disabled={disabled || !isHydrated || sourceMode || !editor?.isEditable}
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
            <Button
              variant="ghost"
              size="default"
              className="search-note-button"
              aria-label="Search note by slug"
              onClick={() => {
                setSearchNoteSlug("");
                setSearchNoteError("");
                setSearchNoteDialogOpen(true);
              }}
              disabled={!isHydrated}
            >
              <Search size={17} />
              <span>Search</span>
            </Button>
            <Button variant="ghost" size="default" className="share-button" onClick={copyLink} disabled={!isHydrated}>{copied ? <Check size={17} /> : <Share2 size={17} />}<span>{copied ? "Copied" : copyFailed ? "Copy failed" : "Share"}</span></Button>
            <Button variant="subtle" size="default" className="new-note-button" onClick={openNewNoteDialog} disabled={!isHydrated}><Plus size={18} /><span>New note</span></Button>
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
              <ToolbarButton label={editor?.isActive("link") ? "Edit link" : "Add link"} onClick={openLinkEditor} active={linkEditorOpen || !!editor?.isActive("link")}><Link2 size={15} /></ToolbarButton>
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
                disabled={!isHydrated || !editor?.isEditable}
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
              onChange={(event) => updateTitle(event.target.value)}
              placeholder="Untitled note"
            />
            <div className="document-meta">{isHydrated ? `Last edited ${formatDate(selected.updatedAt).toLowerCase()}` : "Last edited"}</div>
            <div className="rich-editor">
              <RichEditor
                key={selected.slug || selected.id}
                slug={selected.slug}
                persisted={selected.version > 0}
                value={selectedContent}
                sourceMode={sourceMode}
                title={selected.title}
                onChange={updateContent}
                onTitleChange={updateTitle}
                onNoteUpdated={handleRemoteNoteUpdate}
                onPlainTextChange={(text) => setCharacterCount(Array.from(text).length)}
                onEditorReady={setEditor}
                onCollaborationStatusChange={registerCollaborationStatus}
                onFlushReady={registerCollaborationFlush}
              />
            </div>
          </article>
          <div className="page-bottom-spacer" />
        </div>}

        <div className="statusbar" role="status" aria-label="Note status">
          <span className="status-character-count">{isHydrated ? `${characterCount} characters` : "— characters"}</span>
          <div className="status-indicators">
            <span className="status-icon">
              {showSaveSpinner && (
                <LoaderCircle className="animate-spin" aria-label="Saving..." role="img" />
              )}
            </span>
          </div>
        </div>

        {searchNoteDialogOpen && (
          <div
            className="link-dialog-overlay"
            onMouseDown={(event) => {
              if (!isSearchingNote && event.target === event.currentTarget) setSearchNoteDialogOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isSearchingNote) setSearchNoteDialogOpen(false);
            }}
          >
            <section className="link-dialog" role="dialog" aria-modal="true" aria-labelledby="search-note-dialog-title">
              <div className="link-dialog-heading">
                <h2 id="search-note-dialog-title">Find a note</h2>
                <p>Enter the slug from the note URL.</p>
              </div>
              <form className="link-dialog-form" onSubmit={searchNote}>
                <label className="link-dialog-field">
                  <span className="link-dialog-label">Note slug</span>
                  <Input
                    autoFocus
                    maxLength={80}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    placeholder="project-ideas"
                    value={searchNoteSlug}
                    onChange={(event) => {
                      setSearchNoteSlug(event.target.value.toLowerCase());
                      setSearchNoteError("");
                    }}
                  />
                </label>
                {searchNoteError && <p className="new-note-error" role="alert">{searchNoteError}</p>}
                <div className="link-dialog-actions">
                  <Button type="button" variant="ghost" onClick={() => setSearchNoteDialogOpen(false)} disabled={isSearchingNote}>Cancel</Button>
                  <Button type="submit" className="new-note-submit-button" disabled={isSearchingNote || !searchNoteSlug.trim()}>
                    {isSearchingNote ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}
                    {isSearchingNote ? "Searching..." : "Search"}
                  </Button>
                </div>
              </form>
            </section>
          </div>
        )}

        {newNoteDialogOpen && (
          <div
            className="link-dialog-overlay"
            onMouseDown={(event) => {
              if (!isCreatingNote && event.target === event.currentTarget) setNewNoteDialogOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isCreatingNote) setNewNoteDialogOpen(false);
            }}
          >
            <section className="link-dialog" role="dialog" aria-modal="true" aria-labelledby="new-note-dialog-title">
              <div className="link-dialog-heading">
                <h2 id="new-note-dialog-title">Create a note</h2>
                <p>Choose a name and a URL slug for your note.</p>
              </div>
              <form className="link-dialog-form" onSubmit={createNote}>
                <label className="link-dialog-field">
                  <span className="link-dialog-label">Note name</span>
                  <Input
                    autoFocus
                    maxLength={200}
                    placeholder="e.g. Project ideas"
                    value={newNoteTitle}
                    onChange={(event) => {
                      const title = event.target.value;
                      setNewNoteTitle(title);
                      if (!newNoteSlugEdited) setNewNoteSlug(slugFromTitle(title));
                      setNewNoteError("");
                    }}
                  />
                </label>
                <label className="link-dialog-field">
                  <span className="link-dialog-label">Slug</span>
                  <Input
                    maxLength={80}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    placeholder="project-ideas"
                    value={newNoteSlug}
                    onChange={(event) => {
                      setNewNoteSlugEdited(true);
                      setNewNoteSlug(event.target.value.toLowerCase());
                      setNewNoteError("");
                    }}
                  />
                </label>
                <p className="new-note-url-preview">
                  https://niftydock-notepad.vercel.app/
                  <strong>{newNoteSlug || "your-slug"}</strong>
                </p>
                {newNoteError && <p className="new-note-error" role="alert">{newNoteError}</p>}
                <div className="link-dialog-actions">
                  <Button type="button" variant="ghost" onClick={() => setNewNoteDialogOpen(false)} disabled={isCreatingNote}>Cancel</Button>
                  <Button type="submit" className="new-note-submit-button" disabled={isCreatingNote || !newNoteTitle.trim() || !newNoteSlug.trim()}>
                    {isCreatingNote ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />}
                    {isCreatingNote ? "Creating..." : "Create note"}
                  </Button>
                </div>
              </form>
            </section>
          </div>
        )}

        {linkEditorOpen && (
          <div
            className="link-dialog-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeLinkEditor();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeLinkEditor();
            }}
          >
            <section className="link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title">
              <div className="link-dialog-heading">
                <h2 id="link-dialog-title">{linkIsEditing ? "Edit link" : "Add link"}</h2>
                <p>Choose the text people will see and where it should open.</p>
              </div>
              <form className="link-dialog-form" onSubmit={applyLink}>
                <label className="link-dialog-field">
                  <span className="link-dialog-label">Display text</span>
                  <Input autoFocus aria-label="Display text" placeholder="Link text" value={linkText} onChange={(event) => setLinkText(event.target.value)} />
                </label>
                <label className="link-dialog-field">
                  <span className="link-dialog-label">URL</span>
                  <Input aria-label="Link URL" type="text" inputMode="url" placeholder="https://example.com" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
                </label>
                <div className="link-dialog-actions">
                  <Button type="button" variant="ghost" onClick={closeLinkEditor}>Cancel</Button>
                  <Button type="submit" disabled={!linkText.trim() || !linkUrl.trim()}>Apply link</Button>
                </div>
              </form>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
