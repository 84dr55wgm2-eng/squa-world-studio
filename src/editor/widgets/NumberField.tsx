/**
 * Champ numérique avec brouillon local.
 *
 * La valeur n'est envoyée au store qu'à la validation (Entrée, Tab, perte de
 * focus) : une saisie = une seule entrée d'historique, et aucun re-rendu de la
 * scène à chaque touche. Échap annule la saisie. Accepte la virgule décimale.
 * Flèches haut/bas : ± pas (Maj = ×10).
 */
import { useRef, useState, type KeyboardEvent } from 'react';

interface Props {
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  precision?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  min?: number;
  max?: number;
}

const format = (v: number, precision: number) => {
  const r = Number(v.toFixed(precision));
  return String(Object.is(r, -0) ? 0 : r);
};

export function parseNumberInput(text: string): number | null {
  const cleaned = text.trim().replace(',', '.').replace(/\s/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function NumberField({ value, onCommit, step = 0.1, precision = 3, disabled, ariaLabel, className, min, max }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const skipBlurCommit = useRef(false);

  // Hors édition, le champ affiche toujours la valeur du store (gizmo, undo…) : draft === null.
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  const commit = (text: string) => {
    const parsed = parseNumberInput(text);
    setDraft(null);
    if (parsed === null) return;
    const next = clamp(parsed);
    if (Math.abs(next - value) > 1e-9) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur(); // la validation se fait dans onBlur (une seule fois)
    } else if (e.key === 'Escape') {
      skipBlurCommit.current = true;
      setDraft(null);
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const current = parseNumberInput(e.currentTarget.value) ?? value;
      const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      const next = clamp(Number((current + delta).toFixed(precision)));
      setDraft(null);
      onCommit(next);
    }
  };

  return (
    <input
      className={`number-field ${className ?? ''}`}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft ?? format(value, precision)}
      onFocus={(e) => {
        setDraft(format(value, precision));
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (skipBlurCommit.current) {
          skipBlurCommit.current = false;
          return;
        }
        if (draft !== null) commit(e.currentTarget.value);
      }}
      onKeyDown={onKeyDown}
    />
  );
}
