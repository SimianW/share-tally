import { Icon } from './Icon';

export function SectionHeading({
  id,
  title,
  action,
  onAction,
  count,
}: {
  id?: string;
  title: string;
  action?: string;
  onAction?: () => void;
  count?: number;
}) {
  return (
    <div className="section-heading">
      <h2 id={id}>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {action && (
        <button className="text-action" onClick={onAction}>
          {action}
          <Icon name="arrow" size={16} />
        </button>
      )}
    </div>
  );
}
