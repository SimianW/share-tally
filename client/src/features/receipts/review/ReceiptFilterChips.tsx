export type ReceiptFilterOption<Id extends string> = {
  id: Id;
  label: string;
  count?: number;
};

export function ReceiptFilterChips<Id extends string>({ options, value, onChange, label = "Filter items" }: {
  options: readonly ReceiptFilterOption<Id>[];
  value: Id;
  onChange: (value: Id) => void;
  label?: string;
}) {
  return <div className="receipt-filter-chips" role="group" aria-label={label}>
    {options.map(({ id, label: text, count }) => <button key={id} type="button" className="receipt-filter-chip" aria-pressed={value === id} onClick={() => onChange(id)}>
      {text}{count !== undefined && ` (${count})`}
    </button>)}
  </div>;
}
