/**
 * Frontière du fournisseur d'IA (côté navigateur).
 *
 * L'interface ne parle qu'à cette abstraction. L'implémentation actuelle appelle la fonction
 * serveur /api/world (voir api/world.ts), qui détient la clé d'API : aucun identifiant n'est
 * jamais présent dans le navigateur. Changer de fournisseur = changer api/world.ts, pas l'interface.
 */
import { appUrl } from '../assets/assetCache.ts';

export interface AIStatus {
  /** Le serveur d'IA répond. */
  reachable: boolean;
  /** Une clé est configurée côté serveur. */
  configured: boolean;
  provider?: string;
  model?: string;
  message?: string;
}

export interface SceneEditResult {
  commands: unknown[];
  explanation: string;
}

export interface AIProvider {
  status(): Promise<AIStatus>;
  /** Description libre → ScenePlan BRUT (à valider par validateScenePlan avant toute exécution). */
  generateScenePlan(prompt: string, signal?: AbortSignal): Promise<unknown>;
  /** Contexte de scène + consigne → commandes structurées BRUTES (validées à l'exécution). */
  modifyScene(sceneContext: unknown, instruction: string, signal?: AbortSignal): Promise<SceneEditResult>;
}

export class AIError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

class ServerAIProvider implements AIProvider {
  private readonly endpoint: string;
  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async status(): Promise<AIStatus> {
    try {
      const res = await fetch(this.endpoint, { cache: 'no-store' });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('json')) {
        return { reachable: false, configured: false, message: "Le serveur d'IA (/api/world) n'existe pas sur cet hébergement. La génération fonctionne sur le déploiement Vercel." };
      }
      const body = (await res.json()) as { configured?: boolean; provider?: string; model?: string };
      return {
        reachable: true,
        configured: !!body.configured,
        provider: body.provider,
        model: body.model,
        message: body.configured ? undefined : "Aucun modèle d'IA n'est connecté : définissez la variable d'environnement ANTHROPIC_API_KEY dans les réglages Vercel du projet, puis redéployez.",
      };
    } catch {
      return { reachable: false, configured: false, message: "Serveur d'IA injoignable (hors ligne ?)." };
    }
  }

  private async post<T>(body: unknown, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new AIError('ABORTED', 'Génération annulée.');
      throw new AIError('NETWORK', "Serveur d'IA injoignable.");
    }
    const data = (await res.json().catch(() => null)) as ({ error?: string; message?: string } & T) | null;
    if (!res.ok || !data) throw new AIError(data?.error ?? `HTTP_${res.status}`, data?.message ?? `Erreur du serveur d'IA (HTTP ${res.status}).`);
    return data;
  }

  async generateScenePlan(prompt: string, signal?: AbortSignal): Promise<unknown> {
    return (await this.post<{ plan: unknown }>({ mode: 'plan', prompt }, signal)).plan;
  }

  async modifyScene(sceneContext: unknown, instruction: string, signal?: AbortSignal): Promise<SceneEditResult> {
    const r = await this.post<{ commands: unknown[]; explanation: string }>({ mode: 'edit', instruction, scene: sceneContext }, signal);
    return { commands: Array.isArray(r.commands) ? r.commands : [], explanation: r.explanation ?? '' };
  }
}

export const aiProvider: AIProvider = new ServerAIProvider(appUrl('api/world'));
