import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { restoreAutosave } from './io/autosave.ts';
import './styles/app.css';

// Restaure la dernière scène (sauvegarde automatique locale) avant le premier rendu.
restoreAutosave();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
