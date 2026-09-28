/** Actions « fichier » partagées par la barre supérieure et les raccourcis clavier. */
import { downloadScene, pickSceneFile } from './fileIO.ts';
import { markSaved, newScene, notify, replaceDocument, selectIsDirty, useEditor } from '../store/editorStore.ts';
import { resetView } from '../viewport/cameraController.ts';
import { askConfirm } from '../editor/ConfirmDialog.tsx';
import { base64ToBlob, putFile } from '../assets/fileStore.ts';

export async function confirmDiscardChanges(): Promise<boolean> {
  if (!selectIsDirty(useEditor.getState())) return true;
  return askConfirm('La scène contient des modifications non enregistrées. Elles seront perdues. Continuer ?', 'Continuer sans enregistrer');
}

export async function saveProject(): Promise<void> {
  const revision = useEditor.getState().revision;
  const saved = await downloadScene(useEditor.getState().doc);
  if (!saved) return;
  // Ne marque « enregistré » que si rien n'a changé pendant la confirmation.
  if (useEditor.getState().revision === revision) markSaved();
  if (saved.missingFiles > 0) {
    notify('error', `Scène enregistrée (${saved.name}), mais ${saved.missingFiles} fichier(s) de modèle importé(s) n'ont pas pu être intégrés.`);
  } else {
    notify('info', `Scène enregistrée : ${saved.name}`);
  }
}

export async function openProject(): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  const picked = await pickSceneFile();
  if (!picked) return;
  if (!picked.result.ok) {
    notify('error', `Impossible d'ouvrir ${picked.fileName} : ${picked.result.error}`);
    return;
  }
  // Les modèles importés intégrés au fichier sont remis dans le stockage local avant l'affichage.
  for (const [hash, f] of Object.entries(picked.result.files)) {
    try {
      await putFile(hash, base64ToBlob(f.data));
    } catch {
      notify('error', `Fichier intégré illisible : ${f.name}`);
    }
  }
  replaceDocument(picked.result.doc);
  resetView();
  const warn = picked.result.warnings.length;
  notify('info', `${picked.fileName} chargé${warn ? ` (${warn} valeur(s) complétée(s) par défaut)` : ''}.`);
}

export async function createNewProject(): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  newScene();
  resetView();
}
