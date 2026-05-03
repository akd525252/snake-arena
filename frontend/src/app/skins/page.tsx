'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { api, Skin } from '../../lib/api';
import SnakePreview from '../../components/SnakePreview';

interface SkinSkill {
  name: string;
  description: string;
  icon: string;
}

const SKIN_SKILLS: Record<string, SkinSkill[]> = {
  neon_cyber: [
    {
      name: 'Neon Overdrive',
      description: '5-segment neon trail glows behind you when boosting',
      icon: '⚡',
    },
    {
      name: 'Glitch Death',
      description: 'Pixelated dissolve effect when you die',
      icon: '⚠',
    },
    {
      name: 'Circuit Aura',
      description: 'Animated circuit pattern flows along your body',
      icon: '◈',
    },
  ],
  inferno_drake: [
    {
      name: 'Flame Boost',
      description: 'Fire particle trail when boosting through coins',
      icon: '🔥',
    },
    {
      name: 'Ash to Ash',
      description: 'Coins you drop on death are colored as glowing embers',
      icon: '✦',
    },
    {
      name: 'Lava Glow',
      description: 'Persistent lava-orange aura around your snake',
      icon: '☀',
    },
  ],
  void_shadow: [
    {
      name: 'Shadow Clone',
      description: 'Two ghost clones appear when you start boosting (1.5s)',
      icon: '◊',
    },
    {
      name: 'Void Portal',
      description: 'Purple black-hole swirl effect on death',
      icon: '◉',
    },
    {
      name: 'Dark Matter Aura',
      description: 'Pulsing void-purple aura that intimidates opponents',
      icon: '✦',
    },
  ],
  default: [
    {
      name: 'Classic',
      description: 'The standard emerald snake. Clean, simple, deadly.',
      icon: '◐',
    },
    {
      name: 'Speed Boost',
      description: 'Standard boost ability available to all snakes',
      icon: '⚡',
    },
    {
      name: 'Trap Drop',
      description: 'Standard trap ability available to all snakes',
      icon: '✕',
    },
  ],
  venom_serpent: [
    {
      name: 'Toxic Trail',
      description: 'Leaves behind acid puddles that damage opponents who touch them',
      icon: '☠',
    },
    {
      name: 'Acid Drop',
      description: 'Death coins appear as bubbling acid pools worth +20% more',
      icon: '☢',
    },
    {
      name: 'Sludge Boost',
      description: 'Green toxic cloud trail that obscures vision briefly',
      icon: '☁',
    },
  ],
  frost_wyrm: [
    {
      name: 'Icy Aura',
      description: 'Nearby enemies move 10% slower when close to you',
      icon: '❄',
    },
    {
      name: 'Frozen Death',
      description: 'Shatters into ice shards on death that others can collect',
      icon: '✦',
    },
    {
      name: 'Cryo Breath',
      description: 'Brief freezing wave on boost that slows coins nearby',
      icon: '🌨',
    },
  ],
  golden_emperor: [
    {
      name: 'Magnate',
      description: 'Coins you drop on death are worth 50% more than standard',
      icon: '💎',
    },
    {
      name: 'Gilded Aura',
      description: 'Radiant gold particles sparkle as you move',
      icon: '✨',
    },
    {
      name: 'Royal Decree',
      description: 'Entry emote: golden crown briefly appears above head',
      icon: '👑',
    },
  ],
  cyber_samurai: [
    {
      name: 'Katana Slash',
      description: 'Sharp blade trail effect when boosting at max speed',
      icon: '⚔',
    },
    {
      name: 'Honor Death',
      description: 'Clean slice death animation — no messy particles',
      icon: '✦',
    },
    {
      name: 'Steel Discipline',
      description: 'Boost costs 20% less to activate and maintain',
      icon: '⛓',
    },
  ],
};

const DEFAULT_SKIN: Skin = {
  id: 'default',
  skin_key: 'default',
  name: 'Classic Emerald',
  description: 'The original Snake Arena look. Free for everyone.',
  price_usd: 0,
  tier: 'standard',
  color_primary: '#10b981',
  color_secondary: '#065f46',
  created_at: '',
};

export default function SkinsShopPage() {
  const router = useRouter();
  const { user, loading, refreshUser } = useAuth();
  const { t } = useI18n();

  const [skins, setSkins] = useState<Skin[]>([]);
  const [ownedSkinIds, setOwnedSkinIds] = useState<Set<string>>(new Set());
  const [equippedSkinId, setEquippedSkinId] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [boostPreview, setBoostPreview] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadAll = async () => {
    setLoadingData(true);
    try {
      const [skinsRes, mySkinsRes, balanceRes] = await Promise.all([
        api.getSkins(),
        api.getMySkins(),
        api.getBalance().catch(() => ({ balance: 0 })),
      ]);
      setSkins(skinsRes.skins);
      setOwnedSkinIds(new Set(mySkinsRes.owned.map(s => s.id)));
      setEquippedSkinId(mySkinsRes.equippedSkinId);
      setBalance(balanceRes.balance);
    } catch (err) {
      console.error('Failed to load skins:', err);
    } finally {
      setLoadingData(false);
    }
  };

  // Always include the default skin as the first option
  const allSkins = useMemo<Skin[]>(() => [DEFAULT_SKIN, ...skins], [skins]);
  const current = allSkins[activeIdx];
  const isCurrentDefault = current?.id === 'default';
  const isCurrentOwned = isCurrentDefault || ownedSkinIds.has(current?.id || '');
  const isCurrentEquipped =
    (isCurrentDefault && equippedSkinId === null) || equippedSkinId === current?.id;

  const goPrev = () => {
    setActiveIdx(i => (i - 1 + allSkins.length) % allSkins.length);
    setActionMsg(null);
  };
  const goNext = () => {
    setActiveIdx(i => (i + 1) % allSkins.length);
    setActionMsg(null);
  };

  const handleBuy = async () => {
    if (!current || isCurrentDefault) return;
    setBusy(true);
    setActionMsg(null);
    try {
      await api.buySkin(current.id);
      setOwnedSkinIds(prev => new Set([...prev, current.id]));
      const newBalance = (await api.getBalance()).balance;
      setBalance(newBalance);
      setActionMsg({ type: 'success', text: `${current.name} ${t.skins.purchased}` });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : t.skins.purchaseFailed;
      setActionMsg({ type: 'error', text });
    } finally {
      setBusy(false);
    }
  };

  const handleEquip = async () => {
    if (!current) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const skinIdToEquip = isCurrentDefault ? null : current.id;
      await api.equipSkin(skinIdToEquip);
      setEquippedSkinId(skinIdToEquip);
      await refreshUser();
      setActionMsg({ type: 'success', text: `${current.name} ${t.skins.equipped}` });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : t.skins.equipFailed;
      setActionMsg({ type: 'error', text });
    } finally {
      setBusy(false);
    }
  };

  if (loading || loadingData || !user || !current) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen">
        <div className="rpg-text-muted">{t.common.loading}</div>
      </div>
    );
  }

  const skills = SKIN_SKILLS[current.skin_key] || SKIN_SKILLS.default;

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <LanguageSwitcher />
      {/* Nav */}
      <nav className="flex justify-between items-center px-8 py-4 border-b border-[#3a2c1f]">
        <Link href="/dashboard" className="flex items-center gap-2 rpg-text-muted hover:rpg-gold-bright transition-colors">
          <span className="text-lg">←</span>
          <span className="text-sm">{t.skins.backToDashboard}</span>
        </Link>
        <h1 className="rpg-title text-xl">{t.skins.snakeShop}</h1>
        <div className="text-sm rpg-text-muted">
          {t.dashboard.balance}: <span className="rpg-gold-bright font-bold">${balance.toFixed(2)}</span>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">
        {/* Skin counter / pagination dots */}
        <div className="flex justify-center items-center gap-2">
          {allSkins.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveIdx(i);
                setActionMsg(null);
              }}
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                i === activeIdx
                  ? 'w-8'
                  : 'hover:scale-125'
              }`}
              style={{
                background: i === activeIdx ? s.color_primary : '#3f3f46',
              }}
              title={s.name}
            />
          ))}
        </div>

        {/* Skin name & price header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <h2 className="text-4xl font-black tracking-tight" style={{ color: current.color_primary }}>
              {current.name}
            </h2>
            {current.tier === 'premium' && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                ★ {t.skins.premium}
              </span>
            )}
          </div>
          <p className="rpg-text-muted text-sm max-w-2xl mx-auto">{current.description}</p>
          {!isCurrentDefault && (
            <div className="mt-2 rpg-text-muted text-xs">
              {t.skins.price}: <span className="rpg-gold-bright font-bold">${current.price_usd.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Snake preview with L/R nav */}
        <div className="relative rpg-panel overflow-hidden">
          {/* Left arrow */}
          <button
            onClick={goPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full rpg-stone-panel hover:bg-[#3a2c1f] backdrop-blur flex items-center justify-center text-2xl rpg-text transition-colors"
            aria-label="Previous skin"
          >
            ‹
          </button>
          {/* Right arrow */}
          <button
            onClick={goNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full rpg-stone-panel hover:bg-[#3a2c1f] backdrop-blur flex items-center justify-center text-2xl rpg-text transition-colors"
            aria-label="Next skin"
          >
            ›
          </button>

          {/* Snake preview canvas */}
          <div className="px-16 py-8">
            <SnakePreview
              key={current.skin_key}
              skinKey={current.skin_key}
              primaryColor={current.color_primary}
              secondaryColor={current.color_secondary}
              boost={boostPreview}
              width={800}
              height={280}
            />
          </div>

          {/* Boost preview toggle */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <button
              onMouseDown={() => setBoostPreview(true)}
              onMouseUp={() => setBoostPreview(false)}
              onMouseLeave={() => setBoostPreview(false)}
              onTouchStart={() => setBoostPreview(true)}
              onTouchEnd={() => setBoostPreview(false)}
              className="btn-rpg btn-rpg-sm select-none"
            >
              {boostPreview ? t.skins.boosting : t.skins.holdToPreview}
            </button>
          </div>
        </div>

        {/* Skills */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {skills.map((skill, i) => (
            <div
              key={i}
              className="rpg-panel p-4"
              style={{
                borderColor: i === 0 ? current.color_primary + '80' : undefined,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center text-lg font-black"
                  style={{
                    background: `linear-gradient(135deg, ${current.color_primary}40, ${current.color_secondary}40)`,
                    color: current.color_primary,
                  }}
                >
                  {skill.icon}
                </div>
                <h3 className="font-bold text-sm rpg-text">{skill.name}</h3>
              </div>
              <p className="text-xs rpg-text-muted">{skill.description}</p>
            </div>
          ))}
        </div>

        {/* Action message */}
        {actionMsg && (
          <div className={`p-3 rounded-md text-sm text-center ${
            actionMsg.type === 'success'
              ? 'bg-[#1c2c1c] border border-[#3a7a3a] text-[#7cd17c]'
              : 'bg-[#2a0e0e] border border-[#962323] text-[#d83a3a]'
          }`}>
            {actionMsg.text}
          </div>
        )}

        {/* Buy / Equip buttons */}
        <div className="flex gap-3">
          {!isCurrentOwned && (
            <button
              onClick={handleBuy}
              disabled={busy || balance < current.price_usd}
              className="flex-1 py-4 rounded-xl font-black text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.02] disabled:hover:scale-100"
              style={{
                background: balance >= current.price_usd
                  ? `linear-gradient(135deg, ${current.color_primary}, ${current.color_secondary})`
                  : '#3f3f46',
                color: balance >= current.price_usd ? '#fff' : '#71717a',
              }}
            >
              {busy ? t.skins.processing : balance >= current.price_usd
                ? `${t.skins.buyFor} $${current.price_usd.toFixed(2)}`
                : `${t.skins.needMore} $${(current.price_usd - balance).toFixed(2)} ${t.skins.price || ''}`}
            </button>
          )}
          {isCurrentOwned && !isCurrentEquipped && (
            <button
              onClick={handleEquip}
              disabled={busy}
              className="flex-1 py-4 rounded-xl font-black text-lg disabled:opacity-50 transition-all hover:scale-[1.02]"
              style={{
                background: `linear-gradient(135deg, ${current.color_primary}, ${current.color_secondary})`,
                color: '#fff',
              }}
            >
              {busy ? t.skins.processing : t.skins.equip}
            </button>
          )}
          {isCurrentEquipped && (
            <div className="flex-1 py-4 rounded-xl font-black text-lg text-center border-2"
              style={{
                borderColor: current.color_primary,
                color: current.color_primary,
                background: current.color_primary + '15',
              }}
            >
              ✓ {t.skins.equipped}
            </div>
          )}
        </div>

        <p className="text-center text-xs rpg-text-muted">
          ⚠ {t.skins.cosmeticOnly}
        </p>
      </main>
    </div>
  );
}
