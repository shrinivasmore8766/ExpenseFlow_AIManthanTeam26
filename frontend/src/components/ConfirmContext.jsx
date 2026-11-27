import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';

const ConfirmContext = createContext(null);

/**
 * Promise-based confirmation dialog replacing window.confirm:
 *   if (await confirm({ title, message, confirmLabel, tone: 'danger' })) { ... }
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current = resolve;
    setState({ confirmLabel: 'Confirm', tone: 'primary', ...options });
  }), []);

  const close = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        title={state?.title || 'Are you sure?'}
        onClose={() => close(false)}
        size="sm"
        footer={state && (
          <>
            <button type="button" onClick={() => close(false)}>Cancel</button>
            <button type="button" className={state.tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}
              onClick={() => close(true)}>
              {state.confirmLabel}
            </button>
          </>
        )}
      >
        {state && (
          <div className="confirm-body">
            <span className={`confirm-icon confirm-${state.tone}`}>
              <Icon name={state.tone === 'danger' ? 'alert' : 'info'} size={20} />
            </span>
            <p>{state.message}</p>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
