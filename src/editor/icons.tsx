/** Petites icônes SVG inline (aucune dépendance d'icônes). */
import type { SceneObjectType } from '../core/index.ts';

type IconProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconCube = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8z" />
    <path d="M2.5 4.8 8 7.8l5.5-3M8 7.8v6.4" />
  </svg>
);

export const IconSphere = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="5.8" />
    <ellipse cx="8" cy="8" rx="5.8" ry="2.2" />
  </svg>
);

export const IconLight = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </svg>
);

export const IconCamera = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="1.8" y="4.5" width="8.5" height="7" rx="1.2" />
    <path d="m10.3 7 3.9-2v6l-3.9-2" />
  </svg>
);

export const IconEye = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

export const IconEyeOff = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2.5 2.5l11 11M6.5 4a6 6 0 0 1 1.5-.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.7 2.2M10.8 11.8A6 6 0 0 1 8 12.5C4 12.5 1.5 8 1.5 8a11 11 0 0 1 2.4-2.9" />
  </svg>
);

export const IconLock = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="7" width="10" height="7" rx="1.2" />
    <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" />
  </svg>
);

export const IconUnlock = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="7" width="10" height="7" rx="1.2" />
    <path d="M5.2 7V5a2.8 2.8 0 0 1 5.4-1" />
  </svg>
);

export const IconUndo = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 3 2 6l3 3" />
    <path d="M2 6h7.5a4 4 0 0 1 0 8H6" />
  </svg>
);

export const IconRedo = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m11 3 3 3-3 3" />
    <path d="M14 6H6.5a4 4 0 0 0 0 8H10" />
  </svg>
);

export const IconMove = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 1.5v13M1.5 8h13M8 1.5 6.2 3.3M8 1.5l1.8 1.8M8 14.5l-1.8-1.8M8 14.5l1.8-1.8M1.5 8l1.8-1.8M1.5 8l1.8 1.8M14.5 8l-1.8-1.8M14.5 8l-1.8 1.8" />
  </svg>
);

export const IconRotate = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M13.5 8A5.5 5.5 0 1 1 11.6 3.8" />
    <path d="M13.2 1.8v3h-3" />
  </svg>
);

export const IconScale = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2" y="7" width="7" height="7" rx="0.8" />
    <path d="M9 2h5v5M14 2 8.5 7.5" />
  </svg>
);

export const IconHome = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2 7.5 8 2.5l6 5M3.8 6.2V13.5h8.4V6.2" />
  </svg>
);

export const IconTarget = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

export const IconCopy = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="5" y="5" width="9" height="9" rx="1.2" />
    <path d="M11 5V3.2A1.2 1.2 0 0 0 9.8 2H3.2A1.2 1.2 0 0 0 2 3.2v6.6A1.2 1.2 0 0 0 3.2 11H5" />
  </svg>
);

export const IconTrash = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
  </svg>
);

export const IconFile = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 1.8H4a1.2 1.2 0 0 0-1.2 1.2v10A1.2 1.2 0 0 0 4 14.2h8a1.2 1.2 0 0 0 1.2-1.2V6z" />
    <path d="M9 1.8V6h4.2" />
  </svg>
);

export const IconOpen = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M1.8 12.5V3.5a1 1 0 0 1 1-1h3.4l1.6 1.7h5.4a1 1 0 0 1 1 1v1.3" />
    <path d="M1.8 12.5 3.6 7h11l-1.8 5.5z" />
  </svg>
);

export const IconSave = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 2v8M4.8 7 8 10.2 11.2 7M2.5 11.5v1.8h11v-1.8" />
  </svg>
);

export const IconModel = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8z" />
    <path d="M2.5 4.8 8 7.8l5.5-3M8 7.8v6.4M5.2 3.3l5.5 3" />
  </svg>
);

export const IconImport = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 10V2M4.8 6.8 8 10l3.2-3.2" />
    <path d="M2.5 10.5v3h11v-3" />
  </svg>
);

export const IconGround = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="5" y="3" width="6" height="6" rx="0.8" />
    <path d="M8 9.5v2.2M6.5 10.5 8 12l1.5-1.5M1.5 14h13" />
  </svg>
);

export const IconWarning = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 2 14.5 13.5h-13z" />
    <path d="M8 6.5v3.2M8 11.6v.2" />
  </svg>
);

export const IconGroup = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.5" strokeDasharray="2 1.6" />
    <rect x="4.2" y="4.2" width="3.6" height="3.6" rx="0.6" />
    <rect x="8.4" y="8.4" width="3.6" height="3.6" rx="0.6" />
  </svg>
);

export const IconUngroup = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2" y="2" width="5" height="5" rx="0.8" />
    <rect x="9" y="9" width="5" height="5" rx="0.8" />
    <path d="M9 4.5h3.5V7M7 11.5H3.5V9" />
  </svg>
);

export const IconElement = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2 13.5h12M3.5 13.5V4.5h9v9M6.5 13.5V9.5h3v4" />
  </svg>
);

export const IconMagnet = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3.5 2.5v5.5a4.5 4.5 0 0 0 9 0V2.5h-3v5.5a1.5 1.5 0 0 1-3 0V2.5z" />
    <path d="M3.5 5h3M9.5 5h3" />
  </svg>
);

export const IconCheck = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
);

export const IconChevron = ({ size = 14, open = false }: IconProps & { open?: boolean }) => (
  <svg {...base(size)} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.12s' }}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

export const IconSearch = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3.5 3.5" />
  </svg>
);

export const IconPrefab = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2" y="7" width="5" height="6.5" rx="0.8" />
    <rect x="9" y="7" width="5" height="6.5" rx="0.8" />
    <path d="M4.5 7V3.5h7V7" />
  </svg>
);

export const IconCode = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 2.5 7 13.5" />
  </svg>
);

export const IconShield = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 1.8 13.2 3.8v4.1c0 3-2.2 5.3-5.2 6.3-3-1-5.2-3.3-5.2-6.3V3.8z" />
    <path d="m5.6 8 1.8 1.8L10.6 6.3" />
  </svg>
);

export function ObjectTypeIcon({ type, size = 14 }: { type: SceneObjectType; size?: number }) {
  switch (type) {
    case 'box':
      return <IconCube size={size} />;
    case 'sphere':
      return <IconSphere size={size} />;
    case 'light':
      return <IconLight size={size} />;
    case 'camera':
      return <IconCamera size={size} />;
    case 'model':
      return <IconModel size={size} />;
    case 'group':
      return <IconGroup size={size} />;
    case 'element':
      return <IconElement size={size} />;
  }
}

export const TYPE_LABEL: Record<SceneObjectType, string> = {
  box: 'Cube',
  sphere: 'Sphère',
  light: 'Lumière ponctuelle',
  camera: 'Caméra',
  model: 'Modèle 3D',
  group: 'Groupe',
  element: 'Élément paramétrique',
};
