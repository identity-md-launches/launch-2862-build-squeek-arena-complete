export const HAMSTERS = [
  { id: 0, name: "Brown", fur: "#9a5b2e", belly: "#e8c7a4", ear: "#c98b66" },
  { id: 1, name: "White", fur: "#f7f2ea", belly: "#ffffff", ear: "#f0b8b8" },
  { id: 2, name: "Golden", fur: "#e2a42a", belly: "#f8e1a8", ear: "#d98763" },
] as const;

export type HamsterId = 0 | 1 | 2;

/**
 * A hamster on its wheel. `state` drives the CSS animation: "idle" jogs slowly, "run" sprints,
 * "stop" is still. All motion is CSS and stops under prefers-reduced-motion.
 */
export function HamsterWheel({ id, state }: { id: HamsterId; state: "idle" | "run" | "stop" }) {
  const h = HAMSTERS[id];
  const spokes = [0, 30, 60, 90, 120, 150];
  return (
    <svg className={`wheel wheel--${state}`} viewBox="0 0 120 120" role="img" aria-label={`${h.name} hamster on its wheel`}>
      <g className="wheel__ring">
        <circle cx="60" cy="58" r="50" fill="none" stroke="var(--wheel)" strokeWidth="5" />
        <circle cx="60" cy="58" r="44" fill="none" stroke="var(--wheel)" strokeWidth="1.5" strokeDasharray="3 6" />
        {spokes.map((a) => (
          <line key={a} x1="60" y1="58" x2={60 + 50 * Math.cos((a * Math.PI) / 180)} y2={58 + 50 * Math.sin((a * Math.PI) / 180)} stroke="var(--wheel)" strokeWidth="1.5" opacity="0.5" />
        ))}
        {spokes.map((a) => (
          <line key={`b${a}`} x1="60" y1="58" x2={60 - 50 * Math.cos((a * Math.PI) / 180)} y2={58 - 50 * Math.sin((a * Math.PI) / 180)} stroke="var(--wheel)" strokeWidth="1.5" opacity="0.5" />
        ))}
        <circle cx="60" cy="58" r="5" fill="var(--wheel)" />
      </g>
      <path d="M60 58 L44 116 M60 58 L76 116" stroke="var(--wheel)" strokeWidth="4" strokeLinecap="round" />
      <g className="wheel__hamster">
        <ellipse cx="60" cy="92" rx="21" ry="13" fill={h.fur} stroke="#3b2a1d" strokeWidth="1.5" />
        <ellipse cx="62" cy="96" rx="12" ry="7" fill={h.belly} />
        <circle cx="77" cy="85" r="10" fill={h.fur} stroke="#3b2a1d" strokeWidth="1.5" />
        <circle cx="73" cy="76" r="4" fill={h.ear} stroke="#3b2a1d" strokeWidth="1.2" />
        <circle cx="81" cy="83" r="1.8" fill="#1d140d" />
        <circle cx="86.5" cy="87" r="1.6" fill="#e58f8f" />
        <g className="wheel__legs" stroke="#3b2a1d" strokeWidth="2.4" strokeLinecap="round">
          <line x1="50" y1="102" x2="46" y2="106" />
          <line x1="68" y1="102" x2="72" y2="106" />
        </g>
      </g>
    </svg>
  );
}
