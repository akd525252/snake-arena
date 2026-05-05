'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { api } from '../../lib/api';
import { countryCodeToEmoji, COUNTRY_LIST } from '../../lib/countryFlag';
import Loader from '../../components/Loader';

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILE_MB = 2;

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, refreshUser } = useAuth();
  const { t } = useI18n();

  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingBase64, setPendingBase64] = useState<string | null>(null);
  const [usernameMsg, setUsernameMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [flagSearch, setFlagSearch] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagMsg, setFlagMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingFlag, setSavingFlag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      setUsername(user.username || '');
      setAvatar(user.avatar || '');
    }
  }, [user]);

  const cooldown = useMemo(() => {
    if (!user?.username_changed_at) return null;
    const lastChange = new Date(user.username_changed_at).getTime();
    const elapsed = Date.now() - lastChange;
    if (elapsed >= COOLDOWN_MS) return null;
    const remainingMs = COOLDOWN_MS - elapsed;
    const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    return { days, hours, total: remainingMs };
  }, [user?.username_changed_at]);

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameMsg(null);
    if (!username.trim()) {
      setUsernameMsg({ type: 'error', text: t.profile.cannotBeEmpty });
      return;
    }
    if (username.trim() === user?.username) {
      setUsernameMsg({ type: 'error', text: t.profile.unchanged });
      return;
    }
    setSavingUsername(true);
    try {
      await api.updateUsername(username.trim());
      await refreshUser();
      setUsernameMsg({ type: 'success', text: t.profile.updatedLocked });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : t.profile.failedUpdateUsername;
      setUsernameMsg({ type: 'error', text });
    } finally {
      setSavingUsername(false);
    }
  };

  const handleSaveAvatar = async (avatarUrl: string) => {
    setAvatarMsg(null);
    setSavingAvatar(true);
    try {
      await api.updateAvatar(avatarUrl);
      await refreshUser();
      setAvatar(avatarUrl);
      setAvatarMsg({ type: 'success', text: t.profile.avatarUpdated });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : t.profile.failedUpdateAvatar;
      setAvatarMsg({ type: 'error', text });
    } finally {
      setSavingAvatar(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    if (!file.type.startsWith('image/')) {
      setAvatarMsg({ type: 'error', text: t.profile.onlyImages });
      return;
    }

    // Validate size
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setAvatarMsg({ type: 'error', text: t.profile.maxFileSize });
      return;
    }

    setAvatarMsg(null);
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setPreviewUrl(result);
      setPendingBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const handleUploadAvatar = async () => {
    if (!pendingBase64) return;
    setAvatarMsg(null);
    setSavingAvatar(true);
    try {
      await api.updateAvatar(pendingBase64);
      await refreshUser();
      setAvatar(pendingBase64);
      setPendingBase64(null);
      setAvatarMsg({ type: 'success', text: t.profile.avatarUploaded });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : t.profile.failedUploadAvatar;
      setAvatarMsg({ type: 'error', text });
    } finally {
      setSavingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setPreviewUrl(null);
    setPendingBase64(null);
    await handleSaveAvatar('');
  };

  if (loading || !user) {
    return <Loader message={t.profile.loadingProfile} />;
  }

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <LanguageSwitcher />
      {/* Nav */}
      <nav className="flex justify-between items-center px-8 py-4 border-b border-[#3a2c1f]">
        <Link href="/dashboard" className="flex items-center gap-2 rpg-text-muted hover:rpg-gold-bright transition-colors">
          <span className="text-lg">←</span>
          <span className="text-sm">{t.play.backToDashboard}</span>
        </Link>
        <h1 className="rpg-title text-2xl">{t.profile.profileSettings}</h1>
        <div className="w-32" />
      </nav>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-8">
        {/* Profile preview card */}
        <div className="rpg-panel p-6 flex items-center gap-6">
          <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-[#d4a04a] flex-shrink-0">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt={username || 'avatar'} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center rpg-stone-panel">
                <span className="rpg-title text-4xl">{(username || user.email || '?').charAt(0).toUpperCase()}</span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-2xl font-black rpg-text truncate">{username || user.email}</div>
            <div className="text-sm rpg-text-muted truncate">{user.email}</div>
            {user.game_mode && (
              <span className={`inline-block mt-2 px-2 py-0.5 rounded-md text-xs font-bold border ${
                user.game_mode === 'demo'
                  ? 'bg-[#3a2c1f] border-[#a86a3a] text-[#f5c265]'
                  : 'bg-[#2a0e0e] border-[#962323] text-[#d83a3a]'
              }`}>
                {user.game_mode === 'demo' ? t.dashboard.demo.toUpperCase() : t.dashboard.pro.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Username section */}
        <div className="rpg-panel p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="rpg-subtitle text-base">{t.profile.username}</h2>
              <p className="text-sm rpg-text-muted">{t.profile.usernameRules}</p>
            </div>
            {cooldown && (
              <div className="text-right">
                <div className="text-xs text-[#d83a3a] font-bold">{t.profile.locked}</div>
                <div className="text-xs rpg-text-muted">
                  {cooldown.days}d {cooldown.hours}h {t.profile.remainingSuffix}
                </div>
              </div>
            )}
          </div>
          <form onSubmit={handleSaveUsername} className="space-y-3">
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={!!cooldown || savingUsername}
              placeholder={t.profile.yourUsernamePlaceholder}
              minLength={3}
              maxLength={20}
              className="w-full px-4 py-3 rpg-parchment-inset rpg-text focus:outline-none focus:ring-2 focus:ring-[#d4a04a] disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {usernameMsg && (
              <div className={`p-3 rounded-md text-sm ${
                usernameMsg.type === 'success'
                  ? 'bg-[#1c2c1c] border border-[#3a7a3a] text-[#7cd17c]'
                  : 'bg-[#2a0e0e] border border-[#962323] text-[#d83a3a]'
              }`}>
                {usernameMsg.text}
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs rpg-text-muted">
                {cooldown ? t.profile.cooldownExpired : t.profile.saveLockWarning}
              </p>
              <button
                type="submit"
                disabled={!!cooldown || savingUsername || !username.trim() || username.trim() === user.username}
                className="btn-rpg btn-rpg-primary disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {savingUsername ? t.profile.saving : t.profile.saveUsername}
              </button>
            </div>
          </form>
        </div>

        {/* Avatar section */}
        <div className="rpg-panel p-6">
          <h2 className="rpg-subtitle text-base">{t.profile.profilePhoto}</h2>
          <p className="text-sm rpg-text-muted mb-6">{t.profile.photoUploadHint}</p>

          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Preview */}
            <div className="w-32 h-32 rounded-md overflow-hidden border-2 border-[#5a4028] rpg-stone-panel flex-shrink-0 relative">
              {(previewUrl || avatar) ? (
                <img
                  src={previewUrl || avatar}
                  alt={t.profile.avatarPreviewAlt}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="rpg-title text-4xl">{(username || user.email || '?').charAt(0).toUpperCase()}</span>
                </div>
              )}
              {(previewUrl || avatar) && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={savingAvatar}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-[#962323] hover:bg-[#d83a3a] text-white text-xs flex items-center justify-center"
                  title={t.profile.removeAvatar}
                >
                  ×
                </button>
              )}
            </div>

            {/* Upload controls */}
            <div className="flex-1 space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={savingAvatar}
                className="btn-rpg disabled:opacity-50 text-sm"
              >
                {t.profile.chooseFile}
              </button>

              {pendingBase64 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleUploadAvatar}
                    disabled={savingAvatar}
                    className="btn-rpg btn-rpg-primary disabled:opacity-50 text-sm"
                  >
                    {savingAvatar ? t.profile.uploading : t.profile.saveAvatar}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPreviewUrl(null); setPendingBase64(null); }}
                    disabled={savingAvatar}
                    className="btn-rpg disabled:opacity-50 text-sm"
                  >
                    {t.profile.cancel}
                  </button>
                </div>
              )}

              {avatarMsg && (
                <div className={`p-3 rounded-md text-sm ${
                  avatarMsg.type === 'success'
                    ? 'bg-[#1c2c1c] border border-[#3a7a3a] text-[#7cd17c]'
                    : 'bg-[#2a0e0e] border border-[#962323] text-[#d83a3a]'
                }`}>
                  {avatarMsg.text}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Country Flag section */}
        <div className="rpg-panel p-6">
          <h2 className="rpg-subtitle text-base">{t.countryFlag.title}</h2>
          <p className="text-sm rpg-text-muted mb-4">{t.countryFlag.desc}</p>

          {user.country_flag && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">{countryCodeToEmoji(user.country_flag)}</span>
              <span className="text-sm rpg-text-muted">{t.countryFlag.currentFlag}: {COUNTRY_LIST.find(([c]) => c === user.country_flag)?.[1] || user.country_flag}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setFlagOpen(!flagOpen)}
            disabled={savingFlag}
            className="btn-rpg text-sm"
          >
            {t.countryFlag.selectCountry}
          </button>

          {flagOpen && (
            <div className="mt-3 rpg-parchment-inset rounded-md overflow-hidden">
              <input
                type="text"
                value={flagSearch}
                onChange={e => setFlagSearch(e.target.value)}
                placeholder={t.countryFlag.searchCountry}
                className="w-full px-3 py-2 rpg-parchment-inset rpg-text text-sm focus:outline-none border-b border-[#3a2c1f]"
              />
              <div className="max-h-48 overflow-y-auto">
                {COUNTRY_LIST
                  .filter(([, name]) => name.toLowerCase().includes(flagSearch.toLowerCase()))
                  .map(([code, name]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={async () => {
                        setSavingFlag(true);
                        setFlagMsg(null);
                        try {
                          await api.updateCountryFlag(code);
                          await refreshUser();
                          setFlagMsg({ type: 'success', text: t.countryFlag.saved });
                          setFlagOpen(false);
                          setFlagSearch('');
                        } catch (err: unknown) {
                          setFlagMsg({ type: 'error', text: err instanceof Error ? err.message : t.countryFlag.failedUpdate });
                        } finally {
                          setSavingFlag(false);
                        }
                      }}
                      disabled={savingFlag}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-[#3a2c1f]/50 transition-colors text-left ${
                        user.country_flag === code ? 'bg-[#3a2c1f]/30 rpg-gold-bright' : 'rpg-text'
                      }`}
                    >
                      <span className="text-lg">{countryCodeToEmoji(code)}</span>
                      <span>{name}</span>
                      {user.country_flag === code && <span className="ml-auto text-xs rpg-gold-bright">✓</span>}
                    </button>
                  ))}
                {COUNTRY_LIST.filter(([, name]) => name.toLowerCase().includes(flagSearch.toLowerCase())).length === 0 && (
                  <div className="px-3 py-4 text-sm rpg-text-muted text-center">{t.countryFlag.noResults}</div>
                )}
              </div>
            </div>
          )}

          {flagMsg && (
            <div className={`mt-3 p-3 rounded-md text-sm ${
              flagMsg.type === 'success'
                ? 'bg-[#1c2c1c] border border-[#3a7a3a] text-[#7cd17c]'
                : 'bg-[#2a0e0e] border border-[#962323] text-[#d83a3a]'
            }`}>
              {flagMsg.text}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
