import { useState, type CSSProperties } from "react";
import { avatarTint } from "../../theme/appearance";
export function Avatar({
  name,
  small = false,
  imageUrl,
  fallbackImageUrl,
}: {
  name: string;
  small?: boolean;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
}) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const source = [imageUrl, fallbackImageUrl].find(url => url && !failedUrls.includes(url));
  const color = avatarTint(name);
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={{ "--avatar-color": color } as CSSProperties}
      title={name}
    >
      {source ? (
        <img src={source} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrls(urls => [...urls, source])} />
      ) : name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
export function Avatars({ names }: { names: string[] }) {
  return (
    <span className="avatar-stack" aria-label={names.join(", ")}>
      {names.slice(0, 4).map((n) => (
        <Avatar key={n} name={n} small />
      ))}
      {names.length > 4 && (
        <span className="avatar avatar-more small">+{names.length - 4}</span>
      )}
    </span>
  );
}
