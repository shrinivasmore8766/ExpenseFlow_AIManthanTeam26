import StatusBadge from './StatusBadge.jsx';
import Icon from './Icon.jsx';
import { formatDateTime } from './Money.jsx';

const ACTIONS = {
  SUBMIT: ['Submitted', 'send', 'accent'],
  POLICY_DECISION: ['Policy check', 'sparkle', 'neutral'],
  APPROVE: ['Approved', 'check', 'success'],
  REJECT: ['Rejected', 'x', 'danger'],
  SEND_BACK: ['Sent back for clarification', 'rotate', 'info'],
  PAID: ['Paid', 'bank', 'success'],
};

export default function HistoryTimeline({ history }) {
  if (!history || history.length === 0) return <p className="muted">No activity yet.</p>;
  return (
    <ol className="timeline">
      {history.map((h, i) => {
        const [label, icon, tone] = ACTIONS[h.action] || [h.action, 'info', 'neutral'];
        return (
          <li key={i}>
            <span className={`timeline-dot tone-${tone}`}><Icon name={icon} size={13} /></span>
            <div className="timeline-content">
              <div className="timeline-head">
                <strong>{label}</strong>
                <span className="muted"> by {h.actorName}</span>
                {h.onBehalfOfName && <span className="muted"> on behalf of {h.onBehalfOfName}</span>}
              </div>
              <div className="timeline-meta">
                <span>{formatDateTime(h.at)}</span>
                {h.toStatus && h.fromStatus !== h.toStatus && (
                  <span className="timeline-transition">
                    <StatusBadge status={h.fromStatus} /> <Icon name="arrowRight" size={12} /> <StatusBadge status={h.toStatus} />
                  </span>
                )}
              </div>
              {h.comment && <div className="timeline-comment">{h.comment}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
