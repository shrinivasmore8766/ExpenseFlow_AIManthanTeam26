/** Shared loading / error states used by every page. */
export function Loading({ text = 'Loading…' }) {
  return <p className="page-state">{text}</p>;
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="banner banner-error" role="alert">
      <span className="banner-body">{error}</span>
      {onRetry && <button type="button" className="btn-small" onClick={onRetry}>Retry</button>}
    </div>
  );
}
