"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Ellipsis, Plus, Trash2 } from "lucide-react";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { createNoteEditorExtensions } from "@/lib/note-editor-extensions";
import { useNoteCollaboration } from "@/components/use-note-collaboration";

type RichEditorProps = {
  slug: string;
  persisted: boolean;
  value: string;
  sourceMode: boolean;
  title: string;
  onChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onNoteUpdated: (slug: string, version: number) => void;
  onPlainTextChange: (value: string) => void;
  onEditorReady: (editor: Editor | null) => void;
  onCollaborationStatusChange: (status: "connecting" | "connected" | "offline" | "saving" | "error") => void;
  onFlushReady: (flush: () => Promise<void>, ready: boolean) => void;
};

type TableControlsPosition = { top: number; left: number; menuAbove: boolean };

export function RichEditor({ slug, persisted, value, sourceMode, title, onChange, onTitleChange, onNoteUpdated, onPlainTextChange, onEditorReady, onCollaborationStatusChange, onFlushReady }: RichEditorProps) {
  const [tableControlsPosition, setTableControlsPosition] = useState<TableControlsPosition | null>(null);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const tableControlsRef = useRef<HTMLDivElement>(null);
  const tableMenuOpenRef = useRef(tableMenuOpen);
  tableMenuOpenRef.current = tableMenuOpen;
  const initiallyPersistedRef = useRef(persisted);
  const initialValueRef = useRef(value);
  const [ydoc] = useState(() => new Y.Doc());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPlainTextChangeRef = useRef(onPlainTextChange);
  onPlainTextChangeRef.current = onPlainTextChange;

  const updateTableControlsPosition = useCallback((currentEditor: Editor | null) => {
    if (!currentEditor?.isActive("table")) {
      if (!tableMenuOpenRef.current) setTableControlsPosition(null);
      return;
    }

    try {
      const selectionNode = currentEditor.view.domAtPos(currentEditor.state.selection.from).node;
      const selectionElement = selectionNode.nodeType === Node.ELEMENT_NODE
        ? selectionNode as Element
        : selectionNode.parentElement;
      const row = selectionElement?.closest("th, td")?.closest("tr");
      const table = row?.closest("table");
      const container = currentEditor.view.dom.closest(".rich-editor");
      if (!row || !table || !container) {
        setTableControlsPosition(null);
        return;
      }

      const rowRect = row.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const controlSize = 34;
      const controlOffset = 12;
      const visualViewport = window.visualViewport;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportBottom = visualViewport
        ? visualViewport.offsetTop + visualViewport.height
        : window.innerHeight;
      const rowTop = rowRect.top - containerRect.top + (rowRect.height - controlSize) / 2;
      const maxTop = viewportBottom - containerRect.top - controlSize - 8;
      const top = Math.max(8, Math.min(rowTop, maxTop));
      const left = Math.max(8, Math.min(
        tableRect.right - containerRect.left - controlSize + controlOffset,
        containerRect.width - controlSize - 8,
      ));
      const triggerTop = containerRect.top + top;
      const spaceAbove = Math.max(0, triggerTop - viewportTop - 8);
      const spaceBelow = Math.max(0, viewportBottom - triggerTop - controlSize - 8);
      const menuAbove = spaceAbove > spaceBelow;

      setTableControlsPosition((previous) => {
        if (
          previous &&
          Math.abs(previous.top - top) < 1 &&
          Math.abs(previous.left - left) < 1 &&
          previous.menuAbove === menuAbove
        ) {
          return previous;
        }
        return { top, left, menuAbove };
      });
    } catch {
      setTableControlsPosition(null);
    }
  }, []);

  useEffect(() => {
    if (sourceMode) {
      setTableMenuOpen(false);
      tableMenuOpenRef.current = false;
      setTableControlsPosition(null);
    }
  }, [sourceMode]);

  useEffect(() => {
    if (!tableMenuOpen) return;

    const frame = window.requestAnimationFrame(() => {
      const menu = tableControlsRef.current?.querySelector<HTMLElement>(".table-edit-menu");
      const scrollContainer = tableControlsRef.current?.closest(".rich-editor")
        ?.closest(".document-scroll");
      if (!menu || !scrollContainer) return;

      const menuRect = menu.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight;
      const margin = 8;
      let scrollDelta = 0;

      if (menuRect.top < viewportTop + margin) {
        scrollDelta = menuRect.top - viewportTop - margin;
      } else if (menuRect.bottom > viewportBottom - margin) {
        scrollDelta = menuRect.bottom - viewportBottom + margin;
      }

      if (scrollDelta) scrollContainer.scrollBy({ top: scrollDelta, behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [tableMenuOpen]);

  useEffect(() => {
    if (!tableMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!tableControlsRef.current?.contains(event.target as Node)) {
        tableMenuOpenRef.current = false;
        setTableMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        tableMenuOpenRef.current = false;
        setTableMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [tableMenuOpen]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !initiallyPersistedRef.current && !initialValueRef.current.trim(),
    extensions: [...createNoteEditorExtensions(), Collaboration.configure({ document: ydoc })],
    editorProps: {
      attributes: {
        class: "note-prose tiptap",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const md = currentEditor.getMarkdown();
      onChangeRef.current(md);
      onPlainTextChangeRef.current(currentEditor.getText());
    },
    onCreate: ({ editor: currentEditor }) => {
      onPlainTextChangeRef.current(currentEditor.getText());
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      updateTableControlsPosition(currentEditor);
      if (!currentEditor.isActive("table") && !tableMenuOpenRef.current) setTableMenuOpen(false);
    },
  });

  const {
    collaborationReady,
    localDraftReady,
    collaborationLoadFailed,
    retryCollaboration,
  } = useNoteCollaboration({
    editor,
    slug,
    persisted,
    value,
    title,
    ydoc,
    onTitleChange,
    onPlainTextChange,
    onNoteUpdated,
    onCollaborationStatusChange,
    onFlushReady,
  });

  useEffect(() => {
    onEditorReady(editor);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => updateTableControlsPosition(editor);
    editor.on("transaction", refresh);
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
    const scrollContainer = editor.view.dom.closest(".document-scroll");
    scrollContainer?.addEventListener("scroll", refresh, { passive: true });
    refresh();
    return () => {
      editor.off("transaction", refresh);
      window.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
      scrollContainer?.removeEventListener("scroll", refresh);
    };
  }, [editor, updateTableControlsPosition]);

  return (
    <>
      <div className={sourceMode ? "collaboration-editor-shell source-mode-hidden" : "collaboration-editor-shell"} aria-busy={persisted && !collaborationReady && !localDraftReady}>
        <EditorContent editor={editor} className={cnEditorContentClass(sourceMode)} />
        {persisted && !collaborationReady && !localDraftReady && (
          <div
            className="collaboration-editor-loading"
            role="status"
            aria-label={collaborationLoadFailed ? "Could not load shared note" : "Loading shared note"}
            aria-live="polite"
          >
            {collaborationLoadFailed ? (
              <div className="collaboration-load-error">
                <span>Could not load the shared note. Retrying...</span>
                <button type="button" onClick={retryCollaboration}>Retry now</button>
              </div>
            ) : (
              <>
                <div className="skeleton skeleton-line skeleton-line-long" />
                <div className="skeleton skeleton-line skeleton-line-medium" />
                <div className="skeleton skeleton-line skeleton-line-short" />
                <div className="skeleton skeleton-line skeleton-line-long skeleton-line-spaced" />
                <div className="skeleton skeleton-line skeleton-line-medium" />
              </>
            )}
          </div>
        )}
      </div>
      {sourceMode && <textarea
        className="markdown-source-editor"
        aria-label="Markdown source"
        autoFocus
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Write Markdown..."
        value={value}
        disabled={persisted && !collaborationReady}
        onChange={(event) => editor?.commands.setContent(event.target.value, { contentType: "markdown" })}
      />}
      {!sourceMode && editor && tableControlsPosition && <div
        ref={tableControlsRef}
        className="table-edit-controls"
        style={{ top: tableControlsPosition.top, left: tableControlsPosition.left }}
      >
        <button
          type="button"
          className="table-menu-trigger"
          title="Table options"
          aria-label="Table options"
          aria-haspopup="true"
          aria-expanded={tableMenuOpen}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const nextOpen = !tableMenuOpenRef.current;
            tableMenuOpenRef.current = nextOpen;
            setTableMenuOpen(nextOpen);
          }}
        ><Ellipsis size={18} /></button>
        {tableMenuOpen && <div
          className={tableControlsPosition.menuAbove ? "table-edit-menu table-edit-menu-above" : "table-edit-menu"}
          role="group"
          aria-label="Table options"
        >
          <TableControlButton label="Add row before" onClick={() => { editor.chain().focus().addRowBefore().run(); setTableMenuOpen(false); }}><Plus size={15} /><span>Add row before</span></TableControlButton>
          <TableControlButton label="Add row after" onClick={() => { editor.chain().focus().addRowAfter().run(); setTableMenuOpen(false); }}><Plus size={15} /><span>Add row after</span></TableControlButton>
          <TableControlButton label="Add column before" onClick={() => { editor.chain().focus().addColumnBefore().run(); setTableMenuOpen(false); }}><Plus size={15} /><span>Add column before</span></TableControlButton>
          <TableControlButton label="Add column after" onClick={() => { editor.chain().focus().addColumnAfter().run(); setTableMenuOpen(false); }}><Plus size={15} /><span>Add column after</span></TableControlButton>
          <span className="table-menu-separator" />
          <TableControlButton label="Remove column" onClick={() => { editor.chain().focus().deleteColumn().run(); setTableMenuOpen(false); }} disabled={!editor.can().deleteColumn()} destructive><Trash2 size={15} /><span>Remove column</span></TableControlButton>
          <TableControlButton label="Remove row" onClick={() => { editor.chain().focus().deleteRow().run(); setTableMenuOpen(false); }} disabled={!editor.can().deleteRow()} destructive><Trash2 size={15} /><span>Remove row</span></TableControlButton>
          <TableControlButton label="Remove table" onClick={() => { editor.chain().focus().deleteTable().run(); setTableMenuOpen(false); }} disabled={!editor.can().deleteTable()} destructive><Trash2 size={15} /><span>Remove table</span></TableControlButton>
        </div>}
      </div>}
    </>
  );
}

function cnEditorContentClass(sourceMode: boolean) {
  return sourceMode ? "markdown-editor-content source-mode-hidden" : "markdown-editor-content";
}

function TableControlButton({ label, onClick, children, disabled = false, destructive = false }: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      className={destructive ? "table-edit-button table-edit-button-destructive" : "table-edit-button"}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") event.preventDefault();
      }}
      onClick={onClick}
    >{children}</button>
  );
}
