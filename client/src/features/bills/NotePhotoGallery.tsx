import type { NotePhoto } from "@share-tally/domain/contracts/bills";
import { useState } from "react";
import { NotePhotoThumbnail, type OpenedNotePhoto } from "../../shared/ui/note-photos/NotePhotos";
import { ReceiptPhotoViewer } from "../receipts/photos/ReceiptPhotoViewer";

/** A bill's note photos as thumbnails; each opens full screen with zoom. */
export function NotePhotoGallery({ photos }: { photos: NotePhoto[] }) {
  const [opened, setOpened] = useState<OpenedNotePhoto & { id: string } | null>(null);
  // A photo removed while open closes with it; its thumbnail no longer holds the picture.
  const index = opened ? photos.findIndex((photo) => photo.id === opened.id) : -1;
  return (
    <>
      <ul className="note-photo-list" aria-label="Note photos">
        {photos.map((photo, position) => (
          <li key={photo.id} className="note-photo">
            <NotePhotoThumbnail id={photo.id} label={`Note photo ${position + 1}`} open={(image) => setOpened({ ...image, id: photo.id })} />
          </li>
        ))}
      </ul>
      {opened && index >= 0 && (
        <ReceiptPhotoViewer
          image={opened}
          title={`Note photo ${index + 1} of ${photos.length}`}
          kicker="PURCHASE NOTES"
          imageLabel={`Full-size note photo ${index + 1}`}
          close={() => setOpened(null)}
        />
      )}
    </>
  );
}
