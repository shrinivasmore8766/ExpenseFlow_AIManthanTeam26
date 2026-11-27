import Icon from './Icon.jsx';

/** KPI tile: label, headline value, supporting line, icon chip. */
export default function StatCard({ label, value, sub, icon, tone = 'accent' }) {
  return (
    <div className="card kpi-card">
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        {icon && <span className={`kpi-icon tone-${tone}`}><Icon name={icon} size={18} /></span>}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
