import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { statusLabel } from '../components/StatusBadge.jsx';
import { formatMoney, formatMoneyCompact } from '../components/Money.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

const CATEGORY_LABEL = { MEAL: 'Meal', HOTEL: 'Hotel', LOCAL_CAB: 'Local cab', TRAVEL: 'Travel', OTHER: 'Other' };

/** Recharts takes colours as SVG attributes, which can't read CSS variables, so resolve them (and follow dark mode). */
function useChartColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (name) => s.getPropertyValue(name).trim();
    return { bar: v('--chart-1'), grid: v('--grid'), text: v('--text-2'), cursor: v('--surface-2') };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setColors(read());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return colors;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

function hoursText(h) {
  if (h === null || h === undefined) return '—';
  if (h >= 48) return `${(h / 24).toFixed(1)} days`;
  return `${h.toFixed(1)} h`;
}

function ChartTip({ active, payload, isMoney }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div className="chart-tip">
      <strong>{p.payload.name}</strong>
      {isMoney ? formatMoney(p.value) : `${p.value.toLocaleString('en-IN')} hits`}
    </div>
  );
}

/** One horizontal or vertical single-series bar chart, plus a table view for accessibility. */
function BarCard({ title, subtitle, data, isMoney, horizontal, colors }) {
  const height = horizontal ? Math.max(180, data.length * 34 + 40) : 260;
  const fmt = isMoney ? formatMoneyCompact : (v) => v.toLocaleString('en-IN');
  return (
    <section className="card">
      <h2>{title}</h2>
      {subtitle && <p className="small muted" style={{ marginTop: -6 }}>{subtitle}</p>}
      {data.length === 0 ? <p className="muted">No data yet.</p> : (
        <>
          <div style={{ width: '100%', height }}>
            <ResponsiveContainer>
              {horizontal ? (
                <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke={colors.grid} />
                  <XAxis type="number" tickFormatter={fmt} tick={{ fill: colors.text, fontSize: 12 }}
                    axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fill: colors.text, fontSize: 12 }}
                    axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip isMoney={isMoney} />} cursor={{ fill: colors.cursor }} />
                  <Bar dataKey="value" fill={colors.bar} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              ) : (
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }} barCategoryGap={3}>
                  <CartesianGrid vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="name" tick={{ fill: colors.text, fontSize: 12 }} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmt} width={64} tick={{ fill: colors.text, fontSize: 12 }}
                    axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip isMoney={isMoney} />} cursor={{ fill: colors.cursor }} />
                  <Bar dataKey="value" fill={colors.bar} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          <details className="small">
            <summary>Show table</summary>
            <table>
              <tbody>
                {data.map((d) => (
                  <tr key={d.name}><td>{d.name}</td><td className="num">{isMoney ? formatMoney(d.value) : d.value}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const { user, hasRole } = useAuth();
  const colors = useChartColors();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    apiGet('/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!data) return <Loading />;

  const amounts = (list, labelFn = (l) => l) => list.map((d) => ({ name: labelFn(d.label), value: Number(d.amount) }));
  const byMonth = amounts(data.spendByMonth, monthLabel);
  const byCategory = amounts(data.spendByCategory, (l) => CATEGORY_LABEL[l] || l);
  const byDepartment = amounts(data.spendByDepartment);
  const violations = data.violationsByRule.map((d) => ({ name: d.label, value: d.count }));
  const totalSpend = byMonth.reduce((s, d) => s + d.value, 0);
  const totalPending = data.pendingByStatus.reduce((s, d) => s + d.count, 0);
  const scope = hasRole('MANAGER') ? `${user.departmentName || 'your'} department` : 'all departments';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted small">Approved and paid spend over the last 12 months · {scope}</p>
        </div>
        <button type="button" onClick={load}>Refresh</button>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Spend, last 12 months</div>
          <div className="tile-value">{formatMoneyCompact(totalSpend)}</div>
          <div className="tile-sub">{formatMoney(totalSpend)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Avg approval time</div>
          <div className="tile-value">{hoursText(data.avgApprovalHours)}</div>
          <div className="tile-sub">Submit → final decision, manual approvals</div>
        </div>
        <div className="tile">
          <div className="tile-label">Pending claims</div>
          <div className="tile-value">{totalPending.toLocaleString('en-IN')}</div>
          <div className="tile-sub">
            {data.pendingByStatus.map((p) => `${statusLabel(p.label).replace('Pending · ', '')}: ${p.count}`).join(' · ')}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Oldest pending</div>
          <div className="tile-value">{hoursText(data.oldestPendingHours)}</div>
          <div className="tile-sub">Waiting since submission</div>
        </div>
      </div>

      <BarCard title="Spend by month" data={byMonth} isMoney colors={colors} />
      <div className="charts" style={{ marginTop: 16 }}>
        <BarCard title="Spend by category" data={byCategory} isMoney horizontal colors={colors} />
        <BarCard title="Spend by department" data={byDepartment} isMoney horizontal colors={colors} />
      </div>
      <div style={{ marginTop: 16 }}>
        <BarCard title="Policy violations by rule" subtitle="Rule hits recorded by the policy engine"
          data={violations} horizontal colors={colors} />
      </div>
    </>
  );
}
