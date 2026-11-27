import Icon from './Icon.jsx';

/** Shared loading / error / empty states used by every page. */
export function Loading({ variant = 'table', rows = 6, bare = false }) {
  if (variant === 'cards') {
    return (
      <div className="kpi-grid" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card kpi-card">
            <div className="skeleton skeleton-text" style={{ width: '45%' }} />
            <div className="skeleton skeleton-title" style={{ width: '70%' }} />
            <div className="skeleton skeleton-text" style={{ width: '55%' }} />
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'detail') {
    return (
      <div aria-busy="true" aria-label="Loading">
        <div className="skeleton skeleton-title" style={{ width: '40%', marginBottom: 16 }} />
        <div className="card"><SkeletonLines rows={3} /></div>
        <div className="card"><SkeletonLines rows={5} /></div>
      </div>
    );
  }
  return (
    <div className={bare ? '' : 'card card-flush'} aria-busy="true" aria-label="Loading">
      <div className="skeleton-table">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton-row">
            <div className="skeleton skeleton-text" style={{ width: '14%' }} />
            <div className="skeleton skeleton-text" style={{ width: '34%' }} />
            <div className="skeleton skeleton-pill" />
            <div className="skeleton skeleton-text" style={{ width: '12%', marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonLines({ rows = 3 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <div key={i} className="skeleton skeleton-text" style={{ width: `${90 - i * 12}%`, marginBottom: 10 }} />
  ));
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="xCircle" size={18} />
      <span className="alert-body">{error}</span>
      {onRetry && (
        <button type="button" className="btn-sm" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
