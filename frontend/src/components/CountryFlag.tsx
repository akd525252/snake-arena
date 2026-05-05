'use client';

/**
 * Renders an actual flag image for a 2-letter ISO country code.
 * Uses flagcdn.com (free, CDN-cached SVGs + PNGs).
 *
 * Why not emoji flags?
 *   - Windows doesn't ship emoji flag glyphs, so emoji flags render as
 *     text letters (e.g. "🇨🇳" becomes "CN") on most Windows browsers.
 *   - Using <img> gives us pixel-perfect flags on every OS/browser.
 *
 * @prop code  2-letter ISO code (case-insensitive) — falls back to empty div if invalid
 * @prop size  'sm' (16x12) | 'md' (24x18) | 'lg' (32x24) | 'xl' (48x36)
 */

import { useState } from 'react';

type FlagSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<FlagSize, { w: number; h: number; cdnW: number }> = {
  sm: { w: 16, h: 12, cdnW: 40 },
  md: { w: 24, h: 18, cdnW: 60 },
  lg: { w: 32, h: 24, cdnW: 80 },
  xl: { w: 48, h: 36, cdnW: 160 },
};

interface CountryFlagProps {
  code: string | null | undefined;
  size?: FlagSize;
  rounded?: boolean;
  className?: string;
  title?: string;
}

export default function CountryFlag({
  code,
  size = 'md',
  rounded = true,
  className = '',
  title,
}: CountryFlagProps) {
  const [failed, setFailed] = useState(false);
  if (!code || code.length !== 2) return null;

  const lower = code.toLowerCase();
  const { w, h, cdnW } = SIZE_MAP[size];
  // Fallback path: if the CDN image fails (e.g. offline), show just the code as letters
  if (failed) {
    return (
      <span
        className={`inline-flex items-center justify-center text-[10px] font-bold bg-[#3a2c1f] rpg-text ${rounded ? 'rounded' : ''} ${className}`}
        style={{ width: w, height: h }}
        title={title || code.toUpperCase()}
      >
        {code.toUpperCase()}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`https://flagcdn.com/w${cdnW}/${lower}.png`}
      srcSet={`https://flagcdn.com/w${cdnW * 2}/${lower}.png 2x`}
      alt={code.toUpperCase()}
      title={title || code.toUpperCase()}
      width={w}
      height={h}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`inline-block object-cover ${rounded ? 'rounded-sm' : ''} ${className}`}
      style={{ width: w, height: h }}
    />
  );
}
