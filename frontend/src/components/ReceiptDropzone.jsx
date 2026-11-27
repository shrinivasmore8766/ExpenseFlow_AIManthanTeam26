import { useRef, useState } from 'react';
import Icon from './Icon.jsx';

/** Drag-and-drop / tap-to-browse receipt picker. The parent validates and uploads. */
export default function ReceiptDropzone({ id, hasReceipt, disabled, onFile }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handle(file) {
    if (file) onFile(file);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <label
      htmlFor={id}
      className={`dropzone ${dragging ? 'is-dragging' : ''} ${hasReceipt ? 'has-file' : ''} ${disabled ? 'is-disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) handle(e.dataTransfer.files[0]); }}
    >
      <Icon name={hasReceipt ? 'checkCircle' : 'upload'} size={18} />
      <span>
        <strong>{hasReceipt ? 'Receipt attached' : 'Upload receipt'}</strong>
        <small>{hasReceipt ? 'Drop or tap to replace' : 'Drag a file here or tap to browse'} · PDF, JPG or PNG · max 5 MB</small>
      </span>
      <input ref={inputRef} id={id} type="file" className="visually-hidden" accept="image/*,application/pdf"
        capture="environment" disabled={disabled} onChange={(e) => handle(e.target.files[0])} />
    </label>
  );
}
