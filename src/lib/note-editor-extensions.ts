import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";

export function createNoteEditorExtensions() {
  return [
    StarterKit.configure({
      link: false,
      undoRedo: false,
      codeBlock: { HTMLAttributes: { class: "code-block" } },
      blockquote: { HTMLAttributes: { class: "quote-block" } },
    }),
    Link.configure({ openOnClick: true, enableClickSelection: true, autolink: true, linkOnPaste: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false, renderWrapper: true }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder: "Start writing..." }),
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
