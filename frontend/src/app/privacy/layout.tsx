import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for Snake Arena, including account data, wallet activity, gameplay data, payments, security, and user rights.',
  alternates: {
    canonical: '/privacy',
  },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
