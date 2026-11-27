import StatusBadge from './StatusBadge.jsx';
import { formatDateTime } from './Money.jsx';

const ACTION_LABELS = {
  SUBMIT: 'Submitted',
  RESUBMIT: 'Resubmitted',
  POLICY_DECISION: 'Policy check',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  SEND_BACK: 'Sent back for clarification',
  BULK_APPROVE: 'Bulk approved',
  PAID: 'Paid',
};

export default function HistoryTimeline({ history }) {
  if (!history || history.length === 0) return <p className="muted">No activity yet.</p>;
  return (
    <ol className="timeline">
      {history.map((h, i) => (
        <li key={i}>
          <div>
            <strong>{ACTION_LABELS[h.action] || h.action}</strong>{' '}
            <span className="muted">by {h.actorName}</span>
            {h.onBehalfOfName && <span className="muted"> on behalf of {h.onBehalfOfName}</span>}
          </div>
          <div className="when">
            {formatDateTime(h.at)}
            {h.toStatus && h.fromStatus !== h.toStatus && (
              <> · <StatusBadge status={h.fromStatus} /> → <StatusBadge status={h.toStatus} /></>
            )}
          </div>
          {h.comment && <div className="comment">{h.comment}</div>}
        </li>
      ))}
    </ol>
  );
}
