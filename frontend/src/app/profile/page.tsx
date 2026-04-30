'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILE_MB = 2;

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, refreshUser } = useAuth();

  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingBase64, setPendingBase64] = useState<string | null>(null);
  const [usernameMsg, setUsernameMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
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
      setUsernameMsg({ type: 'error', text: 'Username cannot be empty' });
      return;
    }
    if (username.trim() === user?.username) {
      setUsernameMsg({ type: 'error', text: 'Username unchanged' });
      return;
    }
    setSavingUsername(true);
    try {
      await api.updateUsername(username.trim());
      await refreshUser();
      setUsernameMsg({ type: 'success', text: 'Username updated! Locked for 7 days.' });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : 'Failed to update username';
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
      setAvatarMsg({ type: 'success', text: 'Avatar updated!' });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : 'Failed to update avatar';
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
      setAvatarMsg({ type: 'error', text: 'Only image files (PNG, JPG, WEBP, GIF) are allowed.' });
      return;
    }

    // Validate size
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setAvatarMsg({ type: 'error', text: `Max file size is ${MAX_FILE_MB}MB.` });
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
      setAvatarMsg({ type: 'success', text: 'Avatar uploaded!' });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : 'Failed to upload avatar';
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
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen">
        <div className="text-[#6a6a7a]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      {/* Nav */}
      <nav className="flex justify-between items-center px-8 py-4 border-b border-[#1a1a2e]">
        <Link href="/dashboard" className="flex items-center gap-2 text-[#8a8a9a] hover:text-white transition-colors">
          <span className="text-lg">←</span>
          <span className="text-sm">Back to Dashboard</span>
        </Link>
        <h1 className="text-3xl font-bold text-white">Profile Settings</h1>
        <div className="w-32" />
      </nav>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-8">
        {/* Profile preview card */}
        <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] p-6 flex items-center gap-6">
          <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-[#3a3a4a] flex-shrink-0 glow-cyan">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt={username || 'avatar'} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#00f0ff] text-[#05050a] font-black text-4xl">
                {(username || user.email || '?').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-2xl font-black text-white truncate">{username || user.email}</div>
            <div className="text-sm text-[#8a8a9a] truncate">{user.email}</div>
            {user.game_mode && (
              <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-bold ${
                user.game_mode === 'demo' ? 'bg-[#ffb800]/20 text-[#ffb800]' : 'bg-[#00f0ff]/20 text-[#00f0ff]'
              }`}>
                {user.game_mode === 'demo' ? 'DEMO' : 'PRO'}
              </span>
            )}
          </div>
        </div>

        {/* Username section */}
        <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">Username</h2>
              <p className="text-sm text-[#6a6a7a]">3-20 characters. Letters, numbers, and underscores only.</p>
            </div>
            {cooldown && (
              <div className="text-right">
                <div className="text-xs text-[#ff2e63] font-bold">LOCKED</div>
                <div className="text-xs text-[#6a6a7a]">
                  {cooldown.days}d {cooldown.hours}h remaining
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
              placeholder="your_username"
              minLength={3}
              maxLength={20}
              className="w-full px-4 py-3 bg-[#05050a] border border-[#1a1a2e] rounded-lg text-white focus:border-[#00f0ff] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {usernameMsg && (
              <div className={`p-3 rounded-lg text-sm ${
                usernameMsg.type === 'success'
                  ? 'bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff]'
                  : 'bg-[#ff2e63]/10 border border-[#ff2e63]/30 text-[#ff2e63]'
              }`}>
                {usernameMsg.text}
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#6a6a7a]">
                {cooldown
                  ? '⚠ You can change your username again after the cooldown expires.'
                  : 'ℹ After saving, you cannot change your username for 7 days.'}
              </p>
              <button
                type="submit"
                disabled={!!cooldown || savingUsername || !username.trim() || username.trim() === user.username}
                className="px-6 py-2 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] disabled:opacity-50 disabled:cursor-not-allowed text-sm glow-cyan"
              >
                {savingUsername ? 'Saving...' : 'Save Username'}
              </button>
            </div>
          </form>
        </div>

        {/* Avatar section */}
        <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] p-6">
          <h2 className="text-lg font-bold text-white">Profile Photo</h2>
          <p className="text-sm text-[#6a6a7a] mb-6">Upload a photo. Max {MAX_FILE_MB}MB. PNG, JPG, WEBP, GIF.</p>

          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Preview */}
            <div className="w-32 h-32 rounded-2xl overflow-hidden border-2 border-[#3a3a4a] bg-[#05050a] flex-shrink-0 relative">
              {(previewUrl || avatar) ? (
                <img
                  src={previewUrl || avatar}
                  alt="avatar preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#00f0ff] text-[#05050a] font-black text-4xl">
                  {(username || user.email || '?').charAt(0).toUpperCase()}
                </div>
              )}
              {(previewUrl || avatar) && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={savingAvatar}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-[#ff2e63]/80 hover:bg-[#ff2e63] text-white text-xs flex items-center justify-center"
                  title="Remove avatar"
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
                className="px-5 py-2.5 rounded-lg bg-[#11111a] hover:bg-[#1a1a2e] text-white font-bold text-sm border border-[#1a1a2e] transition-colors disabled:opacity-50"
              >
                Choose File
              </button>

              {pendingBase64 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleUploadAvatar}
                    disabled={savingAvatar}
                    className="px-5 py-2.5 rounded-lg bg-[#00f0ff] hover:bg-[#33f3ff] text-[#05050a] font-bold text-sm transition-colors disabled:opacity-50 glow-cyan"
                  >
                    {savingAvatar ? 'Uploading...' : 'Save Avatar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPreviewUrl(null); setPendingBase64(null); }}
                    disabled={savingAvatar}
                    className="px-4 py-2.5 rounded-lg bg-[#11111a] hover:bg-[#1a1a2e] text-[#8a8a9a] font-bold text-sm transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {avatarMsg && (
                <div className={`p-3 rounded-lg text-sm ${
                  avatarMsg.type === 'success'
                    ? 'bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff]'
                    : 'bg-[#ff2e63]/10 border border-[#ff2e63]/30 text-[#ff2e63]'
                }`}>
                  {avatarMsg.text}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
