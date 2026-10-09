import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNotePhotoApi } from "../../api/note-photos";
import { loadPhotoResource } from "../../browser/photo-resource";
import { Button } from "../Button";
import { NOTE_PHOTO_LIMIT, type NotePhotos } from "./use-note-photos";

export type OpenedNotePhoto = { url: string; width: number; height: number };

/**
 * One stored note photo. With `open`, it is a button that hands the loaded
 * picture to a viewer; `preview` shows a local copy instead of fetching it.
 */
export function NotePhotoThumbnail({ id, label, preview, open }: {
  id: string;
  label: string;
  preview?: string;
  open?: (photo: OpenedNotePhoto) => void;
}) {
  const api = useNotePhotoApi();
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    if (preview) return;
    return loadPhotoResource(
      (signal) => api.bytes(id, signal),
      (url) => setLoaded({ id, url }),
      () => setFailed(id),
    );
  }, [api, id, preview]);
  const url = preview ?? (loaded?.id === id ? loaded.url : "");
  if (failed === id && !preview) return <span className="note-photo-frame note-photo-missing">Photo unavailable</span>;
  if (!url) return <span className="note-photo-frame" role="status" aria-label={`Loading ${label.toLowerCase()}`} />;
  const image = <img src={url} alt={label} />;
  if (!open) return <span className="note-photo-frame">{image}</span>;
  return (
    <button
      type="button"
      className="note-photo-frame note-photo-open"
      aria-label={`View ${label.toLowerCase()}`}
      onClick={(event) => {
        const img = event.currentTarget.querySelector("img")!;
        if (img.naturalWidth) open({ url, width: img.naturalWidth, height: img.naturalHeight });
      }}
    >
      {image}
    </button>
  );
}

/** The Notes block's photos: thumbnails with ✕, uploads in progress or failed, and the add control. */
export function NotePhotoEditor({ photos, disabled = false }: { photos: NotePhotos; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const count = photos.shown.length + photos.pending.filter((entry) => !entry.error).length;
  return (
    <div className="note-photos" role="group" aria-label="Note photos">
      {(photos.shown.length > 0 || photos.pending.length > 0) && (
        <ul className="note-photo-list">
          {photos.shown.map((photo, index) => (
            <li key={photo.id} className="note-photo">
              <NotePhotoThumbnail id={photo.id} label={`Note photo ${index + 1}`} preview={photos.previews[photo.id]} />
              <button
                type="button"
                className="note-photo-remove"
                aria-label={`Remove note photo ${index + 1}`}
                disabled={disabled || photos.removing.includes(photo.id)}
                onClick={() => void photos.remove(photo.id)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
          {photos.pending.map((entry) => (
            <li key={entry.key} className={`note-photo note-photo-pending${entry.error ? " note-photo-failed" : ""}`}>
              <span className="note-photo-frame">{entry.preview && <img src={entry.preview} alt="" />}</span>
              {entry.error ? (
                <>
                  <span className="note-photo-status" role="alert">{entry.error}</span>
                  <button type="button" className="note-photo-remove" aria-label="Dismiss photo that was not added" onClick={() => photos.dismiss(entry.key)}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <span className="note-photo-status" role="status">
                  <LoaderCircle size={16} aria-hidden="true" /> Uploading…
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="note-photo-actions">
        {photos.free > 0 && (
          <>
            <input
              ref={input}
              hidden
              type="file"
              multiple
              aria-label="Choose note photos"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = "";
                void photos.add(files);
              }}
            />
            <Button variant="text" className="note-photo-add" disabled={disabled} onClick={() => input.current?.click()}>
              <ImagePlus size={16} aria-hidden="true" /> Add photos
            </Button>
          </>
        )}
        <span className="note-photo-count">
          {count} of {NOTE_PHOTO_LIMIT} photos{count === NOTE_PHOTO_LIMIT && " · Remove one to add another"}
        </span>
      </div>
      {photos.error && <p className="field-error" role="alert">{photos.error}</p>}
    </div>
  );
}
