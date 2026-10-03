// PROTOTYPE: throwaway variant switcher for UI prototypes. Not shipped in production builds.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { selectPrototypeVariant as select } from "./prototype-variant";
import "./prototype-switcher.css";

export function PrototypeSwitcher({ variants, current }: {
  variants: readonly { key: string; name: string }[];
  current: string;
}) {
  const index = Math.max(0, variants.findIndex((v) => v.key === current));
  const step = (by: number) => select(variants[(index + by + variants.length) % variants.length].key);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  if (import.meta.env.PROD) return null;
  const { key, name } = variants[index];
  return (
    <div className="prototype-switcher" role="toolbar" aria-label="Prototype variants">
      <button type="button" aria-label="Previous variant" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
      <span><b>{key}</b> {name} <small>{index + 1}/{variants.length}</small></span>
      <button type="button" aria-label="Next variant" onClick={() => step(1)}><ChevronRight size={18} /></button>
    </div>
  );
}
