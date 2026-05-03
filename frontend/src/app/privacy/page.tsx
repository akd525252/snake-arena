'use client';

import Link from 'next/link';
import { useI18n } from '../../contexts/I18nContext';

const sections = [
  {
    title: 'Information We Collect',
    body: [
      'Account information such as email address, username, avatar, authentication identifiers, and account settings.',
      'Gameplay information such as game mode, match entries, bet amount, score, placement, coin collection, skill usage, and match history.',
      'Wallet and transaction information such as ledger entries, deposits, withdrawals, balances, transaction status, and withdrawal approval history.',
      'Technical information such as device type, browser, IP-derived security signals, logs, crash reports, and connection data needed to operate real-time multiplayer gameplay.',
    ],
  },
  {
    title: 'How We Use Information',
    body: [
      'To operate Snake Arena, authenticate users, maintain wallet ledgers, process demo and pro match activity, and show match results.',
      'To protect the platform from fraud, abuse, unauthorized access, duplicate accounts, payment misuse, and gameplay manipulation.',
      'To improve performance, matchmaking, user experience, game balancing, support, and security monitoring.',
      'To comply with legal, accounting, dispute, payment, and withdrawal review obligations where applicable.',
    ],
  },
  {
    title: 'Payments, Wallets, and Third Parties',
    body: [
      'Snake Arena may use third-party services such as Supabase for authentication and database infrastructure and crypto payment providers for USDT deposit processing.',
      'Payment providers may collect wallet addresses, transaction hashes, blockchain data, and other payment-related information under their own policies.',
      'Blockchain transactions may be public and cannot always be deleted, reversed, or hidden by Snake Arena.',
    ],
  },
  {
    title: 'Demo Mode',
    body: [
      'Demo mode uses simulated funds for practice and entertainment. Demo balances, demo winnings, and demo rewards have no cash value and cannot be withdrawn.',
      'We may store demo gameplay activity to show stats, improve onboarding, and help users understand the game before using pro mode.',
    ],
  },
  {
    title: 'Data Sharing',
    body: [
      'We do not sell personal information. We share information only with service providers, infrastructure vendors, payment processors, fraud prevention tools, legal authorities where required, or as needed to operate the platform.',
      'Public gameplay elements such as username, avatar, score, placement, and selected skin may be visible to other players during matches and leaderboards if enabled.',
    ],
  },
  {
    title: 'Security and Retention',
    body: [
      'We use reasonable technical and organizational safeguards to protect account, wallet, and gameplay data. No internet service can guarantee absolute security.',
      'We keep information as long as needed to provide the service, maintain wallet ledgers, prevent fraud, resolve disputes, satisfy legal obligations, and improve the platform.',
    ],
  },
  {
    title: 'Your Choices',
    body: [
      'You may update your profile information, sign out, and request support for account-related questions.',
      'Some wallet, ledger, withdrawal, payment, and security records may need to be retained for compliance, dispute resolution, fraud prevention, or platform integrity.',
    ],
  },
  {
    title: 'Contact',
    body: [
      'If you have privacy questions or requests, contact the Snake Arena support team through the official support channel provided on the platform.',
    ],
  },
];

function PrivacyPageInner() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-[#1a1410] px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <Link href="/" className="inline-flex items-center text-sm rpg-text-muted hover:rpg-gold-bright mb-8">
          ← {t.legal.backToGame}
        </Link>

        <div className="rpg-panel p-8 md:p-10">
          <div className="inline-flex px-3 py-1 rounded-md border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright text-xs font-rpg-heading tracking-widest mb-5">
            {t.legal.legal}
          </div>
          <h1 className="rpg-title text-4xl md:text-5xl mb-4">{t.legal.privacyPolicy}</h1>
          <p className="rpg-text leading-7 mb-2">
            This Privacy Policy explains how Snake Arena collects, uses, shares, and protects information when you use our multiplayer snake game, demo mode, wallet features, skins, deposits, withdrawals, and related services.
          </p>
          <p className="text-sm rpg-text-muted">{t.legal.lastUpdated}: April 29, 2026</p>
        </div>

        <div className="mt-8 space-y-5">
          {sections.map(section => (
            <section key={section.title} className="rpg-panel p-6">
              <h2 className="rpg-title text-2xl mb-4">{section.title}</h2>
              <ul className="space-y-3 rpg-text leading-7">
                {section.body.map(item => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-2 w-2 rounded-full bg-[#d4a04a] flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-8 rpg-parchment-inset p-6 rpg-gold-bright text-sm leading-7">
          This policy is a platform-specific starting point and should be reviewed by a qualified legal professional before public launch, especially if you operate in regions with gaming, gambling, crypto, consumer protection, or data protection requirements.
        </div>
      </div>
    </main>
  );
}

export default function PrivacyPage() {
  return <PrivacyPageInner />;
}
