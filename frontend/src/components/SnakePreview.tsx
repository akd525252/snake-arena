'use client';

import { useEffect, useRef } from 'react';

interface Props {
  primaryColor: string;
  secondaryColor: string;
  skinKey: string;
  width?: number;
  height?: number;
  boost?: boolean;
}

const SEGMENT_COUNT = 22;
const HEAD_RADIUS = 22;
const BASE_RADIUS = 16;

/**
 * Animated SVG snake preview. The snake follows a sinusoidal path while keeping
 * within the viewBox so users see exactly how the skin will look in-game.
 *
 * All animated elements are updated directly via DOM manipulation in a
 * requestAnimationFrame loop (React JSX is rendered once on mount).
 */
export default function SnakePreview({
  primaryColor,
  secondaryColor,
  skinKey,
  width = 600,
  height = 280,
  boost = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const boostRef = useRef(boost);

  // Keep latest boost value accessible inside rAF without restart
  useEffect(() => {
    boostRef.current = boost;
  }, [boost]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Cache element refs once for fast updates
    const segs: SVGCircleElement[] = [];
    const auras: SVGCircleElement[] = [];
    const fires: SVGCircleElement[] = [];
    const circuits: SVGCircleElement[] = [];
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg = svg.querySelector<SVGCircleElement>(`#seg-${i}`);
      if (seg) segs.push(seg);
      const aura = svg.querySelector<SVGCircleElement>(`#aura-${i}`);
      if (aura) auras.push(aura);
      const circ = svg.querySelector<SVGCircleElement>(`#circ-${i}`);
      if (circ) circuits.push(circ);
    }
    for (let i = 0; i < 8; i++) {
      const fire = svg.querySelector<SVGCircleElement>(`#fire-${i}`);
      if (fire) fires.push(fire);
    }
    const eyeL = svg.querySelector<SVGCircleElement>('#eye-l');
    const eyeR = svg.querySelector<SVGCircleElement>('#eye-r');
    const pupilL = svg.querySelector<SVGCircleElement>('#pupil-l');
    const pupilR = svg.querySelector<SVGCircleElement>('#pupil-r');

    const animate = () => {
      tRef.current += boostRef.current ? 0.05 : 0.025;
      const t = tRef.current;

      // Snake body
      for (let i = 0; i < segs.length; i++) {
        const phase = t - i * 0.18;
        const cx = 60 + (i * (width - 120)) / (SEGMENT_COUNT - 1);
        const cy = height / 2 + Math.sin(phase) * (height * 0.22);
        segs[i].setAttribute('cx', cx.toString());
        segs[i].setAttribute('cy', cy.toString());

        // Aura (void shadow)
        if (auras[i]) {
          auras[i].setAttribute('cx', cx.toString());
          auras[i].setAttribute('cy', cy.toString());
          // Pulsing opacity for void effect
          const pulse = 0.3 + Math.sin(t * 2 + i * 0.3) * 0.15;
          auras[i].setAttribute('opacity', pulse.toString());
        }

        // Circuit dots (neon cyber)
        if (circuits[i]) {
          circuits[i].setAttribute('cx', cx.toString());
          circuits[i].setAttribute('cy', cy.toString());
          const op = 0.5 + Math.sin(t * 3 + i * 0.5) * 0.4;
          circuits[i].setAttribute('opacity', op.toString());
        }

        // Eyes follow head (last segment)
        if (i === SEGMENT_COUNT - 1 && eyeL && eyeR && pupilL && pupilR) {
          const dx = Math.cos(phase) * 6;
          eyeL.setAttribute('cx', (cx + 6).toString());
          eyeL.setAttribute('cy', (cy - 8).toString());
          eyeR.setAttribute('cx', (cx + 6).toString());
          eyeR.setAttribute('cy', (cy + 8).toString());
          pupilL.setAttribute('cx', (cx + 6 + dx * 0.3).toString());
          pupilL.setAttribute('cy', (cy - 8).toString());
          pupilR.setAttribute('cx', (cx + 6 + dx * 0.3).toString());
          pupilR.setAttribute('cy', (cy + 8).toString());
        }
      }

      // Fire trail (inferno) — particles trail behind the tail
      if (fires.length > 0) {
        const tailX = 60;
        const tailPhase = t - 0 * 0.18;
        const tailY = height / 2 + Math.sin(tailPhase) * (height * 0.22);
        for (let i = 0; i < fires.length; i++) {
          // Each particle shifts along its own sine wave with offset
          const off = i * 0.4 + t * 0.5;
          const px = tailX - 18 - i * 14 - Math.sin(off) * 4;
          const py = tailY - 8 + Math.sin(off * 1.7) * 10 - i * 1.5;
          fires[i].setAttribute('cx', px.toString());
          fires[i].setAttribute('cy', py.toString());
          // Flicker
          const flicker = 0.45 + Math.sin(t * 6 + i) * 0.25 - i * 0.05;
          fires[i].setAttribute('opacity', Math.max(0.05, flicker).toString());
          // Pulsate radius slightly
          const r = (9 - i) + Math.sin(t * 5 + i) * 1.2;
          fires[i].setAttribute('r', Math.max(2, r).toString());
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [width, height, skinKey]);

  // Skin-specific extra effects
  const isVoid = skinKey === 'void_shadow';
  const isInferno = skinKey === 'inferno_drake';
  const isCyber = skinKey === 'neon_cyber';

  return (
    <div className="relative inline-block w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        style={{ display: 'block' }}
      >
        <defs>
          {/* Body gradient */}
          <radialGradient id={`grad-${skinKey}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="1" />
            <stop offset="100%" stopColor={secondaryColor} stopOpacity="1" />
          </radialGradient>
          {/* Glow filter */}
          <filter id={`glow-${skinKey}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={isVoid ? 8 : 4} result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Fire glow filter */}
          <filter id={`fireglow-${skinKey}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background grid for arena feel */}
        <rect x="0" y="0" width={width} height={height} fill="#0a0a0a" />
        <g opacity="0.08">
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={`v-${i}`} x1={(width / 12) * i} y1="0" x2={(width / 12) * i} y2={height} stroke="#10b981" strokeWidth="1" />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={`h-${i}`} x1="0" y1={(height / 6) * i} x2={width} y2={(height / 6) * i} stroke="#10b981" strokeWidth="1" />
          ))}
        </g>

        {/* Void shadow aura — rendered behind body, animated via DOM */}
        {isVoid && (
          <g filter={`url(#glow-${skinKey})`}>
            {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
              const isHead = i === SEGMENT_COUNT - 1;
              const r = isHead ? HEAD_RADIUS + 10 : BASE_RADIUS + 8;
              return (
                <circle
                  key={`aura-${i}`}
                  id={`aura-${i}`}
                  r={r}
                  fill={secondaryColor}
                  opacity="0.4"
                  cx={60 + (i * (width - 120)) / (SEGMENT_COUNT - 1)}
                  cy={height / 2}
                />
              );
            })}
          </g>
        )}

        {/* Inferno fire trail — animated particles behind the tail */}
        {isInferno && (
          <g filter={`url(#fireglow-${skinKey})`}>
            {Array.from({ length: 8 }).map((_, i) => {
              const colors = ['#ffff00', '#ff8c00', '#ff4500', '#ff8c00', '#ffaa00', '#ff6600', '#ffcc00', '#ff5500'];
              return (
                <circle
                  key={`fire-${i}`}
                  id={`fire-${i}`}
                  r={9 - i}
                  fill={colors[i]}
                  opacity={0.5 - i * 0.05}
                  cx={60 - 18 - i * 14}
                  cy={height / 2}
                />
              );
            })}
          </g>
        )}

        {/* Snake body */}
        <g filter={isCyber ? `url(#glow-${skinKey})` : undefined}>
          {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
            const isHead = i === SEGMENT_COUNT - 1;
            const taper = 0.6 + (i / SEGMENT_COUNT) * 0.4;
            const r = isHead ? HEAD_RADIUS : BASE_RADIUS * taper;
            return (
              <circle
                key={`seg-${i}`}
                id={`seg-${i}`}
                r={r}
                fill={`url(#grad-${skinKey})`}
                stroke={primaryColor}
                strokeWidth="2"
                cx={60 + (i * (width - 120)) / (SEGMENT_COUNT - 1)}
                cy={height / 2}
              />
            );
          })}
        </g>

        {/* Cyber circuit pattern overlay — animated via DOM */}
        {isCyber && (
          <g pointerEvents="none">
            {Array.from({ length: SEGMENT_COUNT }).map((_, i) => (
              <circle
                key={`circ-${i}`}
                id={`circ-${i}`}
                r="3"
                fill="#fff"
                opacity="0.5"
                cx={60 + (i * (width - 120)) / (SEGMENT_COUNT - 1)}
                cy={height / 2}
              />
            ))}
          </g>
        )}

        {/* Eyes */}
        <circle id="eye-l" cx="0" cy="0" r="6" fill="#fff" />
        <circle id="eye-r" cx="0" cy="0" r="6" fill="#fff" />
        <circle id="pupil-l" cx="0" cy="0" r="3" fill="#000" />
        <circle id="pupil-r" cx="0" cy="0" r="3" fill="#000" />
      </svg>
    </div>
  );
}
