const OUTCOME = {
  AUTO_APPROVE: ['✓ Within policy', 'b-green'],
  ROUTE: ['⚠ Needs approval', 'b-amber'],
  AUTO_REJECT: ['✕ Auto-rejected', 'b-red'],
};

export function OutcomeBadge({ outcome }) {
  if (!outcome) return <span className="badge b-grey">Not evaluated</span>;
  const [label, cls] = OUTCOME[outcome] || [outcome, 'b-grey'];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function ViolationList({ violations }) {
  if (!violations || violations.length === 0) return null;
  return (
    <ul className="violations">
      {violations.map((v, i) => (
        <li key={`${v.ruleCode}-${i}`}>
          <span className={`badge ${v.outcome === 'AUTO_REJECT' ? 'b-red' : 'b-amber'}`}>{v.ruleCode}</span>
          <span>{v.message}</span>
        </li>
      ))}
    </ul>
  );
}
