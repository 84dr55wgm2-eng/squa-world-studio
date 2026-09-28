/**
 * Raccourcis clavier globaux. Ignorés pendant la saisie dans un champ
 * (sauf ⌘/Ctrl+S), pour ne pas voler l'undo natif du texte.
 */
import { useEffect } from 'react';
import {
  deleteSelection,
  duplicateSelection,
  groupSelection,
  redo,
  select,
  selectAll,
  setTransformMode,
  undo,
  ungroupSelection,
  useEditor,
} from '../store/editorStore.ts';
import { frameSelection, resetView } from '../viewport/cameraController.ts';
import { openProject, saveProject } from '../io/projectActions.ts';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'W / E / R', action: 'Déplacer / Tourner / Échelle' },
  { keys: 'F', action: 'Cadrer la sélection' },
  { keys: 'H', action: 'Vue par défaut' },
  { keys: 'Suppr / ⌫', action: 'Supprimer' },
  { keys: '⌘/Ctrl D', action: 'Dupliquer' },
  { keys: '⌘/Ctrl G', action: 'Grouper' },
  { keys: '⇧⌘G / Ctrl ⇧G', action: 'Dégrouper' },
  { keys: '⌘/Ctrl A', action: 'Tout sélectionner' },
  { keys: '⇧ / ⌘ / Ctrl + clic', action: 'Ajouter / retirer de la sélection' },
  { keys: 'Clic répété', action: 'Entrer dans un groupe' },
  { keys: '⌘/Ctrl Z', action: 'Annuler' },
  { keys: '⇧⌘Z / Ctrl Y', action: 'Rétablir' },
  { keys: '⌘/Ctrl S', action: 'Enregistrer' },
  { keys: '⌘/Ctrl O', action: 'Ouvrir' },
  { keys: 'Échap', action: 'Désélectionner' },
];

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 's') {
        e.preventDefault();
        void saveProject();
        return;
      }
      if (isTyping(e.target) || (e.repeat && key !== 'z')) return;

      const hasSelection = useEditor.getState().selectedIds.length > 0;

      if (mod) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          redo();
        } else if (key === 'd') {
          e.preventDefault();
          if (hasSelection) duplicateSelection();
        } else if (key === 'g') {
          e.preventDefault();
          if (e.shiftKey) ungroupSelection();
          else groupSelection();
        } else if (key === 'a') {
          e.preventDefault();
          selectAll();
        } else if (key === 'o') {
          e.preventDefault();
          void openProject();
        }
        return;
      }
      if (e.altKey) return;

      switch (key) {
        case 'w':
          setTransformMode('translate');
          break;
        case 'e':
          setTransformMode('rotate');
          break;
        case 'r':
          setTransformMode('scale');
          break;
        case 'f':
          if (hasSelection) frameSelection();
          break;
        case 'h':
          resetView();
          break;
        case 'delete':
        case 'backspace':
          if (hasSelection) {
            e.preventDefault();
            deleteSelection();
          }
          break;
        case 'escape':
          select(null);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
