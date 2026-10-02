import { useId, useState } from "react";
import { Pencil } from "lucide-react";
import { money } from "../../money";
import { type Bill } from "@share-tally/domain/contracts/bills";
import { cost, zero } from "../../fractions";
import { fraction, type Fraction } from '@share-tally/domain/fractions';
import { amountChoices, parseCents, portionText, pressedChoice } from "./amount-portion";
import { amountText } from "../../money";
import { PortionCard, PortionChoices } from "./PortionPicker";

type Participant = Bill["participants"][number];

/**
 * A By amount share input: the YOUR SHARE card, whose figure is the amount field, and the
 * portion choices that fill it in. Shares over the total only warn; a share over the total
 * itself is an error.
 */
export function AmountPortion({ totalCents, count, others, amount, setAmount, custom, setCustom, onPick, inputId, required = false, readOnly = false, busy = false }: {
  /** Null or zero until the total paid is entered. */
  totalCents: number | null;
  /** Everyone on the bill, which sets N in Even · 1/N. */
  count: number;
  /** Every other participant and their submitted amount, or null if they have not submitted. */
  others: { person: Participant; cents: number | null }[];
  /** The amount as typed. */
  amount: string;
  setAmount: (amount: string) => void;
  /** The Custom fraction last used, remembered while the form is open, as on a By item bill. */
  custom: Fraction | null;
  setCustom: (custom: Fraction) => void;
  /** Called after a choice fills in the amount, with the portion it was. */
  onPick?: (portion: Fraction) => void;
  inputId?: string;
  required?: boolean;
  readOnly?: boolean;
  busy?: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const captionId = useId();
  const total = totalCents && totalCents > 0 ? totalCents : null;
  const mine = parseCents(amount);
  const invalid = !!amount.trim() && mine === null;
  const choices = amountChoices(count);
  const pressed = pressedChoice(choices, total, mine, custom);
  const othersCents = others.reduce((sum, other) => sum + (other.cents ?? 0), 0);
  const tooMuch = total !== null && mine !== null && mine > total;
  const over = total === null ? 0 : othersCents + (mine ?? 0) - total;
  const left = total === null ? 0 : total - othersCents;
  const portion = (cents: number) => total === null ? null : fraction(BigInt(cents), BigInt(total));
  const takeLeft = total !== null && others.some((other) => other.cents !== null) && left > 0 && left !== mine
    ? { fraction: portion(left)!, label: `Take the ${money(left)} left` } : null;
  const caption = total === null ? "No total paid yet"
    : mine === null ? `Pick a portion of ${money(total)} or type an amount`
      : pressed ? `${portionText(pressed.fraction)} of ${money(total)}` : `of ${money(total)} total`;
  const figure = <label className="amount-figure" data-invalid={invalid || tooMuch || undefined}>
    <span className="amount-figure-currency" aria-hidden="true">$</span>
    <input id={inputId} className="amount-figure-input" aria-label="Your share (CAD)" aria-describedby={captionId}
      aria-invalid={invalid || tooMuch} inputMode="decimal" autoComplete="off" placeholder="0.00" required={required}
      value={amount} disabled={busy} readOnly={readOnly} onChange={(event) => setAmount(event.target.value)}
      onBlur={() => { if (mine !== null && !readOnly) setAmount(amountText(mine)); }} />
    <Pencil className="amount-figure-edit" size={18} aria-hidden="true" />
  </label>;
  return <div className="claim-options amount-portion">
    <PortionCard measure="money" totalCents={total} label="YOUR SHARE" figure={figure} caption={caption} captionId={captionId}
      others={others.map(({ person, cents }) => ({ person, fraction: cents === null ? null : portion(cents) }))}
      taken={portion(othersCents) ?? zero} mine={mine === null ? null : portion(mine)}
      tone={tooMuch ? "over" : over > 0 ? "warn" : null}>
      {tooMuch ? <p className="claim-over-text" role="alert">Your share can't be more than the total paid.</p>
        : over > 0 && <p className="claim-warn-text" role="status">
          Shares are {money(over)} over the total. The bill can't complete until someone lowers theirs.
        </p>}
      {invalid && <p className="claim-over-text" role="alert">Enter a valid CAD amount, with at most two decimals.</p>}
    </PortionCard>
    <PortionChoices label="Your share" totalCents={total} choices={choices} pressed={pressed?.key ?? null}
      custom={custom} customStart={custom ? `${custom.n}/${custom.d}` : ""} customOpen={customOpen} setCustomOpen={setCustomOpen}
      cap={null} disabled={total === null || readOnly || busy} takeLeft={takeLeft}
      onPick={(value, isCustom) => {
        if (total === null) return;
        if (isCustom) setCustom(value);
        setAmount(amountText(cost(total, value)));
        onPick?.(value);
      }} />
    {total === null && <p className="amount-portion-hint">Enter the total paid to pick a portion</p>}
  </div>;
}
