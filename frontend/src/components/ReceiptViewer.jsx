import { useEffect, useState } from 'react';
import { apiDownload } from '../api/client.js';
import Icon from './Icon.jsx';

/** Loads the receipt with the auth header and shows it from a blob URL (plain <img src> can't authenticate). */
export default function ReceiptViewer({ claimId, line }) {
  const [state, setState] = useState({ url: null, type: '', error: null, loading: false });

  const lineId = line?.id;
  const hasReceipt = line?.hasReceipt;

  useEffect(() => {
    if (!lineId || !hasReceipt) {
      setState({ url: null, type: '', error: null, loading: false });
      return undefined;
    }
    let url = null;
    let cancelled = false;
    setState({ url: null, type: '', error: null, loading: true });
    apiDownload(`/claims/${claimId}/lines/${lineId}/receipt`)
      .then(({ blob, contentType }) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ url, type: contentType || blob.type, error: null, loading: false });
      })
      .catch((err) => {
        if (!cancelled) setState({ url: null, type: '', error: err.message, loading: false });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [claimId, lineId, hasReceipt]);

  if (!line) {
    return <div className="receipt-frame receipt-empty"><Icon name="file" size={28} /><span>Select a line to view its receipt</span></div>;
  }
  if (!hasReceipt) {
    return <div className="receipt-frame receipt-empty"><Icon name="paperclip" size={28} /><span>No receipt uploaded for this line</span></div>;
  }
  if (state.loading) return <div className="receipt-frame"><div className="skeleton receipt-skeleton" /></div>;
  if (state.error) return <div className="alert alert-error"><Icon name="xCircle" size={18} /><span className="alert-body">{state.error}</span></div>;
  if (!state.url) return null;

  const isPdf = state.type.includes('pdf');
  return (
    <div>
      <div className="receipt-frame">
        {isPdf
          ? <iframe src={state.url} title={`Receipt for line ${line.id}`} />
          : <img src={state.url} alt={`Receipt for ${line.vendor}`} />}
      </div>
      <a className="receipt-open" href={state.url} target="_blank" rel="noreferrer">
        <Icon name="eye" size={14} /> Open full size
      </a>
    </div>
  );
}
