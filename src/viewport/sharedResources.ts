/**
 * Géométries partagées : une seule instance GPU par forme, quel que soit le
 * nombre d'objets. Les dimensions réelles viennent du `scale` de chaque objet.
 */
import { BoxGeometry, ConeGeometry, EdgesGeometry, SphereGeometry } from 'three';

export const GEOMETRIES = {
  /** Cube unité 1 × 1 × 1 m, centré. */
  box: new BoxGeometry(1, 1, 1),
  /** Sphère de diamètre 1 m (rayon 0,5), centrée. */
  sphere: new SphereGeometry(0.5, 48, 24),
  /** Poignée cliquable d'une lumière. */
  lightHandle: new SphereGeometry(0.12, 16, 8),
  /** Corps et objectif de la représentation d'une caméra. */
  cameraBody: new BoxGeometry(0.28, 0.2, 0.36),
  cameraLens: new ConeGeometry(0.09, 0.14, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.25),
  /** Contour de sélection : arêtes d'un cube unité. */
  selectionBox: new EdgesGeometry(new BoxGeometry(1, 1, 1)),
};

export const SELECTION_COLOR = '#4da3ff';
