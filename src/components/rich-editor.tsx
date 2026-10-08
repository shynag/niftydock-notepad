"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Editor as TiptapEditor, type Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Ellipsis, Plus, Trash2 } from "lucide-react";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { yCursorPlugin, yCursorPluginKey } from "@tiptap/y-tiptap";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { IndexeddbPersistence } from "y-indexeddb";
import { createNoteEditorExtensions } from "@/lib/note-editor-extensions";
import { createClient } from "@/utils/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

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

type TableControlsPosition = { top: number; left: number };

function createUpdateId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Keep the update ID in UUID v4 format for the API's validation, without
  // relying on randomUUID(), which is missing in some mobile browsers.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createPresenceProfile() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const colors = ["#7c9cff", "#e58ac8", "#f0a35c", "#55c5a1", "#c39aff", "#e57474"];
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 4).toUpperCase();
  return { name: `Guest ${suffix}`, color: colors[bytes[0] % colors.length] };
}

function buildRemoteCursor(user: { name?: string; color?: string }) {
  const color = user?.color ?? "#7c9cff";
  const cursor = document.createElement("span");
  cursor.className = "ProseMirror-yjs-cursor";
  cursor.style.borderColor = color;
  const label = document.createElement("div");
  label.textContent = user?.name ?? "Guest";
  label.style.backgroundColor = color;
  cursor.append(label);
  return cursor;
}

export function RichEditor({ slug, persisted, value, sourceMode, title, onChange, onTitleChange, onNoteUpdated, onPlainTextChange, onEditorReady, onCollaborationStatusChange, onFlushReady }: RichEditorProps) {
  const [tableControlsPosition, setTableControlsPosition] = useState<TableControlsPosition | null>(null);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [collaborationReady, setCollaborationReady] = useState(false);
  const tableControlsRef = useRef<HTMLDivElement>(null);
  const [ydoc] = useState(() => new Y.Doc());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPlainTextChangeRef = useRef(onPlainTextChange);
  onPlainTextChangeRef.current = onPlainTextChange;
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onNoteUpdatedRef = useRef(onNoteUpdated);
  onNoteUpdatedRef.current = onNoteUpdated;
  const titleRef = useRef(title);
  titleRef.current = title;
  const statusChangeRef = useRef(onCollaborationStatusChange);
  statusChangeRef.current = onCollaborationStatusChange;
  const flushHandlerRef = useRef<() => Promise<void>>(async () => undefined);
  const initialValueRef = useRef(value);

  useEffect(() => {
    const metadata = ydoc.getMap("metadata");
    const updateTitleFromDocument = () => {
      const sharedTitle = metadata.get("title");
      if (typeof sharedTitle === "string" && sharedTitle !== titleRef.current) {
        onTitleChangeRef.current(sharedTitle);
      }
    };
    metadata.observe(updateTitleFromDocument);
    updateTitleFromDocument();
    return () => metadata.unobserve(updateTitleFromDocument);
  }, [ydoc]);

  useEffect(() => {
    if (!persisted || !collaborationReady) return;
    const metadata = ydoc.getMap("metadata");
    if (metadata.get("title") !== title) metadata.set("title", title);
  }, [collaborationReady, persisted, title, ydoc]);

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
    editable: !persisted,
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
      if (!currentEditor.isActive("table")) setTableMenuOpen(false);
    },
  });

  useEffect(() => {
    if (!editor) return;

    let active = true;
    let channelConnected = false;
    let remoteReady = false;
    let syncingRemote = false;
    let syncAgain = false;
    let broadcastFailed = false;
    let flushPromise: Promise<void> | null = null;
    let debounceTimer: number | undefined;
    let retryTimer: number | undefined;
    let fallbackSyncTimer: number | undefined;
    let presenceTimer: number | undefined;
    let retryDelay = 1000;
    let pending: Uint8Array[] = [];
    let resolveReady: () => void = () => undefined;
    const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
    const remoteOrigin = { source: "supabase-realtime" };
    const setStatus = (status: "connecting" | "connected" | "offline" | "saving" | "error") => {
      if (active) statusChangeRef.current(status);
    };

    const startFallbackSync = () => {
      if (!active || (channelConnected && !broadcastFailed) || fallbackSyncTimer !== undefined) return;
      // Keep separate open editors converged when the Realtime socket cannot carry updates.
      fallbackSyncTimer = window.setInterval(() => {
        if ((!channelConnected || broadcastFailed) && remoteReady) void syncFromServer();
      }, 2500);
    };

    const markEditorReady = () => {
      if (!active) return;
      remoteReady = true;
      setCollaborationReady(true);
      editor.setEditable(true);
      resolveReady();
      if (channelConnected) setStatus(pending.length || flushPromise ? "saving" : "connected");
      else {
        setStatus("offline");
        startFallbackSync();
      }
    };

    let persistence: IndexeddbPersistence | null = null;
    let channel: RealtimeChannel | null = null;
    let supabase: ReturnType<typeof createClient> | null = null;

    if (!persisted) {
      setCollaborationReady(false);
      editor.setEditable(!initialValueRef.current.trim());
      setStatus("offline");
      flushHandlerRef.current = async () => undefined;
      onFlushReady(flushHandlerRef.current, false);
      try {
        persistence = new IndexeddbPersistence(`niftydock-note-${slug}`, ydoc);
        void persistence.whenSynced.then(() => {
          if (!active) return;
          if (!editor.getText() && initialValueRef.current.trim()) {
            editor.commands.setContent(initialValueRef.current, { contentType: "markdown" });
            onPlainTextChangeRef.current(editor.getText());
          }
          editor.setEditable(true);
        });
      } catch {
        // The note still stays in component state if browser IndexedDB is unavailable.
        editor.setEditable(true);
      }
      return () => {
        active = false;
        void persistence?.destroy();
        onFlushReady(async () => undefined, false);
      };
    }

    setCollaborationReady(false);
    editor.setEditable(false);
    setStatus("connecting");

    const awareness = new Awareness(ydoc);
    awareness.setLocalStateField("user", createPresenceProfile());
    editor.registerPlugin(yCursorPlugin(awareness, { cursorBuilder: buildRemoteCursor }));

    const publishPresence = async () => {
      if (!active || !channelConnected || !channel) return;
      try {
        const cursor = encodeAwarenessUpdate(awareness, [awareness.clientID]);
        await channel.track({ clientId: awareness.clientID, cursor: encodeBase64(cursor) });
      } catch {
        // Cursor presence is temporary; document edits continue syncing independently.
      }
    };

    const schedulePresencePublish = (changes: { added: number[]; updated: number[]; removed: number[] }) => {
      const localId = awareness.clientID;
      if (![...changes.added, ...changes.updated, ...changes.removed].includes(localId) || presenceTimer !== undefined) return;
      presenceTimer = window.setTimeout(() => {
        presenceTimer = undefined;
        void publishPresence();
      }, 100);
    };
    awareness.on("update", schedulePresencePublish);

    const syncPresence = () => {
      if (!channel) return;
      const activeClientIds = new Set<number>([awareness.clientID]);
      const presenceState = channel.presenceState<{ clientId?: number; cursor?: string }>();
      for (const entries of Object.values(presenceState)) {
        for (const entry of entries) {
          if (typeof entry.clientId === "number") activeClientIds.add(entry.clientId);
          if (typeof entry.cursor !== "string") continue;
          try {
            applyAwarenessUpdate(awareness, decodeBase64(entry.cursor), channel);
          } catch {
            // Ignore malformed transient cursor state.
          }
        }
      }
      const staleClientIds = [...awareness.getStates().keys()].filter((id) => !activeClientIds.has(id));
      if (staleClientIds.length) removeAwarenessStates(awareness, staleClientIds, channel);
    };

    const clearRemotePresence = () => {
      const remoteClientIds = [...awareness.getStates().keys()].filter((id) => id !== awareness.clientID);
      if (remoteClientIds.length) removeAwarenessStates(awareness, remoteClientIds, "disconnect");
    };

    const scheduleRetry = () => {
      if (!active || retryTimer !== undefined) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void flushUpdates();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };

    const flushUpdates = async () => {
      if (!active || !remoteReady) return;
      if (flushPromise) {
        await flushPromise;
        return;
      }
      if (!pending.length) return;

      flushPromise = (async () => {
        while (active && pending.length) {
          const mergedUpdate = Y.mergeUpdates(pending);
          pending = [];
          const updateId = createUpdateId();
          const data = encodeBase64(mergedUpdate);
          setStatus("saving");

          try {
            const response = await fetch(`/api/notes/${encodeURIComponent(slug)}/collaboration/updates`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ updates: [{ id: updateId, data }] }),
              keepalive: true,
            });
            if (!response.ok) throw new Error("Could not save the latest edits.");
            retryDelay = 1000;

            if (channel && channelConnected) {
              const result = await channel.send({
                type: "broadcast",
                event: "collab_update",
                payload: data.length <= 60000 ? { id: updateId, data } : { id: updateId },
              });
              if (result !== "ok") {
                broadcastFailed = true;
                channelConnected = false;
                setStatus("offline");
                startFallbackSync();
              }
            }
          } catch {
            pending = [mergedUpdate, ...pending];
            setStatus("error");
            scheduleRetry();
            break;
          }
        }
      })();

      try {
        await flushPromise;
      } finally {
        flushPromise = null;
      }
      if (active && pending.length === 0) setStatus(channelConnected && !broadcastFailed ? "connected" : "offline");
      if (active && pending.length > 0) scheduleRetry();
    };

    const scheduleFlush = () => {
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = undefined;
        void flushUpdates();
      }, 240);
    };

    const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      if (!active || origin === remoteOrigin) return;
      if (!remoteReady) {
        // The final state-vector diff below captures changes made while initial sync is in progress.
        return;
      }
      pending.push(update);
      scheduleFlush();
    };

    const syncFromServer = async () => {
      if (syncingRemote) {
        syncAgain = true;
        return;
      }
      syncingRemote = true;
      try {
        const response = await fetch(`/api/notes/${encodeURIComponent(slug)}/collaboration`, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load collaboration data.");
        const result = await response.json() as {
          initialized: boolean;
          state?: string;
          markdown?: string;
          title?: string;
          updates: { id: string; data: string }[];
        };

        await persistence?.whenSynced;
        if (!active) return;

        let initialState = result.state;
        if (!result.initialized) {
          let seedEditor: TiptapEditor | null = null;
          let seedDoc: Y.Doc | null = null;
          try {
            seedEditor = new TiptapEditor({
              extensions: createNoteEditorExtensions(),
              content: result.markdown ?? "",
              contentType: "markdown",
              editable: false,
            });
            seedDoc = prosemirrorJSONToYDoc(seedEditor.schema, seedEditor.getJSON(), "default");
            seedDoc.getMap("metadata").set("title", result.title ?? titleRef.current);
            const response = await fetch(`/api/notes/${encodeURIComponent(slug)}/collaboration`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ state: encodeBase64(Y.encodeStateAsUpdate(seedDoc)) }),
            });
            if (!response.ok) throw new Error("Could not initialize collaboration data.");
            const initialized = await response.json() as { state: string };
            initialState = initialized.state;
          } finally {
            seedEditor?.destroy();
            seedDoc?.destroy();
          }
        }
        if (!initialState) throw new Error("Collaboration state is missing.");

        const serverDoc = new Y.Doc();
        Y.applyUpdate(serverDoc, decodeBase64(initialState));
        for (const item of result.updates) Y.applyUpdate(serverDoc, decodeBase64(item.data));
        const serverStateVector = Y.encodeStateVector(serverDoc);

        Y.applyUpdate(ydoc, decodeBase64(initialState), remoteOrigin);
        for (const item of result.updates) Y.applyUpdate(ydoc, decodeBase64(item.data), remoteOrigin);

        // Re-send edits that were stored in IndexedDB while this device was offline.
        const localChanges = Y.encodeStateAsUpdate(ydoc, serverStateVector);
        serverDoc.destroy();
        if (localChanges.length > 2) pending.push(localChanges);

        const metadata = ydoc.getMap("metadata");
        if (metadata.get("remoteInitialized") !== true) metadata.set("remoteInitialized", true);
        markEditorReady();
        if (pending.length) void flushUpdates();
      } catch {
        if (!active) return;
        await persistence?.whenSynced;
        if (ydoc.getMap("metadata").get("remoteInitialized") === true) {
          markEditorReady();
        } else {
          setStatus("error");
        }
      } finally {
        syncingRemote = false;
        if (active && syncAgain) {
          syncAgain = false;
          void syncFromServer();
        }
      }
    };

    ydoc.on("update", onLocalUpdate);

    try {
      persistence = new IndexeddbPersistence(`niftydock-note-${slug}`, ydoc);
      void persistence.whenSynced.then(() => {
        if (!active) return;
        if (ydoc.getMap("metadata").get("remoteInitialized") === true) {
          markEditorReady();
          if (channelConnected) void syncFromServer();
        }
      });

      supabase = createClient();
      channel = supabase
        .channel(`note:${slug}`, { config: { private: true } })
        .on("presence", { event: "sync" }, syncPresence)
        .on("broadcast", { event: "collab_update" }, ({ payload }) => {
          if (typeof payload?.data === "string") {
            try {
              Y.applyUpdate(ydoc, decodeBase64(payload.data), remoteOrigin);
            } catch {
              void syncFromServer();
            }
          } else {
            void syncFromServer();
          }
        })
        .on("broadcast", { event: "note_updated" }, ({ payload }) => {
          const version = Number(payload?.version);
          if (Number.isFinite(version)) onNoteUpdatedRef.current(slug, version);
        })
        .subscribe((status) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            channelConnected = true;
            broadcastFailed = false;
            void publishPresence();
            if (fallbackSyncTimer !== undefined) {
              window.clearInterval(fallbackSyncTimer);
              fallbackSyncTimer = undefined;
            }
            void syncFromServer();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            channelConnected = false;
            clearRemotePresence();
            if (remoteReady) {
              setStatus(pending.length || flushPromise ? "saving" : "offline");
              startFallbackSync();
            }
          }
        });
      void syncFromServer();
    } catch {
      channelConnected = false;
      setStatus("error");
    }

    const flush = async () => {
      if (!remoteReady) {
        let timeoutId: number | undefined;
        try {
          await Promise.race([
            readyPromise,
            new Promise<void>((_, reject) => {
              timeoutId = window.setTimeout(() => reject(new Error("Collaboration is not connected yet.")), 15000);
            }),
          ]);
        } finally {
          if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        }
      }
      if (!remoteReady) throw new Error("Collaboration is not connected yet.");
      await flushUpdates();
      if (pending.length) throw new Error("Some edits are still waiting to sync.");
    };
    flushHandlerRef.current = flush;
    onFlushReady(flush, true);

    const handlePageHide = () => {
      void flushUpdates();
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      active = false;
      ydoc.off("update", onLocalUpdate);
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (fallbackSyncTimer !== undefined) window.clearInterval(fallbackSyncTimer);
      if (presenceTimer !== undefined) window.clearTimeout(presenceTimer);
      awareness.off("update", schedulePresencePublish);
      editor.unregisterPlugin(yCursorPluginKey);
      awareness.destroy();
      window.removeEventListener("pagehide", handlePageHide);
      flushHandlerRef.current = async () => undefined;
      onFlushReady(async () => undefined, false);
      if (channel && supabase) void supabase.removeChannel(channel);
      void persistence?.destroy();
      editor.setEditable(false);
      setCollaborationReady(false);
    };
  }, [editor, persisted, slug, ydoc, onFlushReady]);

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

  return (
    <>
      <div className="collaboration-editor-shell" aria-busy={persisted && !collaborationReady}>
        <EditorContent editor={editor} className={cnEditorContentClass(sourceMode)} />
        {persisted && !collaborationReady && <div className="collaboration-editor-loading" role="status">Syncing shared note…</div>}
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

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
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
