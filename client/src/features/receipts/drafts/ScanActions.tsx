import { Button } from "../../../shared/ui/Button";

export function ScanActions({
  hasItems,
  replace,
  setReplace,
  scan,
  disabled,
}: {
  hasItems: boolean;
  replace: boolean;
  setReplace: (value: boolean) => void;
  scan: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="receipt-scan-actions">
      {hasItems && !replace ? (
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => setReplace(true)}
        >
          Scan and replace current items…
        </Button>
      ) : (
        <Button variant="secondary" disabled={disabled} onClick={scan}>
          {replace ? "Replace current items with a new scan" : "Read receipt"}
        </Button>
      )}
      {replace && (
        <Button variant="secondary" onClick={() => setReplace(false)}>
          Keep current items
        </Button>
      )}
    </div>
  );
}
