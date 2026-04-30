'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import {
  api,
  AdminMetrics,
  AdminWithdrawal,
  AdminDeposit,
  RevenueEvent,
  User,
} from '../../lib/api';

type Tab = 'overview' | 'revenue' | 'deposits' | 'withdrawals' | 'users';

export default function AdminDashboard() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [tab, setTab] = useState<Tab>('overview');
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [pending, setPending] = useState<AdminWithdrawal[]>([]);
  const [history, setHistory] = useState<AdminWithdrawal[]>([]);
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [revenue, setRevenue] = useState<RevenueEvent[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Approval modal state
  const [approveTarget, setApproveTarget] = useState<AdminWithdrawal | null>(null);
  const [txHash, setTxHash] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [approveBusy, setApproveBusy] = useState(false);

  useEffect(() => {
    if (!loading && (!user || !user.is_admin)) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [m, p, h, d, r, u] = await Promise.all([
        api.getMetrics(),
        api.getPendingWithdrawals(),
        api.getAllWithdrawals(),
        api.getAdminDeposits(),
        api.getRevenueHistory(undefined, 50),
        api.getUsers(),
      ]);
      setMetrics(m);
      setPending(p.withdrawals);
      setHistory(h.withdrawals);
      setDeposits(d.deposits);
      setRevenue(r.events);
      setUsers(u.users);
    } catch (err) {
      console.error('Admin fetch error:', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (user?.is_admin) refresh();
  }, [user, refresh]);

  // Auto-refresh metrics every 15s for live revenue panel
  useEffect(() => {
    if (!user?.is_admin) return;
    const id = setInterval(() => {
      api.getMetrics().then(setMetrics).catch(() => undefined);
    }, 15000);
    return () => clearInterval(id);
  }, [user]);

  const handleApprove = async () => {
    if (!approveTarget) return;
    setApproveBusy(true);
    try {
      await api.approveWithdrawal(approveTarget.id, 'approved', {
        tx_hash: txHash || undefined,
        admin_note: adminNote || undefined,
      });
      setApproveTarget(null);
      setTxHash('');
      setAdminNote('');
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setApproveBusy(false);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm('Reject this withdrawal? The full amount will be refunded to the user.')) return;
    try {
      await api.approveWithdrawal(id, 'rejected');
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Reject failed');
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

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center text-[#6a6a7a]">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-8 py-4 border-b border-[#1a1a2e] flex items-center justify-between">
        <Link href="/dashboard" className="text-[#8a8a9a] hover:text-white text-sm transition-colors">
          ← Back to Dashboard
        </Link>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-lg bg-[#11111a] hover:bg-[#1a1a2e] text-white text-xs disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Admin Panel</h1>
          <p className="text-[#8a8a9a] text-sm mt-1">Manage deposits, withdrawals, and platform revenue</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-[#1a1a2e] overflow-x-auto">
          {(['overview', 'revenue', 'deposits', 'withdrawals', 'users'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 pb-3 font-bold text-sm transition-colors whitespace-nowrap capitalize ${
                tab === t ? 'text-white border-b-2 border-[#00f0ff]' : 'text-[#8a8a9a] hover:text-white'
              }`}
            >
              {t}
              {t === 'withdrawals' && pending.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#ff2e63] text-white text-[10px] font-black">
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* OVERVIEW */}
        {tab === 'overview' && metrics && (
          <div className="space-y-6">
            {/* Revenue panel — main highlight */}
            <div className="p-6 rounded-3xl bg-gradient-to-br from-[#00f0ff]/10 via-[#0a0a12] to-[#39ff14]/5 border border-[#00f0ff]/30">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs text-[#8a8a9a] uppercase tracking-widest">Total Platform Revenue</div>
                  <div className="text-5xl font-black text-[#39ff14] mt-1">
                    ${metrics.totalRevenue.toFixed(2)}
                  </div>
                </div>
                <div className="text-right text-xs text-[#6a6a7a]">
                  <div>Live · auto refresh</div>
                  <div>15s interval</div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
                <RevenueChip label="Match Rake" amount={metrics.revenueBySource.match_rake} color="#00f0ff" />
                <RevenueChip label="Withdraw Fees" amount={metrics.revenueBySource.withdraw_fee} color="#ffb800" />
                <RevenueChip label="Skin Sales" amount={metrics.revenueBySource.skin_purchase} color="#ff2e63" />
                <RevenueChip label="Zone Penalty" amount={metrics.revenueBySource.zone_penalty} color="#8b00ff" />
                <RevenueChip label="Deposit Fees" amount={metrics.revenueBySource.deposit_fee} color="#39ff14" />
              </div>
            </div>

            {/* Deposits / Withdrawals split */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-[#0a0a12] border border-[#1a1a2e]">
                <div className="text-xs text-[#6a6a7a] uppercase tracking-wider">Total Deposits (credited)</div>
                <div className="text-3xl font-bold text-white mt-1">${metrics.totalDeposits.toFixed(2)}</div>
                <div className="text-xs text-[#39ff14] mt-1">
                  Confirmed payments: ${metrics.totalConfirmedPayments.toFixed(2)}
                </div>
              </div>
              <div className="p-5 rounded-2xl bg-[#0a0a12] border border-[#1a1a2e]">
                <div className="text-xs text-[#6a6a7a] uppercase tracking-wider">Total Withdrawals (approved)</div>
                <div className="text-3xl font-bold text-white mt-1">${metrics.totalWithdrawals.toFixed(2)}</div>
                <div className="text-xs text-[#ffb800] mt-1">
                  Net sent to users: ${metrics.totalNetWithdrawn.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Activity chips */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="Active Users" value={metrics.activeUsers.toString()} />
              <MetricCard label="Active Matches" value={metrics.activeMatches.toString()} />
              <MetricCard label="Total Matches Played" value={metrics.totalMatches.toString()} />
              <MetricCard
                label="Pending Withdrawals"
                value={metrics.pendingWithdrawals.toString()}
                highlight={metrics.pendingWithdrawals > 0}
              />
            </div>
          </div>
        )}

        {/* REVENUE history */}
        {tab === 'revenue' && (
          <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1a1a2e] flex items-center justify-between">
              <h2 className="font-bold text-white">Revenue History</h2>
              <span className="text-xs text-[#6a6a7a]">{revenue.length} events</span>
            </div>
            <div className="divide-y divide-[#1a1a2e]">
              {revenue.length === 0 ? (
                <div className="text-center py-12 text-[#6a6a7a]">No revenue events yet</div>
              ) : (
                revenue.map(ev => (
                  <div key={ev.id} className="px-6 py-3 flex items-center gap-4">
                    <SourceBadge source={ev.source} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">
                        {ev.users?.username || ev.users?.email || (ev.user_id ? 'User' : 'System')}
                      </div>
                      <div className="text-[11px] text-[#6a6a7a] font-mono truncate">
                        {ev.reference || '—'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[#39ff14] font-bold font-mono">+${parseFloat(ev.amount.toString()).toFixed(2)}</div>
                      <div className="text-[10px] text-[#5a5a6a]">{new Date(ev.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* DEPOSITS */}
        {tab === 'deposits' && (
          <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1a1a2e] flex items-center justify-between">
              <h2 className="font-bold text-white">All Deposits</h2>
              <span className="text-xs text-[#6a6a7a]">{deposits.length} records</span>
            </div>
            <div className="divide-y divide-[#1a1a2e]">
              {deposits.length === 0 ? (
                <div className="text-center py-12 text-[#6a6a7a]">No deposits yet</div>
              ) : (
                deposits.map(d => (
                  <div key={d.id} className="px-6 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white">
                        {d.users?.username || d.users?.email || 'Unknown'}
                      </div>
                      <div className="text-[11px] text-[#6a6a7a]">{d.users?.email}</div>
                      <div className="text-[10px] text-[#5a5a6a] font-mono truncate">
                        invoice: {d.invoice_id}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-bold font-mono">${parseFloat(d.amount.toString()).toFixed(2)}</div>
                      <StatusBadge status={d.status} />
                      <div className="text-[10px] text-[#5a5a6a] mt-0.5">{new Date(d.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* WITHDRAWALS */}
        {tab === 'withdrawals' && (
          <div className="space-y-6">
            {/* Pending — approval queue */}
            <div className="rounded-2xl bg-[#0a0a12] border border-[#ffb800]/30 overflow-hidden">
              <div className="px-6 py-4 border-b border-[#1a1a2e] flex items-center justify-between">
                <h2 className="font-bold text-[#ffb800]">Pending Approval</h2>
                <span className="text-xs text-[#ffb800]">{pending.length} waiting</span>
              </div>
              <div className="divide-y divide-[#1a1a2e]">
                {pending.length === 0 ? (
                  <div className="text-center py-12 text-[#6a6a7a]">No pending withdrawals — all clear!</div>
                ) : (
                  pending.map(w => <PendingWithdrawalRow key={w.id} w={w} onApprove={() => setApproveTarget(w)} onReject={() => handleReject(w.id)} />)
                )}
              </div>
            </div>

            {/* History */}
            <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#1a1a2e]">
                <h2 className="font-bold text-white">Withdrawal History</h2>
              </div>
              <div className="divide-y divide-[#1a1a2e]">
                {history.length === 0 ? (
                  <div className="text-center py-8 text-[#6a6a7a] text-sm">No withdrawal history</div>
                ) : (
                  history.filter(w => w.status !== 'pending').map(w => (
                    <div key={w.id} className="px-6 py-3 flex items-center gap-4 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="text-white">{w.users?.username || w.users?.email || 'Unknown'}</div>
                        <div className="text-[11px] text-[#6a6a7a] font-mono truncate">{w.wallet_address}</div>
                        {w.tx_hash && <div className="text-[10px] text-[#39ff14] font-mono truncate">tx: {w.tx_hash}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-white font-bold font-mono">${parseFloat(w.amount.toString()).toFixed(2)}</div>
                        {w.net_amount !== undefined && (
                          <div className="text-[10px] text-[#00f0ff]">net ${parseFloat(w.net_amount.toString()).toFixed(2)}</div>
                        )}
                        <StatusBadge status={w.status} />
                        <div className="text-[10px] text-[#5a5a6a]">{new Date(w.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* USERS */}
        {tab === 'users' && (
          <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1a1a2e]">
              <h2 className="font-bold text-white">Users ({users.length})</h2>
            </div>
            <div className="divide-y divide-[#1a1a2e]">
              {users.map(u => {
                const wallet = (u as User & { wallets?: { balance: string }[] }).wallets?.[0];
                return (
                  <div key={u.id} className="px-6 py-3 flex justify-between items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white">{u.username || u.email}</div>
                      <div className="text-xs text-[#6a6a7a] truncate">{u.email}</div>
                    </div>
                    {wallet && (
                      <div className="text-right shrink-0">
                        <div className="text-xs text-[#6a6a7a]">Balance</div>
                        <div className="text-sm text-[#39ff14] font-mono font-bold">
                          ${parseFloat(wallet.balance).toFixed(2)}
                        </div>
                      </div>
                    )}
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
                      className="px-3 py-1.5 rounded-lg bg-[#11111a] hover:bg-[#1a1a2e] text-xs text-white transition-colors"
                    >
                      {u.account_status === 'banned' ? 'Unban' : 'Ban'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Approval modal */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center px-4">
          <div className="w-full max-w-lg bg-[#0a0a12] border border-[#00f0ff]/30 rounded-2xl p-6 space-y-4">
            <div>
              <h3 className="text-xl font-bold text-white">Approve Withdrawal</h3>
              <p className="text-xs text-[#8a8a9a] mt-1">
                Send ${parseFloat((approveTarget.net_amount || approveTarget.amount).toString()).toFixed(2)} USDT (BEP20) to the address below.
                After sending on-chain, paste the transaction hash here.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#11111a] border border-[#1a1a2e] space-y-2 text-sm">
              <Row label="User" value={approveTarget.users?.username || approveTarget.users?.email || 'Unknown'} />
              <Row label="Email" value={approveTarget.users?.email || '—'} />
              <Row label="Requested" value={`$${parseFloat(approveTarget.amount.toString()).toFixed(2)}`} />
              {approveTarget.service_fee !== undefined && (
                <Row label="Service fee (20%)" value={`$${parseFloat(approveTarget.service_fee.toString()).toFixed(2)}`} muted />
              )}
              {approveTarget.network_fee !== undefined && (
                <Row label="Network fee" value={`$${parseFloat(approveTarget.network_fee.toString()).toFixed(2)}`} muted />
              )}
              <div className="h-px bg-[#1a1a2e]" />
              <Row
                label="Send to user"
                value={`$${parseFloat((approveTarget.net_amount ?? approveTarget.amount).toString()).toFixed(2)} USDT`}
                accent
              />
              <div className="pt-2">
                <div className="text-[11px] text-[#6a6a7a] uppercase tracking-wider">Wallet (BEP20)</div>
                <div className="text-xs text-white font-mono break-all">{approveTarget.wallet_address}</div>
              </div>
            </div>

            <div>
              <label className="text-xs text-[#8a8a9a] block mb-1">Transaction Hash (optional)</label>
              <input
                value={txHash}
                onChange={e => setTxHash(e.target.value)}
                placeholder="0x..."
                className="w-full px-3 py-2 bg-[#05050a] border border-[#1a1a2e] rounded-lg text-white text-sm font-mono focus:border-[#00f0ff] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-[#8a8a9a] block mb-1">Admin note (optional)</label>
              <input
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                placeholder="Internal note..."
                className="w-full px-3 py-2 bg-[#05050a] border border-[#1a1a2e] rounded-lg text-white text-sm focus:border-[#00f0ff] focus:outline-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setApproveTarget(null)}
                disabled={approveBusy}
                className="flex-1 py-2 rounded-lg border border-[#1a1a2e] text-[#b0b0c0] hover:bg-[#11111a] hover:text-white text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={approveBusy}
                className="flex-1 py-2 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] disabled:opacity-50 text-sm"
              >
                {approveBusy ? 'Approving…' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Sub-components
// ============================================

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-5 rounded-2xl border ${
      highlight ? 'bg-[#ff2e63]/10 border-[#ff2e63]/30' : 'bg-[#0a0a12] border-[#1a1a2e]'
    }`}>
      <div className="text-xs text-[#6a6a7a] uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? 'text-[#ff2e63]' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function RevenueChip({ label, amount, color }: { label: string; amount: number; color: string }) {
  return (
    <div className="p-3 rounded-xl bg-[#11111a] border border-[#1a1a2e]">
      <div className="text-[10px] uppercase tracking-wider text-[#6a6a7a]">{label}</div>
      <div className="text-lg font-bold mt-0.5 font-mono" style={{ color }}>
        ${amount.toFixed(2)}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: RevenueEvent['source'] }) {
  const map: Record<RevenueEvent['source'], { label: string; color: string }> = {
    match_rake: { label: 'MATCH', color: 'bg-[#00f0ff]/15 text-[#00f0ff]' },
    withdraw_fee: { label: 'W/D FEE', color: 'bg-[#ffb800]/15 text-[#ffb800]' },
    skin_purchase: { label: 'SKIN', color: 'bg-[#ff2e63]/15 text-[#ff2e63]' },
    zone_penalty: { label: 'ZONE', color: 'bg-[#8b00ff]/15 text-[#c388ff]' },
    deposit_fee: { label: 'DEP FEE', color: 'bg-[#39ff14]/15 text-[#39ff14]' },
  };
  const s = map[source];
  return (
    <span className={`px-2 py-1 rounded-md text-[10px] font-bold tracking-wider ${s.color}`}>
      {s.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-[#ffb800]/10 text-[#ffb800]',
    confirming: 'bg-[#ffb800]/10 text-[#ffb800]',
    confirmed: 'bg-[#00f0ff]/10 text-[#00f0ff]',
    approved: 'bg-[#39ff14]/10 text-[#39ff14]',
    rejected: 'bg-[#ff2e63]/10 text-[#ff2e63]',
    failed: 'bg-[#ff2e63]/10 text-[#ff2e63]',
    expired: 'bg-[#ff2e63]/10 text-[#ff2e63]',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold mt-1 ${map[status] || 'bg-[#1a1a2e] text-[#8a8a9a]'}`}>
      {status}
    </span>
  );
}

function PendingWithdrawalRow({ w, onApprove, onReject }: { w: AdminWithdrawal; onApprove: () => void; onReject: () => void }) {
  const amount = parseFloat(w.amount.toString());
  const net = w.net_amount !== undefined ? parseFloat(w.net_amount.toString()) : amount;
  return (
    <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3 items-start">
      <div className="space-y-1">
        <div className="text-sm text-white font-bold">
          {w.users?.username || w.users?.email || 'Unknown user'}
        </div>
        <div className="text-xs text-[#8a8a9a]">{w.users?.email}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2">
          <div><span className="text-[#6a6a7a]">Requested:</span> <span className="text-white font-mono">${amount.toFixed(2)}</span></div>
          <div><span className="text-[#6a6a7a]">Send to user:</span> <span className="text-[#00f0ff] font-mono">${net.toFixed(2)}</span></div>
          {w.service_fee !== undefined && (
            <div><span className="text-[#6a6a7a]">Service fee:</span> <span className="text-[#ffb800] font-mono">${parseFloat(w.service_fee.toString()).toFixed(2)}</span></div>
          )}
        </div>
        <div className="text-[11px] text-[#6a6a7a] font-mono break-all mt-2">{w.wallet_address}</div>
        <div className="text-[10px] text-[#5a5a6a]">{new Date(w.created_at).toLocaleString()}</div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onApprove}
          className="px-4 py-2 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] text-sm"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          className="px-4 py-2 rounded-lg bg-[#ff2e63]/15 text-[#ff2e63] hover:bg-[#ff2e63]/25 text-sm"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${muted ? 'text-[#6a6a7a]' : 'text-[#b0b0c0]'}`}>{label}</span>
      <span className={`font-mono text-xs ${
        accent ? 'text-[#00f0ff] font-bold' : muted ? 'text-[#8a8a9a]' : 'text-white'
      }`}>{value}</span>
    </div>
  );
}
