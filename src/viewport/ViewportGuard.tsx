/**
 * Protège l'application quand la 3D ne peut pas démarrer chez un visiteur
 * (WebGL désactivé, pilote graphique bloqué, contexte perdu…) : un message clair
 * s'affiche dans la zone du viewport, et le reste de l'éditeur reste utilisable
 * (hiérarchie, propriétés, sauvegarde).
 */
import { Component, type ReactNode } from 'react';

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function ViewportMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="viewport-message" role="alert">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export class ViewportErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[SQUA] Erreur du viewport 3D :', error);
  }

  render() {
    if (this.state.error) {
      return (
        <ViewportMessage
          title="La vue 3D a rencontré une erreur."
          detail="Votre scène est conservée (sauvegarde automatique). Rechargez la page pour relancer la vue 3D."
        />
      );
    }
    return this.props.children;
  }
}
