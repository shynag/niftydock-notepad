"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRandomSlug,
  fromApiNote,
  latestTimestamp,
  normalizeNoteSlug,
  type ApiNote,
  type Note,
  type SaveState,
} from "@/lib/note-model";

type RealtimeState = "connecting" | "connected" | "offline" | "saving" | "error";

type UseNoteWorkspaceOptions = {
  initialSlug?: string;
  starterNotes: Note[];
  rootDraftNote: Note;
};

export function useNoteWorkspace({
  initialSlug,
  starterNotes,
  rootDraftNote,
}: UseNoteWorkspaceOptions) {
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
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
  const notesRef = useRef<Note[]>(notes);
  const versionsRef = useRef<Record<string, number>>({});
  const lastSavedTitleRef = useRef<Record<string, string>>({});
  const collaborationFlushRef = useRef<() => Promise<void>>(async () => undefined);
  const collaborationFlushReadyRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  notesRef.current = notes;

  const selected = notes.find((note) => note.id === selectedId) ?? notes[0];
  const selectedContent = typeof selected?.content === "string" ? selected.content : "";

  const registerCollaborationStatus = useCallback((status: RealtimeState) => {
    setRealtimeState(status);
  }, []);

  const handleRemoteNoteUpdate = useCallback(async (slug: string, incomingVersion: number) => {
    if (incomingVersion <= (versionsRef.current[slug] ?? 0)) return;
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      const remoteNote = fromApiNote(result.note as ApiNote);
      versionsRef.current[remoteNote.slug] = remoteNote.version;
      setNotes((current) => current.map((item) => {
        if (item.slug !== remoteNote.slug) return item;
        const hasLocalTitleChange = lastSavedTitleRef.current[item.slug] !== item.title;
        if (!hasLocalTitleChange) lastSavedTitleRef.current[item.slug] = remoteNote.title;
        return {
          ...item,
          title: hasLocalTitleChange ? item.title : remoteNote.title,
          version: remoteNote.version,
          updatedAt: latestTimestamp(item.updatedAt, remoteNote.updatedAt),
        };
      }));
    } catch {
      // The document's Yjs updates are synchronized separately from note metadata.
    }
  }, []);

  const registerCollaborationFlush = useCallback((flush: () => Promise<void>, ready: boolean) => {
    collaborationFlushRef.current = flush;
    collaborationFlushReadyRef.current = ready;
  }, []);

  const flushCollaboration = useCallback(async () => {
    const deadline = Date.now() + 15000;
    while (!collaborationFlushReadyRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 30));
    }
    if (!collaborationFlushReadyRef.current) throw new Error("Collaboration is not ready yet.");
    await collaborationFlushRef.current();
  }, []);

  const persistNote = useCallback((note: Note, force = false) => {
    const task = saveQueueRef.current.then(async () => {
      const latestNote = notesRef.current.find((current) => current.slug === note.slug) ?? note;
      let version = versionsRef.current[latestNote.slug] ?? latestNote.version;
      const keepLocalTitle = lastSavedTitleRef.current[latestNote.slug] !== latestNote.title;
      if (version === 0 && !force && latestNote.title === "New note" && !latestNote.content.trim()) return;
      if (version > 0 && lastSavedTitleRef.current[latestNote.slug] === latestNote.title) return;

      setSaveState("saving");
      try {
        let response = version === 0
          ? await fetch("/api/notes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug: latestNote.slug, title: latestNote.title, content: "" }),
            })
          : await fetch(`/api/notes/${encodeURIComponent(latestNote.slug)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: latestNote.title, version }),
            });

        if (response.status === 409 && version === 0) {
          const existingResponse = await fetch(`/api/notes/${encodeURIComponent(latestNote.slug)}`, { cache: "no-store" });
          if (!existingResponse.ok) throw new Error("Could not recover the saved note after a version conflict.");
          response = existingResponse;
        }

        if (response.status === 409 && version > 0) {
          const latestResponse = await fetch(`/api/notes/${encodeURIComponent(latestNote.slug)}`, { cache: "no-store" });
          if (!latestResponse.ok) throw new Error("Could not refresh the note title.");
          const latestResult = await latestResponse.json();
          const remoteNote = fromApiNote(latestResult.note as ApiNote);
          version = remoteNote.version;
          versionsRef.current[latestNote.slug] = version;
          if (remoteNote.title === latestNote.title) response = latestResponse;
          else {
            response = await fetch(`/api/notes/${encodeURIComponent(latestNote.slug)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: latestNote.title, version }),
            });
          }
        }

        if (!response.ok) throw new Error("Could not save the note.");
        const result = await response.json();
        const savedNote = fromApiNote(result.note as ApiNote);
        versionsRef.current[savedNote.slug] = savedNote.version;
        lastSavedTitleRef.current[savedNote.slug] = savedNote.title;
        setNotes((current) => current.map((currentNote) => currentNote.slug === savedNote.slug
          ? {
              ...currentNote,
              title: version === 0 && !keepLocalTitle ? savedNote.title : currentNote.title,
              id: savedNote.id,
              version: savedNote.version,
              updatedAt: latestTimestamp(currentNote.updatedAt, savedNote.updatedAt),
            }
          : currentNote));
        setSelectedId((currentSelectedId) => {
          const currentSelected = notesRef.current.find((currentNote) => currentNote.id === currentSelectedId);
          return currentSelected?.slug === savedNote.slug ? savedNote.id : currentSelectedId;
        });
        setSaveState("saved");
      } catch (error) {
        setSaveState("error");
        throw error;
      }
    });
    saveQueueRef.current = task.catch(() => undefined);
    return task;
  }, []);

  const updateContent = useCallback((markdown: unknown) => {
    const content = typeof markdown === "string" ? markdown : "";
    setNotes((current) => {
      let changed = false;
      const next = current.map((note) => {
        if (!(note.id === selectedId || (selected?.slug && note.slug === selected.slug)) || note.content === content) {
          return note;
        }
        changed = true;
        return { ...note, content, updatedAt: Date.now() };
      });
      return changed ? next : current;
    });
  }, [selectedId, selected?.slug]);

  const updateTitle = useCallback((title: string) => {
    setNotes((current) => {
      let changed = false;
      const next = current.map((note) => {
        if (!(note.id === selectedId || (selected?.slug && note.slug === selected.slug)) || note.title === title) {
          return note;
        }
        changed = true;
        return { ...note, title, updatedAt: Date.now() };
      });
      return changed ? next : current;
    });
  }, [selectedId, selected?.slug]);

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
      if (cachedNote) {
        setNotes((current) => [cachedNote, ...current.filter((note) => note.slug !== cachedNote.slug)]);
        setSelectedId(cachedNote.id);
        if (cachedNote.version > 0) {
          versionsRef.current[cachedNote.slug] = cachedNote.version;
          lastSavedTitleRef.current[cachedNote.slug] = cachedNote.title;
        } else {
          delete versionsRef.current[cachedNote.slug];
          lastSavedTitleRef.current[cachedNote.slug] = cachedNote.title;
        }
        setSaveState("saved");
        setRealtimeState("connecting");
        setHydratedRoute(routeKey);
      }

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
        loadedNote = cachedNote ?? {
          id: `offline-${Date.now()}`,
          title: "New note",
          slug: requestedSlug || createRandomSlug(stored.map((note) => note.slug)),
          content: "",
          updatedAt: Date.now(),
          version: 0,
        };
      }

      if (!active || !loadedNote) return;
      const currentCachedNote = cachedNote
        ? notesRef.current.find((note) => note.slug === cachedNote.slug)
        : undefined;
      const hasLocalEditsSinceCache = Boolean(
        cachedNote &&
        currentCachedNote &&
        (currentCachedNote.title !== cachedNote.title || currentCachedNote.content !== cachedNote.content),
      );
      const resolvedNote = hasLocalEditsSinceCache && currentCachedNote
        ? {
            ...loadedNote,
            title: currentCachedNote.title,
            content: currentCachedNote.content,
            updatedAt: currentCachedNote.updatedAt,
          }
        : loadedNote;
      setNotes((current) => [resolvedNote, ...current.filter((note) => note.slug !== resolvedNote.slug)]);
      setSelectedId(resolvedNote.id);
      if (resolvedNote.version > 0) {
        versionsRef.current[resolvedNote.slug] = resolvedNote.version;
        lastSavedTitleRef.current[resolvedNote.slug] = loadedNote.title;
      } else {
        delete versionsRef.current[resolvedNote.slug];
        lastSavedTitleRef.current[resolvedNote.slug] = loadedNote.title;
      }
      setSaveState(loadError && resolvedNote.version > 0 ? "error" : "saved");
      setRealtimeState("connecting");
      if (!requestedSlug) window.history.replaceState(null, "", `/${encodeURIComponent(resolvedNote.slug)}`);
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
        const found = notesRef.current.find((note) => note.slug === pathSlug);
        if (found) setSelectedId(found.id);
        else window.location.reload();
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const draftSlug = selected?.slug;
    if (!isHydrated || !selected || selected.version > 0 || !draftSlug) return;

    let active = true;
    let retryTimer: number | undefined;

    const scheduleCheck = () => {
      if (!active || retryTimer !== undefined) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void checkForRemoteNote();
      }, document.visibilityState === "visible" ? 2000 : 6000);
    };

    const checkForRemoteNote = async () => {
      if (!active) return;
      if (document.visibilityState !== "visible") {
        scheduleCheck();
        return;
      }

      try {
        const response = await fetch(`/api/notes/${encodeURIComponent(draftSlug)}`, { cache: "no-store" });
        if (response.ok) {
          const result = await response.json();
          const remoteNote = fromApiNote(result.note as ApiNote);
          const localNote = notesRef.current.find((note) => note.slug === draftSlug);
          if (!active || !localNote || localNote.version > 0) return;

          const keepLocalTitle = lastSavedTitleRef.current[draftSlug] !== localNote.title;
          versionsRef.current[draftSlug] = remoteNote.version;
          if (!keepLocalTitle) lastSavedTitleRef.current[draftSlug] = remoteNote.title;
          setNotes((current) => current.map((note) => note.slug === draftSlug
            ? {
                ...note,
                id: remoteNote.id,
                title: keepLocalTitle ? note.title : remoteNote.title,
                version: remoteNote.version,
                updatedAt: remoteNote.updatedAt,
              }
            : note));
          setSelectedId((current) => current === localNote.id ? remoteNote.id : current);
          return;
        }
      } catch {
        // Keep checking while the device is online; its local draft remains editable.
      }

      scheduleCheck();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      void checkForRemoteNote();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleCheck();
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isHydrated, selected?.id, selected?.slug, selected?.version]);

  useEffect(() => {
    if (!isHydrated || !selected) return;
    if (selected.version > 0 && lastSavedTitleRef.current[selected.slug] === selected.title) return;
    if (selected.version === 0 && selected.title === "New note" && !selectedContent.trim()) return;

    const timeout = window.setTimeout(() => {
      void persistNote(selected).catch(() => setSaveState("error"));
    }, 650);

    return () => window.clearTimeout(timeout);
  }, [isHydrated, persistNote, selected, selectedContent]);

  return {
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
  };
}
