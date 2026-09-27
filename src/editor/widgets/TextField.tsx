/** Champ texte validé à Entrée / perte de focus, annulé par Échap. */
import { useRef, useState } from 'react';

interface Props {
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  autoFocus?: boolean;
  onDone?: () => void;
}

export function TextField({ value, onCommit, disabled, ariaLabel, className, autoFocus, onDone }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const finish = (text: string) => {
    setDraft(null);
    if (text.trim() && text.trim() !== value) onCommit(text.trim());
    onDone?.();
  };

  return (
    <input
      className={`text-field ${className ?? ''}`}
      type="text"
      aria-label={ariaLabel}
      disabled={disabled}
      autoFocus={autoFocus}
      value={draft ?? value}
      spellCheck={false}
      onFocus={(e) => {
        setDraft(value);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(null);
          onDone?.();
          return;
        }
        finish(e.currentTarget.value);
      }}
    />
  );
}
