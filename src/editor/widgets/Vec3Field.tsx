import type { Vec3 } from '../../core/index.ts';
import { NumberField } from './NumberField.tsx';

interface Props {
  label: string;
  value: Vec3;
  onCommit: (value: Vec3) => void;
  disabled?: boolean;
  step?: number;
  precision?: number;
  /** Transformation appliquée à chaque composante validée (ex. interdire une échelle nulle). */
  sanitize?: (n: number) => number;
}

const AXES = ['X', 'Y', 'Z'] as const;

export function Vec3Field({ label, value, onCommit, disabled, step, precision, sanitize }: Props) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="vec3">
        {AXES.map((axis, i) => (
          <label key={axis} className={`vec3-cell axis-${axis.toLowerCase()}`}>
            <span className="axis-tag">{axis}</span>
            <NumberField
              value={value[i]}
              step={step}
              precision={precision}
              disabled={disabled}
              ariaLabel={`${label} ${axis}`}
              onCommit={(n) => {
                const next = [...value] as Vec3;
                next[i] = sanitize ? sanitize(n) : n;
                onCommit(next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
