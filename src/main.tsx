import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { restoreAutosave } from './io/autosave.ts';
import './styles/app.css';

// Outils de diagnostic (tests automatisés, mesures de performance) : uniquement avec ?debug dans l'URL.
if (new URLSearchParams(location.search).has('debug')) void import('./app/debugHooks.ts').then((m) => m.installDebugHooks());

// Restaure la dernière scène (sauvegarde automatique locale) avant le premier rendu.
restoreAutosave();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
