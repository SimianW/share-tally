
export function LoadingFinancials({ label }: { label: string }) {
  return <div className="financial-skeleton" role="status" aria-label={label}>
    <div /><div /><div />
  </div>;
}
