import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of Service for Snake Arena, including demo mode, USDT matches, wallet rules, withdrawals, gameplay conduct, skins, and platform risk disclosures.',
  alternates: {
    canonical: '/terms',
  },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
