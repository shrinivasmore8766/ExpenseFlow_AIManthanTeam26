const STATUS = {
  DRAFT: ['Draft', 'b-grey'],
  PENDING_MANAGER: ['Pending · Manager', 'b-amber'],
  PENDING_AUDITOR: ['Pending · Auditor', 'b-amber'],
  PENDING_FINANCE_HEAD: ['Pending · Finance Head', 'b-amber'],
  CLARIFICATION_REQUESTED: ['Clarification requested', 'b-blue'],
  APPROVED: ['Approved', 'b-green'],
  REJECTED: ['Rejected', 'b-red'],
  PAID: ['Paid', 'b-dkgreen'],
  EXPORTED: ['Exported', 'b-amber'],
};

export function statusLabel(status) {
  return STATUS[status]?.[0] || status;
}

export default function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, 'b-grey'];
  return <span className={`badge ${cls}`}>{label}</span>;
}
