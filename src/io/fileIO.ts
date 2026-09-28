/**
 * Sauvegarde / chargement de fichiers de scène `.squa` (JSON) côté navigateur. Les `.squa.json` des versions
 * précédentes s'ouvrent aussi.
 * Téléchargement classique (fonctionne dans Chrome, Safari, Firefox) : aucun
 * accès disque direct, aucune dépendance.
 */
import { hostDownloads, isFramed } from './hostBridge.ts';
import {
  SCENE_FILE_EXTENSION,
  documentToJson,
  parseSceneFile,
  referencedFileHashes,
  type EmbeddedFile,
  type ParseResult,
  type SceneDocument,
} from '../core/index.ts';
import { blobToBase64, getFile } from '../assets/fileStore.ts';

export function fileNameFor(doc: SceneDocument): string {
  const slug =
    doc.project.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scene';
  return `${slug}${SCENE_FILE_EXTENSION}`;
}

/**
 * Enregistre la scène. Renvoie le nom du fichier, ou null si l'utilisateur a refusé
 * (seulement possible via l'API de l'hôte, qui demande confirmation).
 */
export async function downloadScene(doc: SceneDocument): Promise<{ name: string; missingFiles: number } | null> {
  const name = fileNameFor(doc);
  // Les modèles importés sont intégrés au fichier : la scène se rouvre sur n'importe quel appareil.
  const files: Record<string, EmbeddedFile> = {};
  let missingFiles = 0;
  for (const hash of referencedFileHashes(doc)) {
    const blob = await getFile(hash);
    if (!blob) {
      missingFiles++;
      continue;
    }
    const ref = Object.values(doc.assets).flatMap((a) => (a.source.kind === 'file' ? a.source.files : [])).find((f) => f.hash === hash)!;
    files[hash] = { name: ref.name, size: blob.size, data: await blobToBase64(blob) };
  }
  const json = documentToJson(doc, new Date(), files);
  if (isFramed) {
    const downloads = await hostDownloads();
    if (downloads) {
      try {
        await downloads.save({ filename: name, data: json });
        return { name, missingFiles };
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'declined') return null;
        // Autre refus : on tente le téléchargement classique ci-dessous.
      }
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Laisse le temps au navigateur de démarrer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name, missingFiles };
}

/** Ouvre le sélecteur de fichiers et renvoie le résultat de lecture (null si annulé). */
export function pickSceneFile(): Promise<{ fileName: string; result: ParseResult } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Pas de filtre d'extension : certains navigateurs mobiles grisent les extensions inconnues (.squa).
    // Le contenu est de toute façon vérifié à la lecture.
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const text = await file.text();
      resolve({ fileName: file.name, result: parseSceneFile(text) });
    });
    // Pas d'événement fiable pour « annulé » dans tous les navigateurs : la promesse reste simplement en attente.
    input.click();
  });
}
