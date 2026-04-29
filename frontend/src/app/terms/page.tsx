import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of Service for Snake Arena, including demo mode, USDT matches, wallet rules, withdrawals, gameplay conduct, skins, and platform risk disclosures.',
  alternates: {
    canonical: '/terms',
  },
};

const sections = [
  {
    title: 'Acceptance of Terms',
    body: [
      'By accessing or using Snake Arena, you agree to these Terms of Service and any platform rules shown in the game, wallet, match, or account screens.',
      'If you do not agree, do not create an account, deposit funds, enter matches, or use the platform.',
    ],
  },
  {
    title: 'Eligibility and Local Laws',
    body: [
      'You are responsible for ensuring that your use of Snake Arena is lawful in your location, including rules related to online games, contests, crypto assets, payments, and withdrawals.',
      'You must not use the platform if you are prohibited by applicable law, sanctions rules, payment restrictions, age restrictions, or platform policy.',
    ],
  },
  {
    title: 'Demo Mode',
    body: [
      'Demo mode is for practice and entertainment. Demo balances, demo winnings, and demo rewards are simulated, have no cash value, and cannot be withdrawn.',
      'Snake Arena may reset, adjust, or limit demo balances and demo activity at any time to protect the experience and prevent abuse.',
    ],
  },
  {
    title: 'Pro Mode, USDT Matches, and Gameplay Risk',
    body: [
      'Pro mode may involve USDT deposits, wallet balances, match entry amounts, skill costs, winnings, losses, and withdrawals where enabled.',
      'Entering a match may deduct the selected bet amount. Gameplay outcomes depend on skill, timing, network conditions, other players, bots where disclosed by game design, and game rules.',
      'You understand that you can lose match entry amounts and in-game value during gameplay. Do not deposit or play with funds you cannot afford to lose.',
    ],
  },
  {
    title: 'Wallet Ledger, Deposits, and Withdrawals',
    body: [
      'Wallet balances are calculated from ledger records. Deposits, match charges, skill costs, wins, refunds, withdrawals, and manual adjustments may appear as wallet transactions.',
      'Deposits may depend on third-party payment providers and blockchain confirmations. Delays, fees, network congestion, address mistakes, or provider issues may occur.',
      'Withdrawals may require minimum amounts, account review, security checks, manual approval, cooling-off periods, and compliance checks. Withdrawal requests may be delayed, rejected, or canceled where necessary to protect the platform.',
    ],
  },
  {
    title: 'Accounts and Security',
    body: [
      'You are responsible for keeping your login credentials, wallet information, browser session, and device secure.',
      'You must provide accurate account information and must not impersonate another person, sell accounts, transfer accounts, or use unauthorized access methods.',
    ],
  },
  {
    title: 'Fair Play and Prohibited Conduct',
    body: [
      'You must not cheat, exploit bugs, manipulate matchmaking, use bots or automation, reverse engineer the client or server, attack the network, abuse payments, launder funds, or interfere with other players.',
      'Snake Arena may suspend accounts, void matches, reverse abusive transactions, freeze withdrawals, or ban users when fraud, cheating, exploitation, or suspicious activity is detected.',
    ],
  },
  {
    title: 'Skins and Digital Items',
    body: [
      'Skins and cosmetic items are digital features for use inside Snake Arena. They do not represent ownership of intellectual property, securities, financial products, or external assets unless expressly stated.',
      'Purchases may be final except where refunds are required by law or approved by the platform.',
    ],
  },
  {
    title: 'Service Availability',
    body: [
      'Snake Arena may experience downtime, updates, bugs, latency, data delays, blockchain delays, or maintenance. We may modify, suspend, or discontinue features when needed.',
      'We are not responsible for losses caused by events outside our reasonable control, including network failures, wallet provider issues, blockchain congestion, browser crashes, or unauthorized third-party actions.',
    ],
  },
  {
    title: 'Limitation of Liability',
    body: [
      'To the maximum extent permitted by law, Snake Arena is provided as is and as available. We do not guarantee uninterrupted service, winnings, profits, matchmaking availability, withdrawal timing, or error-free gameplay.',
      'Our liability is limited to the maximum extent allowed by applicable law.',
    ],
  },
  {
    title: 'Changes to These Terms',
    body: [
      'We may update these Terms as the platform evolves. Continued use after updates means you accept the revised Terms.',
    ],
  },
  {
    title: 'Contact',
    body: [
      'For support, disputes, wallet questions, or Terms-related requests, contact the Snake Arena support team through the official support channel provided on the platform.',
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#05050a] text-[#e0e0e8] px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <Link href="/" className="inline-flex items-center text-sm text-[#8a8a9a] hover:text-[#00f0ff] mb-8">
          ← Back to Snake Arena
        </Link>

        <div className="rounded-3xl border border-[#1a1a2e] bg-[#0a0a12]/90 p-8 md:p-10 glow-border-cyan">
          <div className="inline-flex px-3 py-1 rounded-full bg-[#ff2e63]/10 border border-[#ff2e63]/20 text-[#ff2e63] text-xs font-bold mb-5">
            Legal
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">Terms of Service</h1>
          <p className="text-[#8a8a9a] leading-7 mb-2">
            These Terms govern your use of Snake Arena, including accounts, demo mode, pro mode, USDT deposits, withdrawals, multiplayer matches, skins, skills, wallets, and related services.
          </p>
          <p className="text-sm text-[#6a6a7a]">Last updated: April 29, 2026</p>
        </div>

        <div className="mt-8 space-y-5">
          {sections.map(section => (
            <section key={section.title} className="rounded-2xl border border-[#1a1a2e] bg-[#0a0a12] p-6">
              <h2 className="text-xl font-black text-white mb-4">{section.title}</h2>
              <ul className="space-y-3 text-[#b0b0c0] leading-7">
                {section.body.map(item => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-2 w-2 rounded-full bg-[#ff2e63] flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-[#ffb800]/20 bg-[#ffb800]/10 p-6 text-[#ffcc33] text-sm leading-7">
          These Terms are a strong starting point but should be reviewed by a qualified legal professional before public launch, especially because your platform includes crypto payments, withdrawals, skill-based matches, and regional compliance considerations.
        </div>
      </div>
    </main>
  );
}
