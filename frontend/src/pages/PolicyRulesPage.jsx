import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Money from '../components/Money.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/ToastContext.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

const CATEGORY = { MEAL: '🍽️ Meal', HOTEL: '🏨 Hotel', LOCAL_CAB: '🚕 Local cab', TRAVEL: '✈️ Travel', OTHER: '📦 Other' };

export default function PolicyRulesPage() {
  const { hasRole } = useAuth();
  const toast = useToast();
  const canEdit = hasRole('FINANCE_HEAD');
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { rule, limitAmount, active }
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiGet('/policy-rules')
      .then((r) => setRules([...r].sort((a, b) => a.code.localeCompare(b.code))))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  function openEdit(rule) {
    setEditing({ rule, limitAmount: rule.limitAmount ?? '', active: rule.active });
    setFormError(null);
  }

  async function save() {
    const hasLimit = editing.rule.limitAmount != null;
    if (hasLimit && (editing.limitAmount === '' || Number(editing.limitAmount) < 0)) {
      setFormError('Enter a limit of 0 or more.');
      return;
    }
    setBusy(true);
    try {
      const updated = await apiPut(`/policy-rules/${editing.rule.id}`, {
        limitAmount: hasLimit ? String(editing.limitAmount) : null,
        active: editing.active,
      });
      setRules((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      toast.success('New submissions use the new value.', `${updated.code} updated`);
      setEditing(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const activeCount = (rules || []).filter((r) => r.active).length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Governance</div>
          <h1>Policy rules</h1>
          <p>Limits live in the database, not in code.{canEdit ? ' As Finance Head you can change them.' : ''}</p>
        </div>
        {rules && <span className="badge badge-success badge-dot">{activeCount} of {rules.length} active</span>}
      </div>
      <ErrorBanner error={error} onRetry={rules ? null : load} />
      {!rules && !error && <Loading rows={9} />}
      {rules && (
        <div className="card card-flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rule</th><th className="hide-mobile">Applies to</th><th className="num">Limit</th><th>Status</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code>{r.code}</code>
                      <div className="cell-sub" style={{ marginTop: 6 }}>{r.description}</div>
                    </td>
                    <td className="hide-mobile nowrap">{r.category ? CATEGORY[r.category] || r.category : 'All lines'}</td>
                    <td className="num strong">{r.limitAmount != null ? <Money value={r.limitAmount} /> : <span className="muted">—</span>}</td>
                    <td>{r.active ? <span className="badge badge-success badge-dot">Active</span> : <span className="badge badge-neutral badge-dot">Off</span>}</td>
                    {canEdit && (
                      <td className="num">
                        <button type="button" className="btn-sm" onClick={() => openEdit(r)}><Icon name="edit" size={14} /> Edit</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        title={editing ? `Edit ${editing.rule.code}` : ''}
        onClose={() => setEditing(null)}
        busy={busy}
        footer={editing && (
          <>
            <button type="button" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={16} />} Save changes
            </button>
          </>
        )}
      >
        {editing && (
          <>
            <p className="muted">{editing.rule.description}</p>
            {editing.rule.limitAmount != null && (
              <div className={`field ${formError ? 'has-error' : ''}`}>
                <label htmlFor="rule-limit">Limit</label>
                <div className="input-prefix">
                  <span>₹</span>
                  <input id="rule-limit" type="number" inputMode="decimal" min="0" step="0.01" value={editing.limitAmount}
                    onChange={(e) => { setEditing({ ...editing, limitAmount: e.target.value }); setFormError(null); }} />
                </div>
              </div>
            )}
            <div className="field">
              <label className="check" htmlFor="rule-active">
                <input id="rule-active" type="checkbox" checked={editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                Rule is active
              </label>
            </div>
            {formError && <div className="field-error"><Icon name="alert" size={13} /> {formError}</div>}
            <div className="alert alert-info small" style={{ marginTop: 12, marginBottom: 0 }}>
              <Icon name="info" size={16} /><span className="alert-body">Changes apply to claims submitted from now on. The change is written to the audit log.</span>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
