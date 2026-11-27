const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const inrCompact = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1,
});

export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  return inr.format(Number(value));
}

export function formatMoneyCompact(value) {
  return inrCompact.format(Number(value || 0));
}

export function formatDate(value) {
  if (!value) return '—';
  // LocalDate strings ("2026-11-20") are parsed as local dates to avoid a timezone shift.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function Money({ value }) {
  return <span className="num">{formatMoney(value)}</span>;
}
