'use client';

/**
 * Snake Arena animated logo.
 *
 * A coiled snake (rendered as an SVG path) sits inside a flame-tinted
 * circular arena ring. The snake's body has subtle scale highlights and the
 * surrounding ring has two concentric "torch" glows. Two CSS animations
 * drive the whole thing:
 *   - `sa-logo-rotate`  — the outer ring slowly rotates
 *   - `sa-logo-pulse`   — the inner glow breathes
 *
 * Sizes are responsive via the `size` prop. Default 64px is good for nav
 * bars; pass 128/256+ for hero areas / loaders.
 *
 * Pure SVG + CSS — no images, no canvas, ~3KB rendered. Works on every
 * device, including very low-end mobiles. Honors `prefers-reduced-motion`
 * automatically (animations stop) via the global stylesheet.
 */
type LogoProps = {
  /** Pixel size of the rendered SVG (square). Default 64. */
  size?: number;
  /** When true, the logo skips animations (handy for static OG-card use). */
  static?: boolean;
  /** Optional className for layout / spacing. */
  className?: string;
};

export default function Logo({ size = 64, static: isStatic = false, className }: LogoProps) {
  const animClass = isStatic ? '' : 'sa-logo-animated';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Snake Arena logo"
      className={`${animClass} ${className ?? ''}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Body gradient — torch gold to ember red */}
        <linearGradient id="sa-snake-body" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffd96b" />
          <stop offset="50%" stopColor="#f0913a" />
          <stop offset="100%" stopColor="#a8341a" />
        </linearGradient>

        {/* Ring gradient — two-tone torch */}
        <linearGradient id="sa-ring" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4a04a" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#962323" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#d4a04a" stopOpacity="0.95" />
        </linearGradient>

        {/* Glow filter for the inner ring */}
        <filter id="sa-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Outer rotating arena ring ─────────────────────────────────── */}
      <g className="sa-ring-rotate">
        {/* Dashed outer ring (rotates) */}
        <circle
          cx="100"
          cy="100"
          r="92"
          fill="none"
          stroke="url(#sa-ring)"
          strokeWidth="3"
          strokeDasharray="8 4"
          opacity="0.85"
        />
        {/* Four orbital nodes (also rotate with the group) */}
        <circle cx="100" cy="8" r="4" fill="#f5c265" />
        <circle cx="192" cy="100" r="4" fill="#f5c265" />
        <circle cx="100" cy="192" r="4" fill="#f5c265" />
        <circle cx="8" cy="100" r="4" fill="#f5c265" />
      </g>

      {/* ── Inner solid ring with breathing glow ──────────────────────── */}
      <circle
        cx="100"
        cy="100"
        r="78"
        fill="none"
        stroke="#a86a3a"
        strokeWidth="2"
        opacity="0.6"
        className="sa-ring-pulse"
        filter="url(#sa-glow)"
      />

      {/* ── Coiled snake body ─────────────────────────────────────────── */}
      {/* The path forms an "S" coil: tail wraps from bottom-left around the
          center, exits top-right with the head facing forward. */}
      <path
        d="M60 145
           Q35 120 50 95
           Q75 70 100 85
           Q130 100 130 75
           Q130 50 105 50
           Q85 50 80 60"
        fill="none"
        stroke="url(#sa-snake-body)"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Body highlight (lighter, narrower stroke on top of the main path) */}
      <path
        d="M60 145
           Q35 120 50 95
           Q75 70 100 85
           Q130 100 130 75
           Q130 50 105 50
           Q85 50 80 60"
        fill="none"
        stroke="#fff48c"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />

      {/* ── Snake head ────────────────────────────────────────────────── */}
      <g>
        {/* Head outline */}
        <ellipse
          cx="80"
          cy="60"
          rx="14"
          ry="11"
          fill="url(#sa-snake-body)"
          stroke="#5a1a0a"
          strokeWidth="1.5"
        />
        {/* Eye */}
        <circle cx="76" cy="58" r="3" fill="#0e0a08" />
        <circle cx="75" cy="57" r="1" fill="#fff48c" />
        {/* Forked tongue (red) */}
        <path
          d="M68 62 L60 64 L62 66 M60 64 L62 62"
          stroke="#d83a3a"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          className="sa-tongue-flick"
        />
      </g>

      {/* ── Tail tip (small flame embers) ─────────────────────────────── */}
      <g className="sa-tail-flame">
        <circle cx="58" cy="148" r="3" fill="#f5c265" opacity="0.9" />
        <circle cx="54" cy="152" r="2" fill="#f0913a" opacity="0.7" />
        <circle cx="51" cy="156" r="1.5" fill="#a8341a" opacity="0.5" />
      </g>
    </svg>
  );
}
