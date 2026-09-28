/**
 * Taxonomie de la bibliothèque. Les identifiants sont stables (utilisés dans le
 * manifest et les scènes) ; les libellés sont ceux de l'interface.
 * Une catégorie n'est affichée que si elle contient au moins un élément.
 */
export interface CategoryGroup {
  id: string;
  label: string;
  children?: { id: string; label: string }[];
}

export const CATEGORY_TREE: CategoryGroup[] = [
  { id: 'primitives', label: 'Primitives' },
  {
    id: 'architecture',
    label: 'Architecture',
    children: [
      { id: 'architecture.buildings', label: 'Bâtiments' },
      { id: 'architecture.floors', label: 'Sols' },
      { id: 'architecture.walls', label: 'Murs' },
      { id: 'architecture.doors', label: 'Portes' },
      { id: 'architecture.windows', label: 'Fenêtres' },
      { id: 'architecture.stairs', label: 'Escaliers' },
    ],
  },
  {
    id: 'urban',
    label: 'Urbain',
    children: [
      { id: 'urban.roads', label: 'Routes' },
      { id: 'urban.sidewalks', label: 'Trottoirs' },
      { id: 'urban.lighting', label: 'Éclairage public' },
      { id: 'urban.barriers', label: 'Barrières' },
    ],
  },
  {
    id: 'props',
    label: 'Objets',
    children: [
      { id: 'props.furniture', label: 'Mobilier' },
      { id: 'props.electronics', label: 'Électronique' },
      { id: 'props.objects', label: 'Accessoires' },
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    children: [
      { id: 'nature.trees', label: 'Arbres' },
      { id: 'nature.plants', label: 'Plantes' },
    ],
  },
  { id: 'vehicles', label: 'Véhicules' },
  { id: 'characters', label: 'Personnages' },
  { id: 'lights', label: 'Lumières' },
  { id: 'prefabs', label: 'Prefabs' },
  { id: 'cameras', label: 'Caméras' },
];

const LABELS = new Map<string, string>();
for (const g of CATEGORY_TREE) {
  LABELS.set(g.id, g.label);
  for (const c of g.children ?? []) LABELS.set(c.id, c.label);
}

export const isKnownCategory = (id: string) => LABELS.has(id);
export const categoryLabel = (id: string | undefined) => (id && LABELS.get(id)) || 'Autres';
/** Groupe de premier niveau d'une catégorie ("props.furniture" → "props"). */
export const topLevelCategory = (id: string) => id.split('.')[0];
