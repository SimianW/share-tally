import { useId } from "react";
import { Check } from "lucide-react";
import { Avatar } from "./ui";
import "./participant-picker.css";

type Member = {
  id: string;
  displayName: string;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  isCurrentUser: boolean;
};

// Chips show first names; members who share one also get their last initial.
function chipNames(members: Member[]) {
  const words = (m: Member) => m.displayName.trim().split(/\s+/);
  const first = (m: Member) => words(m)[0] || m.displayName;
  const others = members.filter((m) => !m.isCurrentUser);
  return new Map(
    members.map((m): [string, string] => {
      if (m.isCurrentUser) return [m.id, "You"];
      const shared = others.some((o) => o.id !== m.id && first(o).toLowerCase() === first(m).toLowerCase());
      const last = words(m).slice(1).pop();
      return [m.id, shared && last ? `${first(m)} ${last[0].toUpperCase()}.` : first(m)];
    }),
  );
}

export function ParticipantPicker({
  members,
  selected,
  lockedId,
  change,
  readOnly = false,
  shortcuts = false,
}: {
  members: Member[];
  selected: string[];
  lockedId: string;
  change: (ids: string[]) => void;
  readOnly?: boolean;
  shortcuts?: boolean;
}) {
  const heading = useId();
  const names = chipNames(members);
  // The locked member (the initiator) always comes first.
  const ordered = [...members].sort((a, b) => Number(b.id === lockedId) - Number(a.id === lockedId));
  const count = members.filter((m) => selected.includes(m.id)).length;
  return (
    <div className="people-picker" role="group" aria-labelledby={heading}>
      <div className="people-picker-head">
        <span className="sharing-section-title" id={heading}>Who's in?</span>
        <span className="people-picker-count">
          {count} of {members.length}
        </span>
        {shortcuts && !readOnly && (
          <span className="people-picker-shortcuts">
            <button type="button" onClick={() => change(members.map((m) => m.id))}>
              Everyone
            </button>
            <button type="button" onClick={() => change([lockedId])}>
              Just me
            </button>
          </span>
        )}
      </div>
      <div className="people-chips">
        {ordered.map((m) => (
          <label className="person-chip" key={m.id} title={m.displayName}>
            <input
              type="checkbox"
              aria-label={names.get(m.id)}
              checked={m.id === lockedId || selected.includes(m.id)}
              disabled={readOnly || m.id === lockedId}
              onChange={(e) =>
                change(e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id))
              }
            />
            <Avatar name={m.displayName} small imageUrl={m.imageUrl} fallbackImageUrl={m.fallbackImageUrl} />
            <span className="person-chip-name">{names.get(m.id)}</span>
            <Check className="person-chip-check" size={16} strokeWidth={3} aria-hidden="true" />
          </label>
        ))}
      </div>
    </div>
  );
}
