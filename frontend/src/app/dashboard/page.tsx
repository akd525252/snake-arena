'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { api, Transaction, Skin } from '../../lib/api';
import ModeSelectionModal from '../../components/ModeSelectionModal';
import Loader from '../../components/Loader';
import Logo from '../../components/Logo';
import Leaderboard from '../../components/Leaderboard';
import LanguageSwitcher from '../../components/LanguageSwitcher';

export default function Dashboard() {
  const router = useRouter();
  const { user, loading, signOut, refreshUser } = useAuth();
  const { t } = useI18n();
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [betAmount, setBetAmount] = useState(10);
  const [refreshing, setRefreshing] = useState(false);
  const [modeModalDismissed, setModeModalDismissed] = useState(false);
  const [skins, setSkins] = useState<Skin[]>([]);
  const [ownedSkinIds, setOwnedSkinIds] = useState<Set<string>>(new Set());
  const [equippedSkinId, setEquippedSkinId] = useState<string | null>(null);

  async function loadWalletData() {
    try {
      const [b, t] = await Promise.all([
        api.getBalance(),
        api.getTransactions(1, 10),
      ]);
      setBalance(b.balance);
      setTransactions(t.transactions);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await loadWalletData();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    void (async () => {
      try {
        const [b, t, all, my] = await Promise.all([
          api.getBalance(),
          api.getTransactions(1, 10),
          api.getSkins(),
          api.getMySkins(),
        ]);

        if (cancelled) return;

        setBalance(b.balance);
        setTransactions(t.transactions);
        setSkins(all.skins);
        setOwnedSkinIds(new Set(my.owned.map(s => s.id)));
        setEquippedSkinId(my.equippedSkinId);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      }
    })();

    void refreshUser();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (loading || !user) {
    return <Loader message={t.common.loading} />;
  }

  const showModeModal = !modeModalDismissed && !user.game_mode;
  const isDemo = user.game_mode === 'demo';
  const demoBalance = user.demo_balance ?? 50;
  const activeBet = Math.max(1, Number.isFinite(betAmount) ? betAmount : 1);
  const activeBalance = isDemo ? demoBalance : balance;
  const canStartMatch = activeBalance >= activeBet;
  const playHref = isDemo ? `/demo?bet=${activeBet}` : `/play?bet=${activeBet}`;
  const playLabel = isDemo ? t.dashboard.launchDemoArena : t.dashboard.findRankedMatch;
  const modeLabel = isDemo ? t.dashboard.practiceArena : t.dashboard.rankedArena;
  const equippedSkin = skins.find(s => s.id === equippedSkinId);
  const userInitial = (user.username || user.email || 'S').charAt(0).toUpperCase();

  return (
    <div className="relative flex flex-col flex-1 min-h-screen overflow-hidden bg-[#1a1410]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'linear-gradient(rgba(212,160,74,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(212,160,74,0.35) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div className={`pointer-events-none absolute -top-32 left-8 h-80 w-80 rounded-full blur-3xl ${isDemo ? 'bg-[#d4a04a]/15' : 'bg-[#962323]/15'}`} />
      <div className="pointer-events-none absolute top-40 right-0 h-96 w-96 rounded-full bg-[#a86a3a]/10 blur-3xl" />

      {/* Mode selection modal (first-time users) */}
      {showModeModal && (
        <ModeSelectionModal
          onSelected={() => {
            setModeModalDismissed(true);
            refreshUser();
          }}
        />
      )}

      {/* Demo banner */}
      {isDemo && (
        <div className="relative z-10 bg-[#3a2c1f]/60 border-b border-[#a86a3a]/30 px-4 py-2 text-center text-sm">
          <span className="rpg-gold-bright font-rpg-heading tracking-widest">{t.dashboard.demoMode}</span>
          <span className="rpg-text-muted ml-2">{t.dashboard.practiceWithFunds} &middot; </span>
          <button
            onClick={async () => {
              await api.setGameMode('pro');
              refreshUser();
            }}
            className="rpg-gold underline hover:rpg-gold-bright font-rpg-heading"
          >
            {t.dashboard.upgradeToPro}
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="relative z-10 flex justify-between items-center px-4 sm:px-6 lg:px-8 py-4 border-b border-[#3a2c1f] bg-[#0e0a08]/80 backdrop-blur">
        <Link href="/" className="flex items-center gap-3 min-w-0">
          <Logo size={44} />
          <div className="min-w-0">
            <div className="rpg-title text-lg sm:text-xl truncate">Snake Arena</div>
            <div className="hidden sm:block text-xs rpg-text-muted">{t.dashboard.multiplayerArena}</div>
          </div>
          <span className={`hidden sm:inline-flex px-2.5 py-1 rounded-md text-[10px] font-black border tracking-widest font-rpg-heading ${
            isDemo
              ? 'border-[#a86a3a] bg-[#3a2c1f] text-[#f5c265]'
              : 'border-[#962323] bg-[#2a0e0e] text-[#d83a3a]'
          }`}>
            {isDemo ? t.dashboard.demo.toUpperCase() : t.dashboard.pro.toUpperCase()}
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <LanguageSwitcher position="inline" />
          {user.is_admin && (
            <Link href="/admin" className="hidden sm:inline text-sm rpg-text-muted hover:rpg-gold-bright font-rpg-heading tracking-wider">
              {t.dashboard.admin}
            </Link>
          )}
          <Link
            href="/profile"
            className="flex items-center gap-2 text-sm rpg-text-muted hover:rpg-gold-bright group"
          >
            <span className={`w-9 h-9 rounded-full overflow-hidden border-2 transition-colors flex-shrink-0 ${
              isDemo ? 'border-[#a86a3a]' : 'border-[#d4a04a]'
            }`}>
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${
                  isDemo ? 'from-[#d4a04a] to-[#a86a3a]' : 'from-[#962323] to-[#4a0c0c]'
                } text-[#0e0a08] font-black text-sm`}>
                  {userInitial}
                </span>
              )}
            </span>
            <span className="hidden md:inline max-w-40 truncate">{user.username || user.email}</span>
          </Link>
          <button
            onClick={signOut}
            className="text-sm rpg-text-muted hover:text-[#d83a3a] font-rpg-heading tracking-wider"
          >
            {t.dashboard.signOut}
          </button>
        </div>
      </nav>

      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Balance & Quick Play */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr] gap-6">
          {/* Banner: Hero panel */}
          <div className="rpg-panel relative overflow-hidden p-6 md:p-8">
            <div className="relative z-10 flex flex-col xl:flex-row xl:items-end justify-between gap-8">
              <div className="space-y-6">
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-black tracking-widest font-rpg-heading ${
                  isDemo
                    ? 'border border-[#a86a3a] bg-[#3a2c1f] text-[#f5c265]'
                    : 'border border-[#962323] bg-[#2a0e0e] text-[#d83a3a]'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${isDemo ? 'bg-[#f5c265]' : 'bg-[#d83a3a]'} animate-pulse`} />
                  {modeLabel}
                </div>
                <div>
                  <h1 className="rpg-title text-3xl md:text-5xl">
                    {t.dashboard.welcomeUser}, {user.username || user.email.split('@')[0]}
                  </h1>
                  <p className="mt-2 rpg-text-muted max-w-2xl">
                    {t.dashboard.welcomeDesc}
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rpg-stone-panel p-4">
                    <div className="text-[11px] uppercase tracking-[0.15em] rpg-text-muted">{t.dashboard.balance}</div>
                    <div className="mt-1 text-2xl font-black rpg-gold-bright">${activeBalance.toFixed(2)}</div>
                    <div className="text-xs font-bold rpg-text-muted">{isDemo ? t.dashboard.demo.toUpperCase() : 'USDT'}</div>
                  </div>
                  <div className="rpg-stone-panel p-4">
                    <div className="text-[11px] uppercase tracking-[0.15em] rpg-text-muted">{t.play.bet}</div>
                    <div className="mt-1 text-2xl font-black rpg-text">${activeBet}</div>
                    <div className="text-xs font-bold rpg-text-muted">{t.dashboard.current}</div>
                  </div>
                  <div className="rpg-stone-panel p-4">
                    <div className="text-[11px] uppercase tracking-[0.15em] rpg-text-muted">{t.dashboard.arena}</div>
                    <div className="mt-1 text-2xl font-black rpg-text">10</div>
                    <div className="text-xs font-bold rpg-text-muted">{t.dashboard.maxPlayers}</div>
                  </div>
                  <div className="rpg-stone-panel p-4">
                    <div className="text-[11px] uppercase tracking-[0.15em] rpg-text-muted">{t.dashboard.coin}</div>
                    <div className="mt-1 text-2xl font-black rpg-gold">$0.10</div>
                    <div className="text-xs font-bold rpg-text-muted">{t.dashboard.value}</div>
                  </div>
                </div>
              </div>
              <div className="xl:w-72 rpg-stone-panel p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <div className="text-xs rpg-text-muted tracking-widest uppercase">{t.dashboard.status}</div>
                    <div className="font-black rpg-gold-bright text-lg">{t.dashboard.ready}</div>
                  </div>
                  <div className="h-12 w-12 rounded-md flex items-center justify-center rpg-panel">
                    <span className="rpg-title text-xl">{userInitial}</span>
                  </div>
                </div>
                <div className="space-y-3 rpg-parchment-inset p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm rpg-text-muted">{t.dashboard.mode}</span>
                    <span className={`text-sm font-black ${isDemo ? 'rpg-gold-bright' : 'rpg-crimson'}`}>{isDemo ? t.dashboard.demo : t.dashboard.pro}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm rpg-text-muted">{t.dashboard.balance}</span>
                    <span className="text-sm font-black rpg-text">${activeBalance.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm rpg-text-muted">{t.play.bet}</span>
                    <span className="text-sm font-black rpg-text">${activeBet}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Play */}
          <div className="rpg-panel p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="rpg-subtitle text-xs">
                  {t.dashboard.matchConsole}
                </div>
                <h2 className="rpg-title text-2xl mt-1">{isDemo ? t.dashboard.demoMatch : t.dashboard.quickMatch}</h2>
              </div>
              <span className={`px-3 py-1 rounded-md text-xs font-black border font-rpg-heading tracking-widest ${
                isDemo
                  ? 'border-[#a86a3a] bg-[#3a2c1f] text-[#f5c265]'
                  : 'border-[#962323] bg-[#2a0e0e] text-[#d83a3a]'
              }`}>
                {isDemo ? t.dashboard.safe : t.dashboard.ranked}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs rpg-text-muted tracking-widest uppercase">
                  {isDemo ? t.dashboard.betLabelDemo : t.dashboard.betLabelPro}
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={betAmount}
                  onChange={e => {
                    const parsed = parseFloat(e.target.value);
                    setBetAmount(Number.isFinite(parsed) ? Math.max(1, parsed) : 1);
                  }}
                  className={`w-full mt-2 px-4 py-3 rpg-parchment-inset rpg-text text-lg font-bold focus:outline-none focus:ring-2 ${
                    isDemo ? 'focus:ring-[#d4a04a]' : 'focus:ring-[#962323]'
                  }`}
                />
              </div>

              {/* Preset wager buttons */}
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 5, 10].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setBetAmount(amt)}
                    className={`btn-rpg btn-rpg-sm ${
                      activeBet === amt ? (isDemo ? 'btn-rpg-amber' : 'btn-rpg-danger') : ''
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>

              <Link
                href={canStartMatch ? playHref : '#'}
                aria-disabled={!canStartMatch}
                tabIndex={canStartMatch ? undefined : -1}
                className={`btn-rpg btn-rpg-block btn-rpg-lg ${
                  canStartMatch ? (isDemo ? 'btn-rpg-amber' : 'btn-rpg-primary') : ''
                } ${canStartMatch ? '' : 'opacity-50 cursor-not-allowed pointer-events-none'}`}
              >
                {canStartMatch ? playLabel : isDemo ? t.dashboard.insufficientDemoBalance : t.dashboard.insufficientBalance}
              </Link>

              {/* Mode switch link */}
              <button
                onClick={async () => {
                  await api.setGameMode(isDemo ? 'pro' : 'demo');
                  refreshUser();
                }}
                className="block text-center w-full py-3 rounded-md rpg-stone-panel rpg-text-muted hover:rpg-gold-bright text-sm font-rpg-heading tracking-wider transition-colors"
              >
                {t.dashboard.switchTo} {isDemo ? t.dashboard.pro : t.dashboard.demo} {t.dashboard.mode}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rpg-panel p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="rpg-subtitle text-xs">{t.dashboard.commandCenter}</div>
                <h2 className="rpg-title text-2xl mt-1">{t.dashboard.wallet}</h2>
              </div>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="h-10 w-10 rounded-md rpg-stone-panel rpg-text-muted hover:rpg-gold-bright disabled:opacity-50"
                aria-label={t.dashboard.refreshBalance}
              >
                ↻
              </button>
            </div>
            <div className="rpg-parchment-inset p-5 mb-4">
              <div className="text-xs uppercase tracking-[0.2em] rpg-text-muted">{t.dashboard.available}</div>
              <div className="mt-1 text-3xl font-black rpg-gold-bright">${activeBalance.toFixed(2)}</div>
              <div className="text-sm font-bold rpg-text-muted">{isDemo ? t.dashboard.practiceFunds : t.dashboard.usdtBalance}</div>
            </div>
            {isDemo ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                <button
                  onClick={async () => {
                    await api.setGameMode('pro');
                    refreshUser();
                  }}
                  className="btn-rpg btn-rpg-primary btn-rpg-block"
                >
                  {t.dashboard.upgrade}
                </button>
                <button
                  onClick={async () => {
                    await api.setGameMode('demo');
                    refreshUser();
                  }}
                  className="btn-rpg btn-rpg-amber btn-rpg-block"
                >
                  {t.dashboard.reset}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                <Link href="/wallet/deposit" className="btn-rpg btn-rpg-amber btn-rpg-block text-center">
                  {t.dashboard.deposit}
                </Link>
                <Link href="/wallet/withdraw" className="btn-rpg btn-rpg-block text-center">
                  {t.dashboard.withdraw}
                </Link>
              </div>
            )}
          </div>

          {!isDemo && skins.length > 0 ? (
            /* Skin Shop banner (Pro mode only — skins cost real USDT) */
            <Link href="/skins" className="rpg-panel p-6 transition-all hover:scale-[1.01] group">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="rpg-subtitle text-xs">{t.dashboard.playerLoadout}</div>
                  <h2 className="rpg-title text-2xl mt-1">{t.dashboard.snakeSkins}</h2>
                </div>
                <span className="rpg-text-muted group-hover:rpg-gold-bright transition-colors">{t.dashboard.shop} →</span>
              </div>
              {/* Mini skin preview circles */}
              <div className="flex -space-x-3 mb-5">
                {skins.slice(0, 3).map(s => (
                  <div
                    key={s.id}
                    className="w-14 h-14 rounded-full border-2 border-[#0e0a08] shadow-lg"
                    style={{
                      background: `linear-gradient(135deg, ${s.color_primary}, ${s.color_secondary})`,
                    }}
                  />
                ))}
              </div>
              <div className="rpg-parchment-inset p-4">
                <div className="text-xs rpg-text-muted">{t.dashboard.equippedLabel}</div>
                <div className="font-black rpg-gold-bright">{equippedSkin?.name || t.dashboard.defaultSnake}</div>
                <div className="text-sm rpg-text-muted">{t.dashboard.youOwn} {ownedSkinIds.size} {t.dashboard.of} {skins.length} {t.dashboard.skinsCount}</div>
              </div>
            </Link>
          ) : (
            <div className="rpg-panel p-6">
              <div className="rpg-subtitle text-xs">{t.dashboard.trainingMode}</div>
              <h2 className="rpg-title text-2xl mt-1 mb-4">{isDemo ? t.dashboard.demoRules : t.dashboard.loadoutLocked}</h2>
              <div className="space-y-3 text-sm rpg-text">
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${isDemo ? 'bg-[#f5c265]' : 'bg-[#d83a3a]'}`} />
                  <span>{isDemo ? 'Play against bots with no withdrawal risk.' : 'Skins appear here after shop data loads.'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${isDemo ? 'bg-[#f5c265]' : 'bg-[#d83a3a]'}`} />
                  <span>{isDemo ? 'Demo winnings are practice-only.' : 'Cosmetics do not change match rules.'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${isDemo ? 'bg-[#f5c265]' : 'bg-[#d83a3a]'}`} />
                  <span>{isDemo ? 'Switch to Pro when you are ready.' : 'Use skins to personalize your arena look.'}</span>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Leaderboard (all modes) */}
        <Leaderboard myUserId={user.id} limit={10} />

        {/* Recent Transactions (Pro mode only) */}
        {!isDemo && (
          <div className="rpg-panel overflow-hidden">
            <div className="px-6 py-5 border-b border-[#3a2c1f] flex justify-between items-center">
              <div>
                <div className="rpg-subtitle text-xs">{t.dashboard.ledger}</div>
                <h2 className="rpg-title text-2xl mt-1">{t.dashboard.recentTransactions}</h2>
              </div>
              <Link href="/wallet/transactions" className="text-sm rpg-gold hover:rpg-gold-bright font-rpg-heading tracking-wider">
                {t.dashboard.viewAll}
              </Link>
            </div>
            <div className="divide-y divide-[#3a2c1f]">
              {transactions.length === 0 ? (
                <div className="px-6 py-10 text-center rpg-text-muted">{t.dashboard.noTransactionsYet}</div>
              ) : (
                transactions.slice(0, 5).map(tx => {
                  const isCredit = ['deposit', 'win'].includes(tx.type);
                  return (
                    <div key={tx.id} className="px-6 py-4 flex justify-between items-center hover:bg-[#1a1410]/60">
                      <div>
                        <div className="font-bold rpg-text capitalize">{tx.type.replace('_', ' ')}</div>
                        <div className="text-xs rpg-text-muted">
                          {new Date(tx.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className={`font-black ${isCredit ? 'rpg-gold-bright' : 'rpg-crimson'}`}>
                        {isCredit ? '+' : '-'}${parseFloat(tx.amount.toString()).toFixed(2)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Demo match history placeholder */}
        {isDemo && (
          <div className="rpg-panel overflow-hidden">
            <div className="px-6 py-5 border-b border-[#3a2c1f]">
              <div className="rpg-subtitle text-xs">{t.dashboard.practiceProgress}</div>
              <h2 className="rpg-title text-2xl mt-1">{t.dashboard.demoStats}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
              <div className="rpg-stone-panel p-5">
                <div className="text-xs rpg-text-muted">{t.dashboard.bots}</div>
                <div className="text-3xl font-black rpg-text">9</div>
                <div className="text-sm rpg-text-muted">{t.dashboard.autoFilledRivals}</div>
              </div>
              <div className="rpg-stone-panel p-5">
                <div className="text-xs rpg-text-muted">{t.dashboard.risk}</div>
                <div className="text-3xl font-black rpg-gold-bright">0</div>
                <div className="text-sm rpg-text-muted">{t.dashboard.realUsdtUsed}</div>
              </div>
              <div className="rpg-stone-panel p-5">
                <div className="text-xs rpg-text-muted">{t.dashboard.goal}</div>
                <div className="text-3xl font-black rpg-text">#1</div>
                <div className="text-sm rpg-text-muted">{t.dashboard.winTheArena}</div>
              </div>
            </div>
            <div className="px-6 pb-6 text-sm rpg-text-muted">
              {t.dashboard.demoEarningsCannotWithdraw}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs rpg-text-muted pb-2">
          <span>{t.dashboard.playResponsibly}</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:rpg-gold-bright">{t.landing.privacy}</Link>
            <Link href="/terms" className="hover:rpg-gold-bright">{t.landing.terms}</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
