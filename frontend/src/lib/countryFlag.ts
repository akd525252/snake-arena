/**
 * Convert a 2-letter ISO 3166-1 alpha-2 country code to its emoji flag.
 * e.g. "PK" → "🇵🇰", "IN" → "🇮🇳", "US" → "🇺🇸"
 */
export function countryCodeToEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '';
  const upper = code.toUpperCase();
  const offset = 0x1F1E6 - 65; // 'A' = 65
  return String.fromCodePoint(upper.charCodeAt(0) + offset, upper.charCodeAt(1) + offset);
}

/**
 * Common country list for the flag picker (sorted by name).
 * Each entry: [ISO code, name]
 */
export const COUNTRY_LIST: [string, string][] = [
  ['AF', 'Afghanistan'],
  ['AL', 'Albania'],
  ['DZ', 'Algeria'],
  ['AR', 'Argentina'],
  ['AU', 'Australia'],
  ['AT', 'Austria'],
  ['BD', 'Bangladesh'],
  ['BE', 'Belgium'],
  ['BR', 'Brazil'],
  ['CA', 'Canada'],
  ['CL', 'Chile'],
  ['CN', 'China'],
  ['CO', 'Colombia'],
  ['HR', 'Croatia'],
  ['CZ', 'Czech Republic'],
  ['DK', 'Denmark'],
  ['EG', 'Egypt'],
  ['FI', 'Finland'],
  ['FR', 'France'],
  ['DE', 'Germany'],
  ['GH', 'Ghana'],
  ['GR', 'Greece'],
  ['HK', 'Hong Kong'],
  ['HU', 'Hungary'],
  ['IN', 'India'],
  ['ID', 'Indonesia'],
  ['IR', 'Iran'],
  ['IQ', 'Iraq'],
  ['IE', 'Ireland'],
  ['IL', 'Israel'],
  ['IT', 'Italy'],
  ['JP', 'Japan'],
  ['JO', 'Jordan'],
  ['KZ', 'Kazakhstan'],
  ['KE', 'Kenya'],
  ['KR', 'South Korea'],
  ['KW', 'Kuwait'],
  ['LB', 'Lebanon'],
  ['MY', 'Malaysia'],
  ['MX', 'Mexico'],
  ['MA', 'Morocco'],
  ['NL', 'Netherlands'],
  ['NZ', 'New Zealand'],
  ['NG', 'Nigeria'],
  ['NO', 'Norway'],
  ['OM', 'Oman'],
  ['PK', 'Pakistan'],
  ['PS', 'Palestine'],
  ['PE', 'Peru'],
  ['PH', 'Philippines'],
  ['PL', 'Poland'],
  ['PT', 'Portugal'],
  ['QA', 'Qatar'],
  ['RO', 'Romania'],
  ['RU', 'Russia'],
  ['SA', 'Saudi Arabia'],
  ['SG', 'Singapore'],
  ['ZA', 'South Africa'],
  ['ES', 'Spain'],
  ['LK', 'Sri Lanka'],
  ['SE', 'Sweden'],
  ['CH', 'Switzerland'],
  ['TW', 'Taiwan'],
  ['TH', 'Thailand'],
  ['TR', 'Turkey'],
  ['UA', 'Ukraine'],
  ['AE', 'United Arab Emirates'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
  ['UZ', 'Uzbekistan'],
  ['VN', 'Vietnam'],
];
