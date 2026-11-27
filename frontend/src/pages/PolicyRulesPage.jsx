import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Money from '../components/Money.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

export default function PolicyRulesPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('FINANCE_HEAD');
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // { id, limitAmount, active }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiGet('/policy-rules')
      .then((r) => setRules([...r].sort((a, b) => a.code.localeCompare(b.code))))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiPut(`/policy-rules/${editing.id}`, {
        limitAmount: editing.limitAmount === '' ? null : String(editing.limitAmount),
        active: editing.active,
      });
      setRules((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      setNotice(`${updated.code} updated. New submissions use the new value.`);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Policy rules</h1>
          <p className="muted small">
            Limits live in the database, not in code.{canEdit ? ' As Finance Head you can change them.' : ''}
          </p>
        </div>
      </div>
      <ErrorBanner error={error} onRetry={rules ? null : load} />
      {notice && <div className="banner banner-success" role="status">{notice}</div>}
      {!rules && !error && <Loading />}
      {rules && (
        <form onSubmit={save}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rule</th><th>Category</th><th>Description</th><th className="num">Limit</th><th>Active</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const isEditing = editing?.id === r.id;
                  return (
                    <tr key={r.id}>
                      <td className="nowrap"><code>{r.code}</code></td>
                      <td>{r.category || 'All'}</td>
                      <td>{r.description}</td>
                      <td className="num">
                        {isEditing && r.limitAmount != null ? (
                          <input type="number" inputMode="decimal" min="0" step="0.01" required aria-label="Limit amount"
                            style={{ width: 130 }} value={editing.limitAmount}
                            onChange={(e) => setEditing({ ...editing, limitAmount: e.target.value })} />
                        ) : (r.limitAmount != null ? <Money value={r.limitAmount} /> : '—')}
                      </td>
                      <td>
                        {isEditing ? (
                          <input type="checkbox" aria-label="Active" checked={editing.active}
                            onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                        ) : (r.active ? <span className="badge b-green">Active</span> : <span className="badge b-grey">Off</span>)}
                      </td>
                      {canEdit && (
                        <td>
                          {isEditing ? (
                            <div className="actions" style={{ flexWrap: 'nowrap' }}>
                              <button type="submit" className="btn-small btn-primary" disabled={busy}>Save</button>
                              <button type="button" className="btn-small" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                            </div>
                          ) : (
                            <button type="button" className="btn-small" disabled={busy || editing !== null}
                              onClick={() => setEditing({ id: r.id, limitAmount: r.limitAmount ?? '', active: r.active })}>
                              Edit
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}
    </>
  );
}
