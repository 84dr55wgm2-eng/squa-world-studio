/** Aide discrète en bas du viewport : navigation souris/trackpad et raccourcis. */
import { useState } from 'react';
import { SHORTCUTS } from './shortcuts.ts';

export function ViewportHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="viewport-help">
      <span className="help-mouse">Orbite : clic gauche · Pan : clic droit ou ⇧ + clic · Zoom : molette / pincement</span>
      <span className="help-touch">1 doigt : tourner · 2 doigts : zoom et déplacement · Toucher un objet : sélection</span>
      <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? 'Masquer les raccourcis' : 'Raccourcis'}
      </button>
      {open && (
        <dl className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <div key={s.keys}>
              <dt>{s.keys}</dt>
              <dd>{s.action}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
