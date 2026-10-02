import { DynamicIcon } from "lucide-react/dynamic";
import { CircleHelp } from "lucide-react";
import { isLucideIconName, isUnicodeIcon, type GroupIcon } from "./group-icon";

export function GroupIconView({ icon, size = 24 }: { icon: GroupIcon; size?: number }) {
  if (icon.type === "unicode" && isUnicodeIcon(icon.value)) {
    return <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>{icon.value}</span>;
  }
  if (icon.type === "lucide" && isLucideIconName(icon.value)) {
    return <DynamicIcon key={icon.value} name={icon.value} size={size} aria-hidden="true" fallback={() => <CircleHelp size={size} aria-hidden="true" />} />;
  }
  return <CircleHelp size={size} aria-hidden="true" />;
}
