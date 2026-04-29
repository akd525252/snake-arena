'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { api, Withdrawal, User } from '../../lib/api';

interface Metrics {
  activeUsers: number;
  totalDeposits: number;
  totalWithdrawals: number;
  activeMatches: number;
  pendingWithdrawals: number;
  totalMatches: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [pending, setPending] = useState<Withdrawal[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tab, setTab] = useState<'metrics' | 'withdrawals' | 'users'>('metrics');

  useEffect(() => {
    if (!loading && (!user || !user.is_admin)) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  const refresh = async () => {
    try {
      const [m, w, u] = await Promise.all([
        api.getMetrics(),
        api.getPendingWithdrawals(),
        api.getUsers(),
      ]);
      setMetrics(m);
      setPending(w.withdrawals);
      setUsers(u.users);
    } catch (err) {
      console.error('Admin fetch error:', err);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user?.is_admin) refresh();
  }, [user]);

  const handleWithdrawal = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.approveWithdrawal(id, status);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleBan = async (id: string, status: string) => {
    try {
      await api.setUserStatus(id, status);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading || !user) return <div className="min-h-screen flex items-center justify-center text-[#6a6a7a]">Loading...</div>;

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-8 py-4 border-b border-[#1a1a2e]">
        <Link href="/dashboard" className="text-[#8a8a9a] hover:text-white text-sm transition-colors">
          ← Back to Dashboard
        </Link>
      </nav>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white">Admin Panel</h1>
        </div>

        <div className="flex gap-2 border-b border-[#1a1a2e]">
          {(['metrics', 'withdrawals', 'users'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 pb-3 font-bold text-sm transition-colors ${
                tab === t ? 'text-white border-b-2 border-[#00f0ff]' : 'text-[#8a8a9a] hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'metrics' && metrics && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard label="Active Users" value={metrics.activeUsers.toString()} />
            <MetricCard label="Total Deposits" value={`$${metrics.totalDeposits.toFixed(2)}`} />
            <MetricCard label="Total Withdrawals" value={`$${metrics.totalWithdrawals.toFixed(2)}`} />
            <MetricCard label="Active Matches" value={metrics.activeMatches.toString()} />
            <MetricCard label="Pending Withdrawals" value={metrics.pendingWithdrawals.toString()} highlight />
            <MetricCard label="Total Matches Played" value={metrics.totalMatches.toString()} />
          </div>
        )}

        {tab === 'withdrawals' && (
          <div className="rounded-2xl bg-[#1a1a2e] border border-[#1a1a2e] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1a1a2e]">
              <h2 className="font-bold">Pending Withdrawals</h2>
            </div>
            <div className="divide-y divide-[#1a1a2e]">
              {pending.length === 0 ? (
                <div className="text-center py-12 text-[#6a6a7a]">No pending withdrawals</div>
              ) : (
                pending.map(w => (
                  <div key={w.id} className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-2xl font-bold text-[#ffb800]">${parseFloat(w.amount.toString()).toFixed(2)}</div>
                      <div className="text-xs text-[#8a8a9a]">{w.wallet_address}</div>
                      <div className="text-xs text-[#4a4a5a]">{new Date(w.created_at).toLocaleString()}</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleWithdrawal(w.id, 'approved')}
                        className="px-4 py-2 rounded-lg bg-[#00f0ff] text-[#1a1a2e] font-bold hover:bg-[#00f0ff]/90 transition-colors text-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleWithdrawal(w.id, 'rejected')}
                        className="px-4 py-2 rounded-lg bg-[#ff2e63]/20 text-[#ff2e63] hover:bg-[#ff2e63]/30 text-sm"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div className="rounded-2xl bg-[#1a1a2e] border border-[#1a1a2e] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1a1a2e]">
              <h2 className="font-bold">Users</h2>
            </div>
            <div className="divide-y divide-[#1a1a2e]">
              {users.map(u => (
                <div key={u.id} className="px-6 py-3 flex justify-between items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{u.username || u.email}</div>
                    <div className="text-xs text-[#4a4a5a]">{u.email}</div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    u.account_status === 'active'
                      ? 'bg-[#00f0ff]/10 text-[#00f0ff]'
                      : u.account_status === 'banned'
                      ? 'bg-[#ff2e63]/10 text-[#ff2e63]'
                      : 'bg-[#ffb800]/10 text-[#ffb800]'
                  }`}>
                    {u.account_status}
                  </span>
                  <button
                    onClick={() => handleBan(u.id, u.account_status === 'banned' ? 'active' : 'banned')}
                    className="flex items-center gap-4 py-3 border-b border-[#1a1a2e] hover:bg-[#11111a]/50 transition-colors px-4 -mx-4 rounded-lg"
                  >
                    {u.account_status === 'banned' ? 'Unban' : 'Ban'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-6 rounded-2xl border ${
      highlight ? 'bg-[#00f0ff]/10 border-[#00f0ff]/30' : 'bg-[#1a1a2e] border-[#1a1a2e]'
    }`}>
      <div className="text-xs text-[#6a6a7a]">{label}</div>
      <div className="text-2xl font-bold text-[#39ff14]">{value}</div>
    </div>
  );
}
