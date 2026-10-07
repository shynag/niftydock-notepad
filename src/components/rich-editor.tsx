"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Ellipsis, Plus, Trash2 } from "lucide-react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";

type RichEditorProps = {
  value: string;
  sourceMode: boolean;
  onChange: (value: string) => void;
  onPlainTextChange: (value: string) => void;
  onEditorReady: (editor: Editor | null) => void;
};

type TableControlsPosition = { top: number; left: number };

export function RichEditor({ value, sourceMode, onChange, onPlainTextChange, onEditorReady }: RichEditorProps) {
  const [tableControlsPosition, setTableControlsPosition] = useState<TableControlsPosition | null>(null);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const tableControlsRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPlainTextChangeRef = useRef(onPlainTextChange);
  onPlainTextChangeRef.current = onPlainTextChange;
  const lastEmittedMarkdownRef = useRef(value);

  const updateTableControlsPosition = useCallback((currentEditor: Editor | null) => {
    if (!currentEditor?.isActive("table")) {
      setTableControlsPosition(null);
      return;
    }

    try {
      const position = currentEditor.state.selection.from;
      const selectedNode = currentEditor.view.domAtPos(position).node;
      const selectedElement = selectedNode.nodeType === 1
        ? selectedNode as Element
        : selectedNode.parentElement;
      const table = selectedElement?.closest("table");
      const container = currentEditor.view.dom.closest(".rich-editor");
      if (!table || !container) {
        setTableControlsPosition(null);
        return;
      }

      const tableRect = table.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const controlsSize = 34;
      const newTop = Math.max(8, tableRect.top - containerRect.top - 17);
      const newLeft = Math.max(8, Math.min(tableRect.right - containerRect.left - controlsSize, containerRect.width - controlsSize - 8));

      setTableControlsPosition((prev) => {
        if (prev && Math.abs(prev.top - newTop) < 1 && Math.abs(prev.left - newLeft) < 1) {
          return prev;
        }
        return { top: newTop, left: newLeft };
      });
    } catch {
      setTableControlsPosition(null);
    }
  }, []);

  useEffect(() => {
    if (!tableMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!tableControlsRef.current?.contains(event.target as Node)) setTableMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTableMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [tableMenuOpen]);

  useEffect(() => {
    if (sourceMode) setTableMenuOpen(false);
  }, [sourceMode]);

  const editor = useEditor({
    immediatelyRender: false,
    content: value,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        link: false,
        codeBlock: { HTMLAttributes: { class: "code-block" } },
        blockquote: { HTMLAttributes: { class: "quote-block" } },
      }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false, renderWrapper: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: "Start writing..." }),
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
    editorProps: {
      attributes: {
        class: "note-prose tiptap",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const md = currentEditor.getMarkdown();
      lastEmittedMarkdownRef.current = md;
      onChangeRef.current(md);
      onPlainTextChangeRef.current(currentEditor.getText());
    },
    onCreate: ({ editor: currentEditor }) => {
      onPlainTextChangeRef.current(currentEditor.getText());
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      updateTableControlsPosition(currentEditor);
      if (!currentEditor.isActive("table")) setTableMenuOpen(false);
    },
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
    const scrollContainer = editor.view.dom.closest(".document-scroll");
    scrollContainer?.addEventListener("scroll", refresh, { passive: true });
    refresh();
    return () => {
      editor.off("transaction", refresh);
      window.removeEventListener("resize", refresh);
      scrollContainer?.removeEventListener("scroll", refresh);
    };
  }, [editor, updateTableControlsPosition]);

  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedMarkdownRef.current) return;
    lastEmittedMarkdownRef.current = value;
    const selection = editor.state.selection;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    onPlainTextChangeRef.current(editor.getText());
    if (editor.isFocused) {
      const position = Math.min(selection.from, editor.state.doc.content.size);
      editor.commands.setTextSelection(position);
    }
  }, [editor, value]);

  return (
    <>
      <EditorContent editor={editor} className={cnEditorContentClass(sourceMode)} />
      {sourceMode && <textarea
        className="markdown-source-editor"
        aria-label="Markdown source"
        autoFocus
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Write Markdown..."
        value={value}
        onChange={(event) => onChangeRef.current(event.target.value)}
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
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setTableMenuOpen((open) => !open)}
        ><Ellipsis size={18} /></button>
        {tableMenuOpen && <div className="table-edit-menu" role="group" aria-label="Table options">
          <TableControlButton label="Add row after" onClick={() => { editor.chain().focus().addRowAfter().run(); setTableMenuOpen(false); }}><Plus size={15} /><span>Add row after</span></TableControlButton>
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
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >{children}</button>
  );
}
