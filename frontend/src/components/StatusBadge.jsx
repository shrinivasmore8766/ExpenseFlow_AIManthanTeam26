const STATUS = {
  DRAFT: ['Draft', 'neutral'],
  PENDING_MANAGER: ['Pending · Manager', 'warning'],
  PENDING_AUDITOR: ['Pending · Auditor', 'warning'],
  PENDING_FINANCE_HEAD: ['Pending · Finance Head', 'warning'],
  CLARIFICATION_REQUESTED: ['Clarification requested', 'info'],
  APPROVED: ['Approved', 'success'],
  REJECTED: ['Rejected', 'danger'],
  PAID: ['Paid', 'paid'],
  EXPORTED: ['Exported', 'warning'],
};

export function statusLabel(status) {
  return STATUS[status]?.[0] || status;
}

export function statusTone(status) {
  return STATUS[status]?.[1] || 'neutral';
}

export default function StatusBadge({ status }) {
  const [label, tone] = STATUS[status] || [status, 'neutral'];
  return <span className={`badge badge-${tone} badge-dot`}>{label}</span>;
}
