"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Editor as TiptapEditor, type Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { IndexeddbPersistence } from "y-indexeddb";
import { createNoteEditorExtensions } from "@/lib/note-editor-extensions";
import { createClient } from "@/utils/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type CollaborationStatus = "connecting" | "connected" | "offline" | "saving" | "error";
type CollaborationUpdate = { id: string; data: string };

type UseNoteCollaborationOptions = {
  editor: Editor | null;
  slug: string;
  persisted: boolean;
  value: string;
  title: string;
  ydoc: Y.Doc;
  onTitleChange: (title: string) => void;
  onPlainTextChange: (text: string) => void;
  onNoteUpdated: (slug: string, version: number) => void;
  onCollaborationStatusChange: (status: CollaborationStatus) => void;
  onFlushReady: (flush: () => Promise<void>, ready: boolean) => void;
};

export function useNoteCollaboration({
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
}: UseNoteCollaborationOptions) {
  const [collaborationReady, setCollaborationReady] = useState(false);
  const [localDraftReady, setLocalDraftReady] = useState(false);
  const [collaborationLoadFailed, setCollaborationLoadFailed] = useState(false);
  const retryCollaborationRef = useRef<() => void>(() => undefined);
  const startedAsDraftRef = useRef(!persisted);
  const localDraftReadyRef = useRef(false);
  const onPlainTextChangeRef = useRef(onPlainTextChange);
  const onTitleChangeRef = useRef(onTitleChange);
  const onNoteUpdatedRef = useRef(onNoteUpdated);
  const titleRef = useRef(title);
  const statusChangeRef = useRef(onCollaborationStatusChange);
  const flushHandlerRef = useRef<() => Promise<void>>(async () => undefined);
  const initialValueRef = useRef(value);
  const titleSyncPendingRef = useRef(false);
  onPlainTextChangeRef.current = onPlainTextChange;
  onTitleChangeRef.current = onTitleChange;
  onNoteUpdatedRef.current = onNoteUpdated;
  titleRef.current = title;
  statusChangeRef.current = onCollaborationStatusChange;

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
    if (!editor || !persisted || !collaborationReady) return;
    const metadata = ydoc.getMap("metadata");
    if (metadata.get("title") === title) {
      titleSyncPendingRef.current = false;
      return;
    }

    // Wait until typing pauses so incoming shared titles cannot replace partial input.
    titleSyncPendingRef.current = true;
    const timeout = window.setTimeout(() => {
      metadata.set("title", title);
      titleSyncPendingRef.current = false;
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [collaborationReady, editor, persisted, title, ydoc]);

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
    let syncRetryTimer: number | undefined;
    let fallbackSyncTimer: number | undefined;
    let broadcastRetryTimer: number | undefined;
    let retryDelay = 1000;
    let syncRetryDelay = 1000;
    let broadcastRetryDelay = 2000;
    let pending: Uint8Array[] = [];
    let resolveReady: () => void = () => undefined;
    const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
    const remoteOrigin = { source: "supabase-realtime" };
    const setStatus = (status: CollaborationStatus) => {
      if (active) statusChangeRef.current(status);
    };

    const startFallbackSync = () => {
      if (!active || (channelConnected && !broadcastFailed) || fallbackSyncTimer !== undefined) return;
      // Keep separate open editors converged when Realtime cannot carry updates.
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

    let syncFromServer: () => Promise<void>;
    const scheduleSyncRetry = () => {
      if (!active || syncRetryTimer !== undefined) return;
      syncRetryTimer = window.setTimeout(() => {
        syncRetryTimer = undefined;
        void syncFromServer();
      }, syncRetryDelay);
      syncRetryDelay = Math.min(syncRetryDelay * 2, 30000);
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
      // The state-vector diff below captures changes made during initial sync.
      if (!remoteReady) return;
      pending.push(update);
      scheduleFlush();
    };

    syncFromServer = async () => {
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
          updates: CollaborationUpdate[];
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
          const initializeResponse = await fetch(`/api/notes/${encodeURIComponent(slug)}/collaboration`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: initialState }),
          });
          if (!initializeResponse.ok) throw new Error("Could not initialize collaboration data.");
          const initialized = await initializeResponse.json() as { state: string };
          initialState = initialized.state;
        }
        if (!initialState) throw new Error("Collaboration state is missing.");

        const serverDoc = new Y.Doc();
        Y.applyUpdate(serverDoc, decodeBase64(initialState));
        for (const item of result.updates) Y.applyUpdate(serverDoc, decodeBase64(item.data));
        const serverStateVector = Y.encodeStateVector(serverDoc);

        Y.applyUpdate(ydoc, decodeBase64(initialState), remoteOrigin);
        for (const item of result.updates) Y.applyUpdate(ydoc, decodeBase64(item.data), remoteOrigin);

        const localChanges = Y.encodeStateAsUpdate(ydoc, serverStateVector);
        serverDoc.destroy();
        if (localChanges.length > 2) pending.push(localChanges);

        const metadata = ydoc.getMap("metadata");
        if (metadata.get("remoteInitialized") !== true) metadata.set("remoteInitialized", true);
        setCollaborationLoadFailed(false);
        syncRetryDelay = 1000;
        if (syncRetryTimer !== undefined) {
          window.clearTimeout(syncRetryTimer);
          syncRetryTimer = undefined;
        }
        markEditorReady();
        if (pending.length) void flushUpdates();
      } catch {
        if (!active) return;
        await persistence?.whenSynced;
        if (ydoc.getMap("metadata").get("remoteInitialized") === true) {
          setCollaborationLoadFailed(false);
          markEditorReady();
        } else {
          setCollaborationLoadFailed(true);
          setStatus("error");
        }
        scheduleSyncRetry();
      } finally {
        syncingRemote = false;
        if (active && syncAgain) {
          syncAgain = false;
          void syncFromServer();
        }
      }
    };

    retryCollaborationRef.current = () => {
      if (syncRetryTimer !== undefined) {
        window.clearTimeout(syncRetryTimer);
        syncRetryTimer = undefined;
      }
      syncRetryDelay = 1000;
      setCollaborationLoadFailed(false);
      void syncFromServer();
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
      if (syncRetryTimer !== undefined) window.clearTimeout(syncRetryTimer);
      if (fallbackSyncTimer !== undefined) window.clearInterval(fallbackSyncTimer);
      if (broadcastRetryTimer !== undefined) window.clearTimeout(broadcastRetryTimer);
      window.removeEventListener("pagehide", handlePageHide);
      retryCollaborationRef.current = () => undefined;
      flushHandlerRef.current = async () => undefined;
      onFlushReady(async () => undefined, false);
      if (channel && supabase) void supabase.removeChannel(channel);
      void persistence?.destroy();
      setCollaborationReady(false);
    };
  }, [editor, onFlushReady, persisted, slug, ydoc]);

  const retryCollaboration = useCallback(() => retryCollaborationRef.current(), []);

  return {
    collaborationReady,
    localDraftReady,
    collaborationLoadFailed,
    retryCollaboration,
  };
}

function createUpdateId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Keep UUID v4 formatting for API validation in browsers without randomUUID().
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
