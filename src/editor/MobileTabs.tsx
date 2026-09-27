/** Onglets affichés uniquement sur petit écran (voir app.css, @media max-width: 820px). */
export type MobileTab = 'scene' | 'add' | 'props';

const TABS: { id: MobileTab; label: string }[] = [
  { id: 'scene', label: 'Scène' },
  { id: 'add', label: 'Ajouter' },
  { id: 'props', label: 'Propriétés' },
];

export function MobileTabs({ value, onChange }: { value: MobileTab; onChange: (t: MobileTab) => void }) {
  return (
    <nav className="mobile-tabs" role="tablist" aria-label="Panneaux">
      {TABS.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={value === t.id ? 'is-active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
