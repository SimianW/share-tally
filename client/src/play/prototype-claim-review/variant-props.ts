// PROTOTYPE — throwaway.
import type { Dispatch } from "react";
import type { Action, State } from "./model";

export type VariantProps = { state: State; dispatch: Dispatch<Action>; busy: boolean; confirm: () => void };
