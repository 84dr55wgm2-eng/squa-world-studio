/**
 * Géométrie des éléments paramétriques, générée à partir de leurs dimensions réelles.
 *
 * Chaque forme produit des « parties » (ex. cadre + vitrage pour une fenêtre) ; chaque partie
 * est UNE géométrie fusionnée (un seul appel de dessin). Les géométries sont partagées entre
 * les éléments identiques (même forme, mêmes dimensions, mêmes ouvertures) et libérées quand
 * plus aucun élément ne les utilise.
 *
 * Repère : pivot au centre de la base, X = largeur, Y = hauteur, Z = profondeur, face avant +Z.
 */
import { BoxGeometry, BufferGeometry, CylinderGeometry, MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ElementProps } from '../../core/index.ts';

export type PartKind = 'main' | 'trim' | 'glass' | 'facade' | 'marking' | 'lamp' | 'screen' | 'dark' | 'metal';

export interface Opening {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

type Parts = Partial<Record<PartKind, BufferGeometry[]>>;

function box(parts: Parts, kind: PartKind, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) {
  if (sx <= 1e-4 || sy <= 1e-4 || sz <= 1e-4) return;
  (parts[kind] ??= []).push(new BoxGeometry(sx, sy, sz).translate(cx, cy, cz));
}

function cylinder(parts: Parts, kind: PartKind, cx: number, y0: number, cz: number, r: number, h: number) {
  (parts[kind] ??= []).push(new CylinderGeometry(r, r, h, 20).translate(cx, y0 + h / 2, cz));
}

/** Découpe un mur en blocs autour des ouvertures (portes, fenêtres). */
function wallWithOpenings(parts: Parts, w: number, h: number, d: number, openings: Opening[]) {
  const clipped = openings
    .map((o) => ({ x0: Math.max(-w / 2, o.x0), x1: Math.min(w / 2, o.x1), y0: Math.max(0, o.y0), y1: Math.min(h, o.y1) }))
    .filter((o) => o.x1 - o.x0 > 1e-3 && o.y1 - o.y0 > 1e-3);
  if (!clipped.length) return box(parts, 'main', 0, h / 2, 0, w, h, d);
  const xs = [...new Set([-w / 2, w / 2, ...clipped.flatMap((o) => [o.x0, o.x1])])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    const mid = (a + b) / 2;
    const holes = clipped.filter((o) => o.x0 <= mid && o.x1 >= mid).sort((p, q) => p.y0 - q.y0);
    let y = 0;
    for (const hole of holes) {
      if (hole.y0 > y) box(parts, 'main', mid, (y + hole.y0) / 2, 0, b - a, hole.y0 - y, d);
      y = Math.max(y, hole.y1);
    }
    if (y < h) box(parts, 'main', mid, (y + h) / 2, 0, b - a, h - y, d);
  }
}

export function buildElementParts(el: ElementProps, openings: Opening[] = []): Parts {
  const [w, h, d] = el.size;
  const p = el.params;
  const parts: Parts = {};
  switch (el.shape) {
    case 'slab':
    case 'sidewalk':
    case 'box':
      box(parts, 'main', 0, h / 2, 0, w, h, d);
      break;
    case 'wall':
      wallWithOpenings(parts, w, h, d, openings);
      break;
    case 'door': {
      const f = Math.min(p.frame ?? 0.06, w / 4);
      box(parts, 'trim', -w / 2 + f / 2, h / 2, 0, f, h, d);
      box(parts, 'trim', w / 2 - f / 2, h / 2, 0, f, h, d);
      box(parts, 'trim', 0, h - f / 2, 0, w - 2 * f, f, d);
      const leafT = Math.min(0.045, d);
      box(parts, 'main', 0, (h - f) / 2, 0, w - 2 * f - 0.006, h - f - 0.006, leafT);
      box(parts, 'metal', w / 2 - f - 0.09, 1.0, leafT / 2 + 0.02, 0.12, 0.02, 0.02);
      box(parts, 'metal', w / 2 - f - 0.09, 1.0, -leafT / 2 - 0.02, 0.12, 0.02, 0.02);
      break;
    }
    case 'window': {
      const f = Math.min(p.frame ?? 0.05, w / 4, h / 4);
      const panes = Math.max(1, Math.round(p.panes ?? 2));
      box(parts, 'main', -w / 2 + f / 2, h / 2, 0, f, h, d);
      box(parts, 'main', w / 2 - f / 2, h / 2, 0, f, h, d);
      box(parts, 'main', 0, f / 2, 0, w - 2 * f, f, d);
      box(parts, 'main', 0, h - f / 2, 0, w - 2 * f, f, d);
      const inner = w - 2 * f;
      for (let i = 1; i < panes; i++) box(parts, 'main', -inner / 2 + (inner * i) / panes, h / 2, 0, f * 0.7, h - 2 * f, d * 0.6);
      box(parts, 'glass', 0, h / 2, 0, inner, h - 2 * f, Math.min(0.012, d / 3));
      break;
    }
    case 'stairs': {
      const n = Math.max(2, Math.round(p.steps ?? 16));
      const rise = h / n, run = d / n;
      for (let i = 0; i < n; i++) box(parts, 'main', 0, ((i + 1) * rise) / 2, d / 2 - (i + 0.5) * run, w, (i + 1) * rise, run);
      break;
    }
    case 'road': {
      box(parts, 'main', 0, h / 2, 0, w, h, d);
      const lanes = Math.max(1, Math.round(p.lanes ?? 2));
      const y = h + 0.003;
      // Lignes de rive continues, séparations de voies en tirets (3 m tous les 6 m).
      box(parts, 'marking', -w / 2 + 0.3, y, 0, 0.12, 0.004, d);
      box(parts, 'marking', w / 2 - 0.3, y, 0, 0.12, 0.004, d);
      const lw = w / lanes;
      for (let i = 1; i < lanes; i++) {
        const x = -w / 2 + i * lw;
        for (let z = -d / 2 + 1.5; z < d / 2 - 1.5; z += 6) box(parts, 'marking', x, y, z + 1.5, 0.12, 0.004, Math.min(3, d / 2 - z));
      }
      break;
    }
    case 'building': {
      box(parts, 'main', 0, h / 2, 0, w, h, d);
      const floors = Math.max(1, Math.round(p.floors ?? 3));
      const fh = h / floors;
      // Bandeaux vitrés par étage sur les quatre façades (volume d'étude, pas de détail).
      for (let f = 0; f < floors; f++) {
        const y0 = f * fh + Math.min(0.9, fh * 0.3), y1 = f * fh + fh - Math.min(0.5, fh * 0.2);
        if (y1 - y0 < 0.2) continue;
        const cy = (y0 + y1) / 2, bh = y1 - y0;
        box(parts, 'facade', 0, cy, d / 2 + 0.01, w - 1, bh, 0.02);
        box(parts, 'facade', 0, cy, -d / 2 - 0.01, w - 1, bh, 0.02);
        box(parts, 'facade', w / 2 + 0.01, cy, 0, 0.02, bh, d - 1);
        box(parts, 'facade', -w / 2 - 0.01, cy, 0, 0.02, bh, d - 1);
      }
      break;
    }
    case 'table': {
      const t = p.top ?? 0.04;
      const leg = Math.min(0.06, w / 6, d / 6);
      box(parts, 'main', 0, h - t / 2, 0, w, t, d);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(parts, 'main', sx * (w / 2 - leg / 2 - 0.04), (h - t) / 2, sz * (d / 2 - leg / 2 - 0.04), leg, h - t, leg);
      break;
    }
    case 'desk': {
      const t = p.top ?? 0.03;
      box(parts, 'main', 0, h - t / 2, 0, w, t, d);
      box(parts, 'main', -w / 2 + 0.015, (h - t) / 2, 0, 0.03, h - t, d - 0.02);
      box(parts, 'main', w / 2 - 0.015, (h - t) / 2, 0, 0.03, h - t, d - 0.02);
      box(parts, 'main', 0, h - t - 0.2, -d / 2 + 0.05, w - 0.06, 0.35, 0.018);
      break;
    }
    case 'shelf': {
      const n = Math.max(1, Math.round(p.shelves ?? 5));
      const s = 0.02;
      box(parts, 'main', -w / 2 + s / 2, h / 2, 0, s, h, d);
      box(parts, 'main', w / 2 - s / 2, h / 2, 0, s, h, d);
      box(parts, 'main', 0, h / 2, -d / 2 + 0.005, w - 2 * s, h, 0.01);
      for (let i = 0; i <= n; i++) box(parts, 'main', 0, Math.min(h - s / 2, s / 2 + ((h - s) * i) / n), 0.005, w - 2 * s, s, d - 0.01);
      break;
    }
    case 'monitor': {
      const baseD = Math.min(0.18, d);
      box(parts, 'dark', 0, 0.0075, 0, Math.min(0.24, w), 0.015, baseD);
      box(parts, 'dark', 0, 0.075, -baseD / 4, 0.045, 0.13, 0.03);
      const sh = h - 0.1;
      box(parts, 'main', 0, 0.1 + sh / 2, 0, w, sh, 0.03);
      box(parts, 'screen', 0, 0.1 + sh / 2, 0.0155, w - 0.02, sh - 0.02, 0.002);
      break;
    }
    case 'computer':
      box(parts, 'main', 0, h / 2, 0, w, h, d);
      box(parts, 'dark', 0, h * 0.8, d / 2 + 0.001, w * 0.7, h * 0.05, 0.002);
      break;
    case 'streetlight': {
      const zPole = -d / 2 + 0.15;
      cylinder(parts, 'main', 0, 0, zPole, Math.min(0.09, w / 4), h - 0.1);
      box(parts, 'main', 0, 0.2, zPole, Math.min(0.3, w), 0.4, 0.3);
      box(parts, 'main', 0, h - 0.12, (zPole + d / 2 - 0.25) / 2, 0.06, 0.06, d / 2 - 0.25 - zPole);
      box(parts, 'main', 0, h - 0.1, d / 2 - 0.25, Math.min(0.3, w), 0.1, 0.5);
      box(parts, 'lamp', 0, h - 0.16, d / 2 - 0.25, Math.min(0.26, w * 0.9), 0.02, 0.44);
      break;
    }
    case 'barrier': {
      // Profil de glissière type « New Jersey » simplifié en trois gradins.
      box(parts, 'main', 0, 0.04, 0, w, 0.08, d);
      box(parts, 'main', 0, 0.08 + (h * 0.25) / 2, 0, w, h * 0.25, d * 0.75);
      box(parts, 'main', 0, 0.08 + h * 0.25 + (h - 0.08 - h * 0.25) / 2, 0, w, h - 0.08 - h * 0.25, d * 0.3);
      break;
    }
  }
  return parts;
}

/** Géométrie fusionnée par partie. */
export function mergeParts(parts: Parts): Partial<Record<PartKind, BufferGeometry>> {
  const out: Partial<Record<PartKind, BufferGeometry>> = {};
  for (const [kind, list] of Object.entries(parts) as [PartKind, BufferGeometry[]][]) {
    if (!list.length) continue;
    // Les cylindres ont les mêmes attributs (position, normal, uv) que les boîtes : fusion directe.
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) list.forEach((g) => g.dispose());
    if (merged) {
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      out[kind] = merged;
    }
  }
  return out;
}

/* ------------------------------------------------------------ Cache partagé (compteur de références) */

interface CacheEntry {
  parts: Partial<Record<PartKind, BufferGeometry>>;
  refs: number;
}
const cache = new Map<string, CacheEntry>();

export function elementKey(el: ElementProps, openings: Opening[]): string {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return `${el.shape}|${el.size.map(r).join(',')}|${Object.entries(el.params).map(([k, v]) => `${k}=${r(v)}`).join(',')}|${openings.map((o) => [o.x0, o.x1, o.y0, o.y1].map(r).join(',')).join(';')}`;
}

/**
 * Renvoie la géométrie (créée au besoin) SANS la réserver : appelable pendant le rendu React.
 * La réservation se fait dans un effet (claim / release). Une géométrie créée mais jamais
 * réservée (rendu abandonné) est libérée après un délai.
 */
export function peekElementGeometry(key: string, el: ElementProps, openings: Opening[]) {
  let entry = cache.get(key);
  if (!entry) {
    const created: CacheEntry = { parts: mergeParts(buildElementParts(el, openings)), refs: 0 };
    cache.set(key, created);
    entry = created;
    setTimeout(() => {
      if (created.refs === 0 && cache.get(key) === created) dispose(key, created);
    }, 5000);
  }
  return entry.parts;
}

export function claimElementGeometry(key: string) {
  const entry = cache.get(key);
  if (entry) entry.refs++;
}

function dispose(key: string, entry: CacheEntry) {
  Object.values(entry.parts).forEach((g) => g?.dispose());
  cache.delete(key);
}

export function releaseElementGeometry(key: string) {
  const entry = cache.get(key);
  if (!entry) return;
  if (--entry.refs > 0) return;
  // Libération différée : un démontage / remontage immédiat (StrictMode, undo rapide) réutilise la géométrie.
  setTimeout(() => {
    if (entry.refs <= 0 && cache.get(key) === entry) dispose(key, entry);
  }, 2000);
}

export const elementGeometryCacheSize = () => cache.size;

/* ------------------------------------------------------------ Matériaux fixes des parties secondaires */

export const PART_MATERIALS: Record<Exclude<PartKind, 'main'>, MeshStandardMaterial> = {
  trim: new MeshStandardMaterial({ color: '#e9e6df', roughness: 0.6 }),
  glass: new MeshStandardMaterial({ color: '#8fb3c7', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }),
  marking: new MeshStandardMaterial({ color: '#e8e8e2', roughness: 0.8 }),
  lamp: new MeshStandardMaterial({ color: '#fff6dc', emissive: '#ffe7b0', emissiveIntensity: 1.2, roughness: 0.4 }),
  facade: new MeshStandardMaterial({ color: '#3a4652', roughness: 0.18, metalness: 0.35 }),
  screen: new MeshStandardMaterial({ color: '#0b0d12', roughness: 0.15, metalness: 0.2 }),
  dark: new MeshStandardMaterial({ color: '#1b1d22', roughness: 0.5, metalness: 0.3 }),
  metal: new MeshStandardMaterial({ color: '#b9bcc2', roughness: 0.3, metalness: 0.9 }),
};
