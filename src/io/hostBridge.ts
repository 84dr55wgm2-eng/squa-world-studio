/**
 * Adaptation à l'hébergement. Sur un site classique (Vercel…), le navigateur
 * télécharge directement le fichier. Quand l'application est affichée dans un
 * cadre restreint qui bloque les téléchargements (ex. aperçu hébergé par Claude),
 * on passe par l'API d'enregistrement fournie par l'hôte, si elle existe.
 */
interface HostDownloads {
  save(req: { filename: string; data: string }): Promise<{ status: string }>;
}
interface HostClaude {
  use(name: 'downloads'): Promise<HostDownloads | null>;
}

let downloadsPromise: Promise<HostDownloads | null> | null = null;

export function hostDownloads(): Promise<HostDownloads | null> {
  if (!downloadsPromise) {
    const host = (window as unknown as { claude?: HostClaude }).claude;
    downloadsPromise = host?.use ? host.use('downloads').catch(() => null) : Promise.resolve(null);
  }
  return downloadsPromise;
}

/** Vrai si la page tourne dans un cadre (iframe) : les téléchargements directs y sont souvent bloqués. */
export const isFramed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
