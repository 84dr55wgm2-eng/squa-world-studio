/**
 * Modèles de scène et prefabs intégrés.
 *
 * Ce ne sont PAS des scènes codées en dur : chacun est un script de commandes structurées
 * (worldCommands.ts), exécuté par le même moteur que celui qu'utilisera l'IA. Les objets
 * produits sont des SceneObjects ordinaires (modifiables, déplaçables, supprimables).
 */
import type { PrefabDefinition, WorldCommand } from './worldCommands.ts';

export interface SceneTemplate {
  id: 'empty' | 'interior-room' | 'street-block';
  name: string;
  description: string;
  commands: WorldCommand[];
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  { id: 'empty', name: 'Scène vide', description: 'Grille, lumière par défaut, aucun objet.', commands: [] },
  {
    id: 'interior-room',
    name: 'Pièce intérieure',
    description: 'Pièce 6 × 8 m (sol, murs, porte, fenêtres, plafonnier) meublée : poste de bureau, canapé, étagère, plante.',
    commands: [
      {
        action: 'CREATE_ROOM',
        as: 'room',
        name: 'Pièce',
        width: 6,
        depth: 8,
        height: 3,
        doors: [{ wall: 'south', offset: 1.5 }],
        windows: [
          { wall: 'east', offset: -1.5 },
          { wall: 'east', offset: 1.5 },
          { wall: 'north', offset: 1.6 },
        ],
      },
      { action: 'INSTANTIATE_PREFAB', prefabId: 'office-desk', as: 'desk', relation: { type: 'AGAINST', target: 'room.wall_north', offset: -1.2 } },
      { action: 'ADD_OBJECT', assetId: 'leather-sofa', as: 'sofa', relation: { type: 'AGAINST', target: 'room.wall_west', offset: 1.2 } },
      { action: 'ADD_OBJECT', assetId: 'silk-pouf', relation: { type: 'NEXT_TO', target: 'sofa', side: 'front', gap: 0.5 } },
      { action: 'ADD_OBJECT', element: 'shelf', as: 'shelf', relation: { type: 'AGAINST', target: 'room.wall_east', offset: 0 } },
      { action: 'ADD_OBJECT', element: 'box', relation: { type: 'AGAINST', target: 'room.wall_east', offset: 0.9 } },
      { action: 'ADD_OBJECT', assetId: 'plant', relation: { type: 'INSIDE', target: 'room', x: -2.5, z: -3.4 } },
      { action: 'ADD_OBJECT', camera: { fov: 50 }, name: 'Caméra de la pièce', position: [2.4, 1.6, 3.6], rotation: [-8, 35, 0] },
    ],
  },
  {
    id: 'street-block',
    name: 'Rue urbaine',
    description: 'Rue de 60 m : chaussée 2 voies, trottoirs, volumes de bâtiments, lampadaires, véhicules, plantes, barrières.',
    commands: [
      { action: 'CREATE_STREET', as: 'street', name: 'Rue', length: 60, lanes: 2, sidewalkWidth: 3, streetLightSpacing: 15 },
      { action: 'ADD_OBJECT', assetId: 'car-concept', relation: { type: 'ALONG', target: 'street.road', t: 0.35, offset: 1.75 } },
      { action: 'ADD_OBJECT', assetId: 'milk-truck', relation: { type: 'ALONG', target: 'street.road', t: 0.7, offset: 1.75, reverse: true } },
      { action: 'ADD_OBJECT', assetId: 'plant', relation: { type: 'ALONG', target: 'street.sidewalk_left', t: 0.2, offset: 0.9 } },
      { action: 'ADD_OBJECT', assetId: 'plant', relation: { type: 'ALONG', target: 'street.sidewalk_left', t: 0.6, offset: 0.9 } },
      { action: 'ADD_OBJECT', assetId: 'plant', relation: { type: 'ALONG', target: 'street.sidewalk_right', t: 0.45, offset: -0.9 } },
      { action: 'INSTANTIATE_PREFAB', prefabId: 'street-corner', relation: { type: 'ALONG', target: 'street.sidewalk_right', t: 0.85, yaw: 90 } },
      { action: 'ADD_OBJECT', camera: { fov: 45 }, name: 'Caméra de rue', position: [6, 1.7, 28], rotation: [-4, 12, 0] },
    ],
  },
];

export const BUILTIN_PREFABS: PrefabDefinition[] = [
  {
    id: 'office-desk',
    name: 'Poste de bureau',
    category: 'prefabs',
    tags: ['bureau', 'travail', 'ordinateur', 'chaise'],
    description: 'Bureau, écran, unité centrale, chaise, gourde.',
    kind: 'commands',
    commands: [
      { action: 'ADD_OBJECT', element: 'desk', as: 'desk' },
      { action: 'ADD_OBJECT', element: 'monitor', relation: { type: 'ON', target: 'desk', z: -0.1 } },
      { action: 'ADD_OBJECT', assetId: 'water-bottle', relation: { type: 'ON', target: 'desk', x: 0.55, z: 0.15 } },
      { action: 'ADD_OBJECT', element: 'computer', relation: { type: 'NEXT_TO', target: 'desk', side: 'right', gap: 0.05, face: 'same' } },
      { action: 'ADD_OBJECT', assetId: 'sheen-chair', relation: { type: 'NEXT_TO', target: 'desk', side: 'front', gap: 0.05 } },
    ],
  },
  {
    id: 'cybercafe-workstation',
    name: 'Poste de cybercafé',
    category: 'prefabs',
    tags: ['cybercafé', 'ordinateur', 'écran', 'chaise'],
    description: 'Long bureau avec deux écrans et deux chaises.',
    kind: 'commands',
    commands: [
      { action: 'ADD_OBJECT', element: 'desk', as: 'desk', size: [2.4, 0.75, 0.7] },
      { action: 'ADD_OBJECT', element: 'monitor', relation: { type: 'ON', target: 'desk', x: -0.6, z: -0.1 } },
      { action: 'ADD_OBJECT', element: 'monitor', relation: { type: 'ON', target: 'desk', x: 0.6, z: -0.1 } },
      { action: 'ADD_OBJECT', assetId: 'sheen-chair', relation: { type: 'NEXT_TO', target: 'desk', side: 'front', offset: -0.6, gap: 0.05 } },
      { action: 'ADD_OBJECT', assetId: 'sheen-chair', relation: { type: 'NEXT_TO', target: 'desk', side: 'front', offset: 0.6, gap: 0.05 } },
    ],
  },
  {
    id: 'living-corner',
    name: 'Coin salon',
    category: 'prefabs',
    tags: ['salon', 'canapé', 'plante'],
    description: 'Canapé, pouf, table basse, plante.',
    kind: 'commands',
    commands: [
      { action: 'ADD_OBJECT', assetId: 'velvet-sofa', as: 'sofa' },
      { action: 'ADD_OBJECT', element: 'table', as: 'table', name: 'Table basse', size: [1.1, 0.42, 0.6], relation: { type: 'NEXT_TO', target: 'sofa', side: 'front', gap: 0.45, face: 'same' } },
      { action: 'ADD_OBJECT', assetId: 'vase-flowers', relation: { type: 'ON', target: 'table' } },
      { action: 'ADD_OBJECT', assetId: 'silk-pouf', relation: { type: 'NEXT_TO', target: 'table', side: 'front', gap: 0.4 } },
      { action: 'ADD_OBJECT', assetId: 'plant', relation: { type: 'NEXT_TO', target: 'sofa', side: 'right', gap: 0.15, face: 'same' } },
    ],
  },
  {
    id: 'street-corner',
    name: 'Coin de rue',
    category: 'prefabs',
    tags: ['rue', 'lampadaire', 'barrière', 'plante'],
    description: 'Lanterne sur potence, glissière béton et plante en pot.',
    kind: 'commands',
    commands: [
      { action: 'ADD_OBJECT', assetId: 'lantern', as: 'lantern' },
      { action: 'ADD_OBJECT', element: 'barrier', size: [2, 0.8, 0.5], as: 'barrier', relation: { type: 'NEXT_TO', target: 'lantern', side: 'right', gap: 0.3, face: 'same' } },
      { action: 'ADD_OBJECT', assetId: 'plant', relation: { type: 'NEXT_TO', target: 'barrier', side: 'right', gap: 0.3, face: 'same' } },
    ],
  },
];
