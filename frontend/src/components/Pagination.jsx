import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';

/** Client-side paging over an already-loaded list. Resets to page 1 when the list changes. */
export function usePagination(items, pageSize = 15) {
  const [page, setPage] = useState(1);
  const total = items ? items.length : 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => { setPage(1); }, [items]);

  const pageItems = useMemo(
    () => (items ? items.slice((page - 1) * pageSize, page * pageSize) : []),
    [items, page, pageSize],
  );
  return { page: Math.min(page, pageCount), setPage, pageCount, pageItems, total, pageSize };
}

export default function Pagination({ page, pageCount, setPage, total, pageSize }) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pages = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination-info">{from}–{to} of {total.toLocaleString('en-IN')}</span>
      <div className="pagination-pages">
        <button type="button" className="icon-btn" aria-label="Previous page" disabled={page === 1}
          onClick={() => setPage(page - 1)}>
          <Icon name="chevronLeft" size={16} />
        </button>
        {pages.map((p, i) => (p === '…'
          ? <span key={`gap-${i}`} className="pagination-gap">…</span>
          : (
            <button key={p} type="button" className={`page-btn ${p === page ? 'active' : ''}`}
              aria-current={p === page ? 'page' : undefined} onClick={() => setPage(p)}>
              {p}
            </button>
          )))}
        <button type="button" className="icon-btn" aria-label="Next page" disabled={page === pageCount}
          onClick={() => setPage(page + 1)}>
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
    </nav>
  );
}
