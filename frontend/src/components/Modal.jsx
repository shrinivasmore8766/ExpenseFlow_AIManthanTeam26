import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

/** Accessible modal dialog: Escape and backdrop click close it, focus moves into it. */
export default function Modal({ open, title, onClose, children, footer, size = 'md', busy = false }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    const focusable = panelRef.current?.querySelector('textarea, input, select, button.btn-primary, button.btn-danger');
    (focusable || panelRef.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      previous?.focus?.();
    };
  }, [open, onClose, busy]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"
        ref={panelRef} tabIndex={-1}>
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
