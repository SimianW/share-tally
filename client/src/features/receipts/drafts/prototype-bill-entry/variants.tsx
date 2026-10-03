// PROTOTYPE (throwaway): three entry-screen variants that present the two ways
// to split a bill — itemised (scan or type items) and a fixed amount — as
// equally weighted choices. Switch with ?variant=current|A|B|C on
// #/new-bill/<group>. Only step 0 ("Receipt") changes; Items and People are untouched.
import { type ComponentType } from "react";
import { ReceiptSourceStep } from "../ReceiptSourceStep";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";

export type EntryProps = Parameters<typeof ReceiptSourceStep>[0];

export const entryVariants: readonly {
  key: string;
  name: string;
  /** Step 0 heading and description shown above the variant. */
  title: string;
  description: string;
  Component: ComponentType<EntryProps>;
}[] = [
  { key: "current", name: "Current screen", title: "Start with your receipt",
    description: "Use a receipt to fill in the items, or enter them yourself.", Component: ReceiptSourceStep },
  { key: "A", name: "Two doors", title: "How do you want to split this?",
    description: "Split item by item, or divide one total between people.", Component: VariantA },
  { key: "B", name: "Mode toggle", title: "How do you want to split it?",
    description: "Go item by item, or share out one total. You can switch before you continue.", Component: VariantB },
  { key: "C", name: "Facing pages", title: "Split by item, or split an amount",
    description: "Scan or type the items so everyone pays for what they took, or enter one total to divide.", Component: VariantC },
];

export const entryVariantKeys = entryVariants.map((v) => v.key);
