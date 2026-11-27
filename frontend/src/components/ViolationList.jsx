import Icon from './Icon.jsx';

const OUTCOME = {
  AUTO_APPROVE: ['Within policy', 'success', 'check'],
  ROUTE: ['Needs approval', 'warning', 'alert'],
  AUTO_REJECT: ['Auto-rejected', 'danger', 'xCircle'],
};

export function OutcomeBadge({ outcome }) {
  if (!outcome) return <span className="badge badge-neutral">Not evaluated</span>;
  const [label, tone, icon] = OUTCOME[outcome] || [outcome, 'neutral', 'info'];
  return <span className={`badge badge-${tone}`}><Icon name={icon} size={12} /> {label}</span>;
}

export default function ViolationList({ violations }) {
  if (!violations || violations.length === 0) return null;
  return (
    <ul className="violations">
      {violations.map((v, i) => (
        <li key={`${v.ruleCode}-${i}`} className={v.outcome === 'AUTO_REJECT' ? 'is-reject' : 'is-route'}>
          <Icon name={v.outcome === 'AUTO_REJECT' ? 'xCircle' : 'alert'} size={14} />
          <span><code>{v.ruleCode}</code> {v.message}</span>
        </li>
      ))}
    </ul>
  );
}
