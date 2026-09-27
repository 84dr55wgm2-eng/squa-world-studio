/**
 * Boîte de confirmation intégrée à la page (remplace window.confirm, qui est
 * bloqué dans certains contextes d'hébergement et peu lisible sur mobile).
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ request: ConfirmRequest | null }>()(() => ({ request: null }));

/** Affiche la boîte et résout true (confirmé) ou false (annulé). */
export function askConfirm(message: string, confirmLabel = 'Continuer'): Promise<boolean> {
  useConfirm.getState().request?.resolve(false);
  return new Promise((resolve) => useConfirm.setState({ request: { message, confirmLabel, resolve } }));
}

function answer(ok: boolean) {
  const req = useConfirm.getState().request;
  useConfirm.setState({ request: null });
  req?.resolve(ok);
}

export function ConfirmDialog() {
  const request = useConfirm((s) => s.request);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!request) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);
  if (!request) return null;
  return (
    <div className="dialog-backdrop" onClick={() => answer(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg" onClick={(e) => e.stopPropagation()}>
        <p id="confirm-msg">{request.message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => answer(false)}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" ref={confirmRef} onClick={() => answer(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
