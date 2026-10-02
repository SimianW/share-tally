
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {!compact && (
        <span>
          share<span className="brand-light">tally</span>
          <span className="brand-period">.</span>
        </span>
      )}
    </span>
  );
}
