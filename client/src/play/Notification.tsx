import { type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import './notification.css';

const styles = {
  warning: { icon: AlertTriangle, label: 'Action needed' },
  error: { icon: CircleAlert, label: 'Something went wrong' },
  success: { icon: CheckCircle2, label: 'Saved' },
  info: { icon: Info, label: 'Please note' },
};

export function Notification({ tone = 'error', title, children, onDismiss }: {
  tone?: keyof typeof styles;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const { icon: StatusIcon, label } = styles[tone];
  return <div className={`notification notification-${tone}`} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
    <StatusIcon className="notification-icon" size={22} aria-hidden="true" />
    <div className="notification-content">
      <strong className="notification-title">{title || label}</strong>
      <div className="notification-body">{children}</div>
    </div>
    {onDismiss && <button className="notification-dismiss" type="button" aria-label="Dismiss notification" onClick={onDismiss}><X size={18} aria-hidden="true" /></button>}
  </div>;
}
