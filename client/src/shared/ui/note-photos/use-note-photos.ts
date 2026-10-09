import type { NotePhoto } from "@share-tally/domain/contracts/bills";
import { useEffect, useRef, useState } from "react";
import { BillApiError } from "../../api/bill-error";
import { errorMessage } from "../../api/error-message";
import { compressNotePhoto } from "../../browser/photo-canvas";
import { localPhotoBlob } from "../../browser/photo-resource";

export const NOTE_PHOTO_LIMIT = 3;

/** A picked photo on its way to the server, or one that failed to get there. */
export type PendingNotePhoto = { key: number; preview: string; error: string };

/**
 * Uploads each picked photo as soon as it is compressed, in the order picked.
 * `photos` is the owner's list as last read; photos this editor added or
 * removed show at once, until a reread lists them.
 */
export function useNotePhotos({ photos, upload, remove, prepare, changed }: {
  photos: NotePhoto[];
  upload: (base64: string) => Promise<NotePhoto>;
  remove: (id: string) => Promise<void>;
  /** Runs once before a batch of uploads, such as saving a new draft first; false stops the batch. */
  prepare?: () => Promise<boolean>;
  /** After each stored change. */
  changed?: () => void;
}) {
  const [added, setAdded] = useState<NotePhoto[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingNotePhoto[]>([]);
  const [error, setError] = useState("");
  // Previews of this editor's own uploads, shown without fetching them back.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const urls = useRef(new Set<string>());
  const nextKey = useRef(0);
  // One upload at a time, so the server numbers photos in the order they were picked.
  const uploads = useRef(Promise.resolve());
  useEffect(() => {
    const owned = urls.current;
    return () => { for (const url of owned) URL.revokeObjectURL(url); };
  }, []);

  // Once a read lists an added photo, that read decides, so a removal elsewhere shows.
  const listedIds = photos.map((photo) => photo.id).join();
  const [listed, setListed] = useState(listedIds);
  if (listed !== listedIds) {
    setListed(listedIds);
    setAdded((current) => current.filter((photo) => !photos.some((entry) => entry.id === photo.id)));
  }
  const known = new Map([...photos, ...added].map((photo) => [photo.id, photo]));
  const shown = [...known.values()].filter((photo) => !removed.includes(photo.id))
    .sort((a, b) => a.position - b.position);
  const uploading = pending.filter((entry) => !entry.error).length;
  const free = Math.max(0, NOTE_PHOTO_LIMIT - shown.length - uploading);
  const update = (key: number, patch: Partial<PendingNotePhoto>) =>
    setPending((entries) => entries.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  const drop = (key: number) => setPending((entries) => entries.filter((entry) => entry.key !== key));

  async function add(files: File[]) {
    setError("");
    if (files.length > free)
      setError(`A bill can have up to ${NOTE_PHOTO_LIMIT} note photos${free ? `; only the first ${free === 1 ? "photo was" : `${free} were`} added` : ""}.`);
    const batch = files.slice(0, free).map((file) => ({ file, key: nextKey.current++ }));
    if (!batch.length) return;
    setPending((entries) => [...entries, ...batch.map(({ key }) => ({ key, preview: "", error: "" }))]);
    if (prepare && !(await prepare())) {
      for (const { key } of batch) update(key, { error: "Not added: the draft couldn't be saved first." });
      return;
    }
    // Compress one at a time to bound memory; each upload starts once its photo is ready.
    for (const { file, key } of batch) {
      let base64: string;
      try {
        base64 = await compressNotePhoto(file);
      } catch (failure) {
        update(key, { error: errorMessage(failure) });
        continue;
      }
      const preview = URL.createObjectURL(localPhotoBlob(base64));
      urls.current.add(preview);
      update(key, { preview });
      uploads.current = uploads.current.then(() => upload(base64)).then((photo) => {
        setPreviews((current) => ({ ...current, [photo.id]: preview }));
        setAdded((current) => [...current, photo]);
        drop(key);
        changed?.();
      }, (failure) => update(key, { error: errorMessage(failure) }));
    }
  }

  async function removePhoto(id: string) {
    setError("");
    setRemoving((current) => [...current, id]);
    try {
      await remove(id);
      setRemoved((current) => [...current, id]);
      changed?.();
    } catch (failure) {
      // Already gone, perhaps removed in another window.
      if (failure instanceof BillApiError && failure.status === 404) setRemoved((current) => [...current, id]);
      else setError(errorMessage(failure));
    } finally {
      setRemoving((current) => current.filter((entry) => entry !== id));
    }
  }

  return {
    shown, pending, previews, removing, error, free,
    /** Uploads or removals are still running; leaving or sharing now could lose them. */
    busy: uploading > 0 || removing.length > 0,
    add,
    remove: removePhoto,
    dismiss: drop,
  };
}
export type NotePhotos = ReturnType<typeof useNotePhotos>;
