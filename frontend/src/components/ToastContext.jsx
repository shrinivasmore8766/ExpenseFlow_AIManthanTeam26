import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const ToastContext = createContext(null);
const ICONS = { success: 'checkCircle', error: 'xCircle', info: 'info', warning: 'alert' };

/** Lightweight toast notifications: toast.success('Saved'), toast.error(msg). */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message, title) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, type, message, title }]);
    setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4500);
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (message, title) => push('success', message, title),
    error: (message, title) => push('error', message, title),
    info: (message, title) => push('info', message, title),
    warning: (message, title) => push('warning', message, title),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon name={ICONS[t.type]} size={20} className="toast-icon" />
            <div className="toast-body">
              {t.title && <strong>{t.title}</strong>}
              <span>{t.message}</span>
            </div>
            <button type="button" className="icon-btn toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
