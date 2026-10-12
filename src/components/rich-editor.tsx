"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Editor as TiptapEditor, type Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Ellipsis, Plus, Trash2 } from "lucide-react";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
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

type TableControlsPosition = { top: number; left: number; menuAbove: boolean };

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

export function RichEditor({ slug, persisted, value, sourceMode, title, onChange, onTitleChange, onNoteUpdated, onPlainTextChange, onEditorReady, onCollaborationStatusChange, onFlushReady }: RichEditorProps) {
  const [tableControlsPosition, setTableControlsPosition] = useState<TableControlsPosition | null>(null);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [collaborationReady, setCollaborationReady] = useState(false);
  const [localDraftReady, setLocalDraftReady] = useState(false);
  const tableControlsRef = useRef<HTMLDivElement>(null);
  const tableMenuOpenRef = useRef(tableMenuOpen);
  tableMenuOpenRef.current = tableMenuOpen;
  const initiallyPersistedRef = useRef(persisted);
  const startedAsDraftRef = useRef(!persisted);
  const localDraftReadyRef = useRef(false);
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
  const titleSyncPendingRef = useRef(false);

  useEffect(() => {
    const metadata = ydoc.getMap("metadata");
    const updateTitleFromDocument = () => {
      const sharedTitle = metadata.get("title");
      if (typeof sharedTitle === "string" && sharedTitle !== titleRef.current) {
        if (titleSyncPendingRef.current) return;
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
    if (metadata.get("title") === title) {
      titleSyncPendingRef.current = false;
      return;
    }

    // Share a complete title after typing pauses so remote map updates cannot
    // race individual keystrokes and repeatedly replace the controlled input.
    titleSyncPendingRef.current = true;
    const timeout = window.setTimeout(() => {
      metadata.set("title", title);
      titleSyncPendingRef.current = false;
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [collaborationReady, persisted, title, ydoc]);

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
    let broadcastRetryTimer: number | undefined;
    let retryDelay = 1000;
    let broadcastRetryDelay = 2000;
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

    const stopFallbackSync = () => {
      if (fallbackSyncTimer === undefined) return;
      window.clearInterval(fallbackSyncTimer);
      fallbackSyncTimer = undefined;
    };

    const scheduleBroadcastRetry = (updateId: string, data: string) => {
      if (!active || broadcastRetryTimer !== undefined) return;
      broadcastRetryTimer = window.setTimeout(() => {
        broadcastRetryTimer = undefined;
        if (!active || !channel || !channelConnected) {
          scheduleBroadcastRetry(updateId, data);
          return;
        }

        void channel.send({
          type: "broadcast",
          event: "collab_update",
          payload: data.length <= 60000 ? { id: updateId, data } : { id: updateId },
        }).then((result) => {
          if (!active) return;
          if (result === "ok") {
            broadcastFailed = false;
            broadcastRetryDelay = 2000;
            stopFallbackSync();
            setStatus(pending.length || flushPromise ? "saving" : "connected");
            return;
          }

          console.warn("Realtime broadcast retry failed:", result);
          broadcastFailed = true;
          startFallbackSync();
          broadcastRetryDelay = Math.min(broadcastRetryDelay * 2, 30000);
          scheduleBroadcastRetry(updateId, data);
        }).catch((error: unknown) => {
          if (!active) return;
          console.warn("Realtime broadcast retry failed:", error);
          broadcastFailed = true;
          startFallbackSync();
          broadcastRetryDelay = Math.min(broadcastRetryDelay * 2, 30000);
          scheduleBroadcastRetry(updateId, data);
        });
      }, broadcastRetryDelay);
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
      if (!initialValueRef.current.trim()) {
        localDraftReadyRef.current = true;
        setLocalDraftReady(true);
      }
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
          localDraftReadyRef.current = true;
          setLocalDraftReady(true);
          editor.setEditable(true);
        });
      } catch {
        // The note still stays in component state if browser IndexedDB is unavailable.
        localDraftReadyRef.current = true;
        setLocalDraftReady(true);
        editor.setEditable(true);
      }
      return () => {
        active = false;
        void persistence?.destroy();
        onFlushReady(async () => undefined, false);
      };
    }

    setCollaborationReady(false);
    editor.setEditable(localDraftReadyRef.current);
    setStatus("connecting");

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
                setStatus("offline");
                startFallbackSync();
                console.warn("Realtime broadcast failed:", result);
                broadcastRetryDelay = 2000;
                scheduleBroadcastRetry(updateId, data);
              } else {
                broadcastFailed = false;
                broadcastRetryDelay = 2000;
                if (broadcastRetryTimer !== undefined) {
                  window.clearTimeout(broadcastRetryTimer);
                  broadcastRetryTimer = undefined;
                }
                stopFallbackSync();
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
          if (startedAsDraftRef.current && editor.getText()) {
            ydoc.getMap("metadata").set("title", titleRef.current);
            initialState = encodeBase64(Y.encodeStateAsUpdate(ydoc));
          } else {
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
              initialState = encodeBase64(Y.encodeStateAsUpdate(seedDoc));
            } finally {
              seedEditor?.destroy();
              seedDoc?.destroy();
            }
          }
          const response = await fetch(`/api/notes/${encodeURIComponent(slug)}/collaboration`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: initialState }),
          });
          if (!response.ok) throw new Error("Could not initialize collaboration data.");
          const initialized = await response.json() as { state: string };
          initialState = initialized.state;
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
        .on("system", {}, (payload) => {
          console.warn("Supabase Realtime system message:", payload);
        })
        .subscribe((status, error) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            channelConnected = true;
            broadcastFailed = false;
            broadcastRetryDelay = 2000;
            if (broadcastRetryTimer !== undefined) {
              window.clearTimeout(broadcastRetryTimer);
              broadcastRetryTimer = undefined;
            }
            stopFallbackSync();
            void syncFromServer();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            channelConnected = false;
            console.warn(`Supabase Realtime channel ${status.toLowerCase()}.`, error ?? { slug });
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
      if (broadcastRetryTimer !== undefined) window.clearTimeout(broadcastRetryTimer);
      window.removeEventListener("pagehide", handlePageHide);
      flushHandlerRef.current = async () => undefined;
      onFlushReady(async () => undefined, false);
      if (channel && supabase) void supabase.removeChannel(channel);
      void persistence?.destroy();
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
          <div className="collaboration-editor-loading" role="status" aria-label="Loading shared note" aria-live="polite">
            <div className="skeleton skeleton-line skeleton-line-long" />
            <div className="skeleton skeleton-line skeleton-line-medium" />
            <div className="skeleton skeleton-line skeleton-line-short" />
            <div className="skeleton skeleton-line skeleton-line-long skeleton-line-spaced" />
            <div className="skeleton skeleton-line skeleton-line-medium" />
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
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") event.preventDefault();
      }}
      onClick={onClick}
    >{children}</button>
  );
}
