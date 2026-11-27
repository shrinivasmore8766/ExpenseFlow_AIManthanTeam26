import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { apiGet } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import StatusBadge, { statusLabel, statusTone } from '../components/StatusBadge.jsx';
import Money, { formatDate, formatMoney, formatMoneyCompact } from '../components/Money.jsx';
import Icon from '../components/Icon.jsx';
import StatCard from '../components/StatCard.jsx';
import { initials } from '../components/Layout.jsx';
import { EmptyState, ErrorBanner, Loading } from '../components/PageState.jsx';

// Single-series charts use one accent hue; text and grid stay neutral.
const C = { bar: '#2563eb', grid: '#edf0f5', text: '#64748b', cursor: '#f1f5fb' };
const CATEGORY = {
  HOTEL: ['Hotel', '🏨'], TRAVEL: ['Travel', '✈️'], MEAL: ['Meal', '🍽️'], LOCAL_CAB: ['Local cab', '🚕'], OTHER: ['Other', '📦'],
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
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

function ChartTip({ active, payload, isMoney = true }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div className="chart-tip">
      <strong>{p.payload.name}</strong>
      {isMoney ? formatMoney(p.value) : `${Number(p.value).toLocaleString('en-IN')} rule hits`}
    </div>
  );
}

function TrendChart({ data, height = 260 }) {
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.bar} stopOpacity={0.18} />
              <stop offset="100%" stopColor={C.bar} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="name" tick={{ fill: C.text, fontSize: 12 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tickFormatter={formatMoneyCompact} width={64} tick={{ fill: C.text, fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip />} cursor={{ stroke: C.text, strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey="value" stroke={C.bar} strokeWidth={2} fill="url(#trendFill)"
            dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff', fill: C.bar }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function HBarChart({ data, isMoney = true, labelWidth = 120 }) {
  const height = Math.max(160, data.length * 34 + 30);
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={C.grid} />
          <XAxis type="number" tickFormatter={isMoney ? formatMoneyCompact : (v) => v.toLocaleString('en-IN')}
            tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={labelWidth} tick={{ fill: C.text, fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip isMoney={isMoney} />} cursor={{ fill: C.cursor }} />
          <Bar dataKey="value" fill={C.bar} radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DataTable({ data, isMoney = true }) {
  return (
    <details className="chart-table">
      <summary>View as table</summary>
      <table>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}><td>{d.name}</td><td className="num">{isMoney ? formatMoney(d.value) : d.value.toLocaleString('en-IN')}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Breakdown({ rows, total, isMoney = true }) {
  return (
    <div className="breakdown">
      {rows.map((r) => {
        const pct = total > 0 ? (r.value / total) * 100 : 0;
        return (
          <div key={r.key || r.name} className="breakdown-row">
            <span className="label">{r.icon && <span aria-hidden="true">{r.icon}</span>}{r.badge || r.name}</span>
            <span className="value">
              {isMoney ? formatMoney(r.value) : r.value.toLocaleString('en-IN')}
              <span className="muted small"> · {pct.toFixed(0)}%</span>
            </span>
            <div className={`meter ${r.tone ? `tone-${r.tone}` : ''}`}><span style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function ClaimRows({ claims, showEmployee }) {
  return (
    <ul className="list-rows">
      {claims.map((c) => (
        <li key={c.id}>
          {showEmployee
            ? <span className="avatar">{initials(c.employeeName)}</span>
            : <span className={`kpi-icon tone-${statusTone(c.status)}`}><Icon name="receipt" size={16} /></span>}
          <div className="grow">
            <Link to={`/claims/${c.id}`} className="title" style={{ display: 'block' }}>
              {showEmployee ? c.employeeName : c.title}
            </Link>
            <div className="cell-sub">{c.claimNumber} · {showEmployee ? c.title : formatDate(c.submittedAt)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="strong"><Money value={showEmployee ? c.approvedAmount : c.totalAmount} /></div>
            <StatusBadge status={c.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Employee: personal dashboard from own claims ---------------- */
function EmployeeDashboard({ user }) {
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    apiGet('/claims').then(setClaims).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const stats = useMemo(() => {
    if (!claims) return null;
    const sum = (list, f) => list.reduce((s, c) => s + Number(c[f] || 0), 0);
    const by = (pred) => claims.filter((c) => pred(c.status));
    const pending = by((s) => s.startsWith('PENDING_'));
    const approved = by((s) => s === 'APPROVED');
    const paid = by((s) => s === 'PAID');
    const drafts = by((s) => s === 'DRAFT' || s === 'CLARIFICATION_REQUESTED');
    const submitted = claims.filter((c) => c.status !== 'DRAFT');

    // Claimed amount per month over the last 12 months (by submission date).
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, value: 0 });
    }
    submitted.forEach((c) => {
      if (!c.submittedAt) return;
      const m = months.find((x) => x.key === c.submittedAt.slice(0, 7));
      if (m) m.value += Number(c.totalAmount || 0);
    });

    const statusOrder = ['DRAFT', 'CLARIFICATION_REQUESTED', 'PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD', 'APPROVED', 'PAID', 'REJECTED'];
    const byStatus = statusOrder
      .map((s) => ({ key: s, name: statusLabel(s), badge: <StatusBadge status={s} />, value: claims.filter((c) => c.status === s).length, tone: statusTone(s) }))
      .filter((r) => r.value > 0);

    return {
      pending, approved, paid, drafts, byStatus,
      claimedTotal: sum(submitted, 'totalAmount'),
      pendingTotal: sum(pending, 'totalAmount'),
      approvedTotal: sum(approved, 'approvedAmount'),
      paidTotal: sum(paid, 'approvedAmount'),
      trend: months.map((m) => ({ name: monthLabel(m.key), value: m.value })),
    };
  }, [claims]);

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!stats) return <Loading variant="cards" />;

  return (
    <>
      <div className="welcome">
        <div>
          <h1>{greeting()}, {user.fullName.split(' ')[0]}</h1>
          <p>
            {stats.drafts.length
              ? `You have ${stats.drafts.length} claim(s) that need your attention.`
              : stats.pending.length ? `${stats.pending.length} claim(s) are moving through approval.` : 'All your claims are up to date.'}
          </p>
        </div>
        <div className="actions">
          <Link to="/claims" className="btn">View my claims</Link>
          <Link to="/claims/new" className="btn btn-primary"><Icon name="plus" size={16} /> New claim</Link>
        </div>
      </div>

      <div className="kpi-grid">
        <StatCard label="Total claimed" icon="receipt" tone="accent" value={formatMoneyCompact(stats.claimedTotal)}
          sub={`${claims.length} claim(s) all time`} />
        <StatCard label="In review" icon="clock" tone="warning" value={stats.pending.length}
          sub={formatMoney(stats.pendingTotal)} />
        <StatCard label="Approved · awaiting payout" icon="checkCircle" tone="success" value={formatMoneyCompact(stats.approvedTotal)}
          sub={`${stats.approved.length} claim(s)`} />
        <StatCard label="Reimbursed" icon="bank" tone="paid" value={formatMoneyCompact(stats.paidTotal)}
          sub={`${stats.paid.length} claim(s) paid`} />
      </div>

      {claims.length === 0 ? (
        <div className="card">
          <EmptyState icon="receipt" title="No claims yet"
            action={<Link to="/claims/new" className="btn btn-primary"><Icon name="plus" size={16} /> Create your first claim</Link>}>
            Your spending trend and claim status will appear here once you submit claims.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="dash-grid dash-grid-2-1">
            <section className="card">
              <div className="card-head"><div><h2>Claimed per month</h2><p>Total of claims you submitted, last 12 months.</p></div></div>
              <TrendChart data={stats.trend} />
              <DataTable data={stats.trend} />
            </section>
            <section className="card">
              <div className="card-head"><div><h2>Claims by status</h2><p>Where your claims are right now.</p></div></div>
              <Breakdown rows={stats.byStatus} total={claims.length} isMoney={false} />
            </section>
          </div>
          <div className="dash-grid dash-grid-1-1">
            <section className="card">
              <div className="card-head">
                <div><h2>Recent claims</h2><p>Your latest activity.</p></div>
                <Link to="/claims" className="btn btn-sm">View all <Icon name="arrowRight" size={14} /></Link>
              </div>
              <ClaimRows claims={claims.slice(0, 6)} />
            </section>
            <section className="card">
              <div className="card-head"><div><h2>Needs your attention</h2><p>Drafts and claims sent back to you.</p></div></div>
              {stats.drafts.length === 0
                ? <EmptyState icon="checkCircle" title="Nothing to do">No drafts or clarification requests.</EmptyState>
                : <ClaimRows claims={stats.drafts.slice(0, 6)} />}
            </section>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- Approvers: analytics + queue (+ payouts for Finance Head) ---------------- */
function ApproverDashboard({ user, hasRole }) {
  const isFH = hasRole('FINANCE_HEAD');
  const [data, setData] = useState(null);
  const [queue, setQueue] = useState(null);
  const [batches, setBatches] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    Promise.all([
      apiGet('/dashboard'),
      apiGet('/approvals'),
      isFH ? apiGet('/payouts') : Promise.resolve(null),
    ])
      .then(([d, q, b]) => { setData(d); setQueue(q); setBatches(b); })
      .catch((e) => setError(e.message));
  }, [isFH]);
  useEffect(load, [load]);

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!data) return <Loading variant="cards" />;

  const toRows = (list, labelFn = (l) => l) => list.map((d) => ({ name: labelFn(d.label), value: Number(d.amount) }));
  const trend = toRows(data.spendByMonth, monthLabel);
  const byDepartment = toRows(data.spendByDepartment);
  const categoryTotal = data.spendByCategory.reduce((s, d) => s + Number(d.amount), 0);
  const categoryRows = data.spendByCategory.map((d) => ({
    key: d.label, name: CATEGORY[d.label]?.[0] || d.label, icon: CATEGORY[d.label]?.[1], value: Number(d.amount),
  }));
  const violations = data.violationsByRule.map((d) => ({ name: d.label, value: d.count }));
  const totalSpend = trend.reduce((s, d) => s + d.value, 0);
  const totalPending = data.pendingByStatus.reduce((s, d) => s + d.count, 0);
  const pipelineRows = data.pendingByStatus.map((p) => ({
    key: p.label, name: statusLabel(p.label), badge: <StatusBadge status={p.label} />, value: p.count, tone: 'warning',
  }));
  const lastMonth = trend.length > 1 ? trend[trend.length - 2].value : null;
  const paidBatches = (batches || []).filter((b) => b.status === 'PAID');
  const reimbursed = paidBatches.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
  const isManager = hasRole('MANAGER');
  const scope = isManager ? `${user.departmentName || 'Your'} department` : 'All departments';
  const scopeSentence = isManager ? `the ${user.departmentName || 'your'} department` : 'all departments';
  const oldestTone = data.oldestPendingHours > 48 ? 'danger' : 'neutral';

  return (
    <>
      <div className="welcome">
        <div>
          <h1>{greeting()}, {user.fullName.split(' ')[0]}</h1>
          <p>
            {queue.length
              ? `${queue.length} claim(s) are waiting for your decision.`
              : 'Your approval queue is clear.'}
            {' '}Showing {scopeSentence} · approved and paid spend, last 12 months.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={load}><Icon name="refresh" size={16} /> Refresh</button>
          <Link to="/approvals" className="btn btn-primary"><Icon name="inbox" size={16} /> Review queue</Link>
        </div>
      </div>

      <div className="kpi-grid">
        <StatCard label="Total spend · 12 months" icon="trending" tone="accent" value={formatMoneyCompact(totalSpend)}
          sub={lastMonth !== null ? `${formatMoneyCompact(lastMonth)} last full month` : formatMoney(totalSpend)} />
        <StatCard label="Pending approvals" icon="inbox" tone="warning" value={totalPending.toLocaleString('en-IN')}
          sub={`${queue.length} waiting for you`} />
        <StatCard label="Avg approval time" icon="clock" tone="info" value={hoursText(data.avgApprovalHours)}
          sub="Submit → decision, manual approvals" />
        <StatCard label="Oldest pending" icon="alert" tone={oldestTone} value={hoursText(data.oldestPendingHours)}
          sub={data.oldestPendingHours > 48 ? 'Over the 48-hour target' : 'Within target'} />
        {isFH && (
          <StatCard label="Reimbursed" icon="bank" tone="paid" value={formatMoneyCompact(reimbursed)}
            sub={`${paidBatches.length} paid payout batch(es)`} />
        )}
      </div>

      <div className="dash-grid dash-grid-2-1">
        <section className="card">
          <div className="card-head"><div><h2>Monthly spending trend</h2><p>Approved and paid spend by month of submission.</p></div></div>
          {trend.length ? <><TrendChart data={trend} /><DataTable data={trend} /></> : <EmptyState icon="trending" title="No spend yet" />}
        </section>
        <section className="card">
          <div className="card-head"><div><h2>Approval pipeline</h2><p>{totalPending} claim(s) in flight.</p></div></div>
          <Breakdown rows={pipelineRows} total={totalPending} isMoney={false} />
          <div className="summary-total" style={{ marginTop: 18 }}>
            <span className="muted">Average approval</span><strong style={{ fontSize: '1.05rem' }}>{hoursText(data.avgApprovalHours)}</strong>
          </div>
        </section>
      </div>

      <div className="dash-grid dash-grid-1-1">
        <section className="card">
          <div className="card-head"><div><h2>Spend by category</h2><p>Share of approved spend.</p></div></div>
          {categoryRows.length ? <Breakdown rows={categoryRows} total={categoryTotal} /> : <EmptyState icon="receipt" title="No spend yet" />}
        </section>
        <section className="card">
          <div className="card-head"><div><h2>Spend by department</h2><p>{scope}.</p></div></div>
          {byDepartment.length ? <><HBarChart data={byDepartment} /><DataTable data={byDepartment} /></> : <EmptyState icon="users" title="No spend yet" />}
        </section>
      </div>

      <div className="dash-grid dash-grid-1-1">
        <section className="card">
          <div className="card-head">
            <div><h2>Awaiting your action</h2><p>Oldest first.</p></div>
            <Link to="/approvals" className="btn btn-sm">Open queue <Icon name="arrowRight" size={14} /></Link>
          </div>
          {queue.length === 0
            ? <EmptyState icon="checkCircle" title="You are all caught up">No claims are waiting for you.</EmptyState>
            : <ClaimRows claims={queue.slice(0, 6)} showEmployee />}
        </section>
        <section className="card">
          <div className="card-head"><div><h2>Policy violations by rule</h2><p>Rule hits recorded by the policy engine.</p></div></div>
          {violations.length
            ? <><HBarChart data={violations} isMoney={false} labelWidth={150} /><DataTable data={violations} isMoney={false} /></>
            : <EmptyState icon="shield" title="No violations recorded" />}
        </section>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { user, hasRole } = useAuth();
  if (hasRole('MANAGER', 'FINANCE_AUDITOR', 'FINANCE_HEAD')) return <ApproverDashboard user={user} hasRole={hasRole} />;
  return <EmployeeDashboard user={user} />;
}
