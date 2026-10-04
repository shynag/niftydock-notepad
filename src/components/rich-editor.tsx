"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Minus, Plus, Trash2 } from "lucide-react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";

type RichEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onEditorReady: (editor: Editor | null) => void;
};

type TableControlsPosition = { top: number; left: number };

export function RichEditor({ value, onChange, onEditorReady }: RichEditorProps) {
  const [tableControlsPosition, setTableControlsPosition] = useState<TableControlsPosition | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
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
      const controlsWidth = Math.min(360, containerRect.width - 16);
      const newTop = Math.max(8, tableRect.top - containerRect.top - 42);
      const newLeft = Math.max(8, Math.min(tableRect.left - containerRect.left, containerRect.width - controlsWidth - 8));

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
    },
    onSelectionUpdate: ({ editor: currentEditor }) => updateTableControlsPosition(currentEditor),
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
    if (editor.isFocused) {
      const position = Math.min(selection.from, editor.state.doc.content.size);
      editor.commands.setTextSelection(position);
    }
  }, [editor, value]);

  return (
    <>
      <EditorContent editor={editor} className="markdown-editor-content" />
      {editor && tableControlsPosition && <div
        className="table-edit-controls"
        role="toolbar"
        aria-label="Kontrol tabel"
        style={{ top: tableControlsPosition.top, left: tableControlsPosition.left }}
      >
        <TableControlButton label="Tambah baris" onClick={() => editor.chain().focus().addRowAfter().run()}><Plus size={14} /><span>Baris</span></TableControlButton>
        <TableControlButton label="Hapus baris" onClick={() => editor.chain().focus().deleteRow().run()} disabled={!editor.can().deleteRow()}><Minus size={14} /><span>Baris</span></TableControlButton>
        <TableControlButton label="Tambah kolom" onClick={() => editor.chain().focus().addColumnAfter().run()}><Plus size={14} /><span>Kolom</span></TableControlButton>
        <TableControlButton label="Hapus kolom" onClick={() => editor.chain().focus().deleteColumn().run()} disabled={!editor.can().deleteColumn()}><Minus size={14} /><span>Kolom</span></TableControlButton>
        <TableControlButton label="Hapus tabel" onClick={() => editor.chain().focus().deleteTable().run()} disabled={!editor.can().deleteTable()} destructive><Trash2 size={14} /><span>Hapus</span></TableControlButton>
      </div>}
    </>
  );
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
