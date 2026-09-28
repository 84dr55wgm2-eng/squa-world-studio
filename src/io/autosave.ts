/**
 * Sauvegarde automatique locale (localStorage du navigateur).
 *
 * Filet de sécurité contre une fermeture d'onglet ou un rechargement : la scène
 * courante est réécrite ~1 s après chaque modification et restaurée au démarrage.
 * Ce n'est PAS un remplacement de « Enregistrer » (fichier .squa).
 */
import { documentToJson, parseSceneFile } from '../core/index.ts';
import { notify, replaceDocument, selectIsDirty, useEditor } from '../store/editorStore.ts';

const KEY = 'squa-world-studio:autosave:v1';
const DELAY_MS = 800;

interface AutosavePayload {
  dirty: boolean;
  file: string;
}

export function restoreAutosave(): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const payload = JSON.parse(raw) as AutosavePayload;
    const result = parseSceneFile(payload.file);
    if (!result.ok) return false;
    replaceDocument(result.doc, { dirty: payload.dirty });
    const count = Object.keys(result.doc.objects).length;
    if (count > 0) notify('info', `Scène « ${result.doc.project.name} » restaurée (${count} objet${count > 1 ? 's' : ''}).`);
    return true;
  } catch {
    return false;
  }
}

/** Démarre l'écoute du store. Renvoie la fonction d'arrêt. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    const state = useEditor.getState();
    const payload: AutosavePayload = { dirty: selectIsDirty(state), file: documentToJson(state.doc) };
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch {
      // Stockage plein ou indisponible (navigation privée) : on ignore, la sauvegarde fichier reste possible.
    }
  };
  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.doc === prev.doc && state.savedRevision === prev.savedRevision) return;
    clearTimeout(timer);
    timer = setTimeout(write, DELAY_MS);
  });
  const flush = () => {
    clearTimeout(timer);
    write();
  };
  window.addEventListener('beforeunload', flush);
  return () => {
    unsubscribe();
    clearTimeout(timer);
    window.removeEventListener('beforeunload', flush);
  };
}
