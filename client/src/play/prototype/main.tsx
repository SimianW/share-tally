// PROTOTYPE for #150 — throwaway, do not ship.
// Plan: three variants of the By amount share picker, switchable via ?variant=A|B|C.
// Entry for /prototype-amount-portion.html: no Clerk, no API; same appearance and motion setup as main.tsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "../../index.css";
import { applySavedPalette, applySavedScheme, isPaletteKey, savePalette, saveScheme } from "../appearance";
import AmountPortionPrototype from "./AmountPortionPrototype";

applySavedPalette();
applySavedScheme();
// ?scheme= and ?palette= win over the saved choice, so a shared prototype URL looks the same.
const params = new URLSearchParams(location.search);
const scheme = params.get("scheme");
if (scheme === "light" || scheme === "dark") saveScheme(scheme);
const palette = params.get("palette");
if (isPaletteKey(palette)) savePalette(palette);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AmountPortionPrototype />
    </MotionConfig>
  </StrictMode>,
);
