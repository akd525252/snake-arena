'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
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
  const { t } = useI18n();

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

    // Each call is independent — one failing query (e.g. missing migration column)
    // should NOT blank out unrelated tabs. Use allSettled and log per-endpoint.
    const [m, p, h, d, r, u] = await Promise.allSettled([
      api.getMetrics(),
      api.getPendingWithdrawals(),
      api.getAllWithdrawals(),
      api.getAdminDeposits(),
      api.getRevenueHistory(undefined, 50),
      api.getUsers(),
    ]);

    if (m.status === 'fulfilled') setMetrics(m.value);
    else console.error('[admin] getMetrics failed:', m.reason);

    if (p.status === 'fulfilled') setPending(p.value.withdrawals);
    else console.error('[admin] getPendingWithdrawals failed:', p.reason);

    if (h.status === 'fulfilled') setHistory(h.value.withdrawals);
    else console.error('[admin] getAllWithdrawals failed:', h.reason);

    if (d.status === 'fulfilled') setDeposits(d.value.deposits);
    else console.error('[admin] getAdminDeposits failed:', d.reason);

    if (r.status === 'fulfilled') setRevenue(r.value.events);
    else console.error('[admin] getRevenueHistory failed:', r.reason);

    if (u.status === 'fulfilled') setUsers(u.value.users);
    else console.error('[admin] getUsers failed:', u.reason);

    setRefreshing(false);
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
    return <div className="min-h-screen flex items-center justify-center rpg-text-muted">{t.admin.loading}</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-8 py-4 border-b border-[#3a2c1f] flex items-center justify-between">
        <Link href="/dashboard" className="rpg-text-muted hover:rpg-gold-bright text-sm font-rpg-heading tracking-wider transition-colors">
          ← {t.admin.backToDashboard}
        </Link>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="btn-rpg btn-rpg-sm disabled:opacity-50"
        >
          {refreshing ? t.admin.refreshing : `↻ ${t.admin.refresh}`}
        </button>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="rpg-title text-4xl">{t.admin.adminPanel}</h1>
          <p className="rpg-text-muted text-sm mt-1">{t.admin.subtitle}</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-[#3a2c1f] overflow-x-auto">
          {(['overview', 'revenue', 'deposits', 'withdrawals', 'users'] as const).map(tabName => (
            <button
              key={tabName}
              onClick={() => setTab(tabName)}
              className={`px-4 pb-3 font-rpg-heading tracking-wider text-sm transition-colors whitespace-nowrap capitalize ${
                tab === tabName ? 'rpg-gold-bright border-b-2 border-[#d4a04a]' : 'rpg-text-muted hover:rpg-gold-bright'
              }`}
            >
              {t.admin[tabName as keyof typeof t.admin]}
              {tabName === 'withdrawals' && pending.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#962323] text-white text-[10px] font-black">
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
            <div className="rpg-panel p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="rpg-subtitle text-xs">Total Platform Revenue</div>
                  <div className="text-5xl font-black rpg-gold-bright mt-1">
                    ${metrics.totalRevenue.toFixed(2)}
                  </div>
                </div>
                <div className="text-right text-xs rpg-text-muted">
                  <div>Live · auto refresh</div>
                  <div>15s interval</div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
                <RevenueChip label="Match Rake" amount={metrics.revenueBySource.match_rake} color="#f5c265" />
                <RevenueChip label="Withdraw Fees" amount={metrics.revenueBySource.withdraw_fee} color="#d4a04a" />
                <RevenueChip label="Skin Sales" amount={metrics.revenueBySource.skin_purchase} color="#d83a3a" />
                <RevenueChip label="Zone Penalty" amount={metrics.revenueBySource.zone_penalty} color="#a86a3a" />
                <RevenueChip label="Deposit Fees" amount={metrics.revenueBySource.deposit_fee} color="#7cd17c" />
              </div>
            </div>

            {/* Deposits / Withdrawals split */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rpg-panel p-5">
                <div className="rpg-subtitle text-xs">Total Deposits (credited)</div>
                <div className="text-3xl font-bold rpg-text mt-1">${metrics.totalDeposits.toFixed(2)}</div>
                <div className="text-xs text-[#7cd17c] mt-1">
                  Confirmed payments: ${metrics.totalConfirmedPayments.toFixed(2)}
                </div>
              </div>
              <div className="rpg-panel p-5">
                <div className="rpg-subtitle text-xs">Total Withdrawals (approved)</div>
                <div className="text-3xl font-bold rpg-text mt-1">${metrics.totalWithdrawals.toFixed(2)}</div>
                <div className="text-xs rpg-gold mt-1">
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
          <div className="rpg-panel overflow-hidden">
            <div className="px-6 py-4 border-b border-[#3a2c1f] flex items-center justify-between">
              <h2 className="rpg-title text-2xl">Revenue History</h2>
              <span className="text-xs rpg-text-muted">{revenue.length} events</span>
            </div>
            <div className="divide-y divide-[#3a2c1f]">
              {revenue.length === 0 ? (
                <div className="text-center py-12 rpg-text-muted">No revenue events yet</div>
              ) : (
                revenue.map(ev => (
                  <div key={ev.id} className="px-6 py-3 flex items-center gap-4">
                    <SourceBadge source={ev.source} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm rpg-text truncate">
                        {ev.users?.username || ev.users?.email || (ev.user_id ? 'User' : 'System')}
                      </div>
                      <div className="text-[11px] rpg-text-muted font-mono truncate">
                        {ev.reference || '—'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="rpg-gold-bright font-bold font-mono">+${parseFloat(ev.amount.toString()).toFixed(2)}</div>
                      <div className="text-[10px] rpg-text-muted">{new Date(ev.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* DEPOSITS */}
        {tab === 'deposits' && (
          <div className="rpg-panel overflow-hidden">
            <div className="px-6 py-4 border-b border-[#3a2c1f] flex items-center justify-between">
              <h2 className="rpg-title text-2xl">All Deposits</h2>
              <span className="text-xs rpg-text-muted">{deposits.length} records</span>
            </div>
            <div className="divide-y divide-[#3a2c1f]">
              {deposits.length === 0 ? (
                <div className="text-center py-12 rpg-text-muted">No deposits yet</div>
              ) : (
                deposits.map(d => (
                  <div key={d.id} className="px-6 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm rpg-text">
                        {d.users?.username || d.users?.email || 'Unknown'}
                      </div>
                      <div className="text-[11px] rpg-text-muted">{d.users?.email}</div>
                      <div className="text-[10px] rpg-text-muted font-mono truncate">
                        invoice: {d.invoice_id}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="rpg-text font-bold font-mono">${parseFloat(d.amount.toString()).toFixed(2)}</div>
                      <StatusBadge status={d.status} />
                      <div className="text-[10px] rpg-text-muted mt-0.5">{new Date(d.created_at).toLocaleString()}</div>
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
            <div className="rpg-panel overflow-hidden">
              <div className="px-6 py-4 border-b border-[#3a2c1f] flex items-center justify-between">
                <h2 className="rpg-title text-2xl rpg-gold-bright">Pending Approval</h2>
                <span className="text-xs rpg-gold-bright font-rpg-heading tracking-wider">{pending.length} waiting</span>
              </div>
              <div className="divide-y divide-[#3a2c1f]">
                {pending.length === 0 ? (
                  <div className="text-center py-12 rpg-text-muted">No pending withdrawals — all clear!</div>
                ) : (
                  pending.map(w => <PendingWithdrawalRow key={w.id} w={w} onApprove={() => setApproveTarget(w)} onReject={() => handleReject(w.id)} />)
                )}
              </div>
            </div>

            {/* History */}
            <div className="rpg-panel overflow-hidden">
              <div className="px-6 py-4 border-b border-[#3a2c1f]">
                <h2 className="rpg-title text-2xl">Withdrawal History</h2>
              </div>
              <div className="divide-y divide-[#3a2c1f]">
                {history.length === 0 ? (
                  <div className="text-center py-8 rpg-text-muted text-sm">No withdrawal history</div>
                ) : (
                  history.filter(w => w.status !== 'pending').map(w => (
                    <div key={w.id} className="px-6 py-3 flex items-center gap-4 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="rpg-text">{w.users?.username || w.users?.email || 'Unknown'}</div>
                        <div className="text-[11px] rpg-text-muted font-mono truncate">{w.wallet_address}</div>
                        {w.tx_hash && <div className="text-[10px] text-[#7cd17c] font-mono truncate">tx: {w.tx_hash}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="rpg-text font-bold font-mono">${parseFloat(w.amount.toString()).toFixed(2)}</div>
                        {w.net_amount !== undefined && (
                          <div className="text-[10px] rpg-gold">net ${parseFloat(w.net_amount.toString()).toFixed(2)}</div>
                        )}
                        <StatusBadge status={w.status} />
                        <div className="text-[10px] rpg-text-muted">{new Date(w.created_at).toLocaleString()}</div>
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
          <div className="rpg-panel overflow-hidden">
            <div className="px-6 py-4 border-b border-[#3a2c1f]">
              <h2 className="rpg-title text-2xl">Users ({users.length})</h2>
            </div>
            <div className="divide-y divide-[#3a2c1f]">
              {users.map(u => {
                const wallet = (u as User & { wallets?: { balance: string }[] }).wallets?.[0];
                return (
                  <div key={u.id} className="px-6 py-3 flex justify-between items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium rpg-text">{u.username || u.email}</div>
                      <div className="text-xs rpg-text-muted truncate">{u.email}</div>
                    </div>
                    {wallet && (
                      <div className="text-right shrink-0">
                        <div className="text-xs rpg-text-muted">Balance</div>
                        <div className="text-sm rpg-gold-bright font-mono font-bold">
                          ${parseFloat(wallet.balance).toFixed(2)}
                        </div>
                      </div>
                    )}
                    <span className={`px-3 py-1 rounded-md text-xs font-rpg-heading tracking-wider ${
                      u.account_status === 'active'
                        ? 'border border-[#3a7a3a] bg-[#1c2c1c] text-[#7cd17c]'
                        : u.account_status === 'banned'
                        ? 'border border-[#962323] bg-[#2a0e0e] rpg-crimson'
                        : 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright'
                    }`}>
                      {u.account_status}
                    </span>
                    <button
                      onClick={() => handleBan(u.id, u.account_status === 'banned' ? 'active' : 'banned')}
                      className="btn-rpg btn-rpg-sm"
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
          <div className="w-full max-w-lg rpg-panel p-6 space-y-4">
            <div>
              <h3 className="rpg-title text-2xl">Approve Withdrawal</h3>
              <p className="text-xs rpg-text-muted mt-1">
                Send ${parseFloat((approveTarget.net_amount || approveTarget.amount).toString()).toFixed(2)} USDT (BEP20) to the address below.
                After sending on-chain, paste the transaction hash here.
              </p>
            </div>

            <div className="rpg-parchment-inset p-4 space-y-2 text-sm">
              <Row label="User" value={approveTarget.users?.username || approveTarget.users?.email || 'Unknown'} />
              <Row label="Email" value={approveTarget.users?.email || '—'} />
              <Row label="Requested" value={`$${parseFloat(approveTarget.amount.toString()).toFixed(2)}`} />
              {approveTarget.service_fee !== undefined && parseFloat(approveTarget.service_fee.toString()) > 0 && (
                <Row label="Service fee" value={`$${parseFloat(approveTarget.service_fee.toString()).toFixed(2)}`} muted />
              )}
              {approveTarget.network_fee !== undefined && (
                <Row label="Network fee" value={`$${parseFloat(approveTarget.network_fee.toString()).toFixed(2)}`} muted />
              )}
              <div className="h-px bg-[#3a2c1f]" />
              <Row
                label="Send to user"
                value={`$${parseFloat((approveTarget.net_amount ?? approveTarget.amount).toString()).toFixed(2)} USDT`}
                accent
              />
              <div className="pt-2">
                <div className="text-[11px] rpg-text-muted uppercase tracking-wider">Wallet (BEP20)</div>
                <div className="text-xs rpg-text font-mono break-all">{approveTarget.wallet_address}</div>
              </div>
            </div>

            <div>
              <label className="text-xs rpg-text-muted block mb-1">Transaction Hash (optional)</label>
              <input
                value={txHash}
                onChange={e => setTxHash(e.target.value)}
                placeholder="0x..."
                className="w-full px-3 py-2 rpg-parchment-inset rpg-text text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#d4a04a]"
              />
            </div>
            <div>
              <label className="text-xs rpg-text-muted block mb-1">Admin note (optional)</label>
              <input
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                placeholder="Internal note..."
                className="w-full px-3 py-2 rpg-parchment-inset rpg-text text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a04a]"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setApproveTarget(null)}
                disabled={approveBusy}
                className="btn-rpg flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={approveBusy}
                className="btn-rpg btn-rpg-amber flex-1 disabled:opacity-50"
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
    <div className={`p-5 rounded-md border ${
      highlight ? 'bg-[#2a0e0e] border-[#962323]' : 'rpg-stone-panel'
    }`}>
      <div className="rpg-subtitle text-xs">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? 'rpg-crimson' : 'rpg-text'}`}>{value}</div>
    </div>
  );
}

function RevenueChip({ label, amount, color }: { label: string; amount: number; color: string }) {
  return (
    <div className="rpg-stone-panel p-3">
      <div className="text-[10px] uppercase tracking-wider rpg-text-muted">{label}</div>
      <div className="text-lg font-bold mt-0.5 font-mono" style={{ color }}>
        ${amount.toFixed(2)}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: RevenueEvent['source'] }) {
  const map: Record<RevenueEvent['source'], { label: string; color: string }> = {
    match_rake: { label: 'MATCH', color: 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright' },
    withdraw_fee: { label: 'W/D FEE', color: 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold' },
    skin_purchase: { label: 'SKIN', color: 'border border-[#962323] bg-[#2a0e0e] rpg-crimson' },
    zone_penalty: { label: 'ZONE', color: 'border border-[#5b3a8a] bg-[#1a0e2a] text-[#c388ff]' },
    deposit_fee: { label: 'DEP FEE', color: 'border border-[#3a7a3a] bg-[#1c2c1c] text-[#7cd17c]' },
  };
  const s = map[source];
  return (
    <span className={`px-2 py-1 rounded-md text-[10px] font-rpg-heading tracking-wider ${s.color}`}>
      {s.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright',
    confirming: 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright',
    confirmed: 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold',
    approved: 'border border-[#3a7a3a] bg-[#1c2c1c] text-[#7cd17c]',
    rejected: 'border border-[#962323] bg-[#2a0e0e] rpg-crimson',
    failed: 'border border-[#962323] bg-[#2a0e0e] rpg-crimson',
    expired: 'border border-[#962323] bg-[#2a0e0e] rpg-crimson',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-rpg-heading tracking-wider mt-1 ${map[status] || 'rpg-stone-panel rpg-text-muted'}`}>
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
        <div className="text-sm rpg-text font-bold">
          {w.users?.username || w.users?.email || 'Unknown user'}
        </div>
        <div className="text-xs rpg-text-muted">{w.users?.email}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2">
          <div><span className="rpg-text-muted">Requested:</span> <span className="rpg-text font-mono">${amount.toFixed(2)}</span></div>
          <div><span className="rpg-text-muted">Send to user:</span> <span className="rpg-gold-bright font-mono">${net.toFixed(2)}</span></div>
          {w.service_fee !== undefined && parseFloat(w.service_fee.toString()) > 0 && (
            <div><span className="rpg-text-muted">Service fee:</span> <span className="rpg-gold font-mono">${parseFloat(w.service_fee.toString()).toFixed(2)}</span></div>
          )}
          {w.network_fee !== undefined && (
            <div><span className="rpg-text-muted">Network fee:</span> <span className="rpg-text-muted font-mono">${parseFloat(w.network_fee.toString()).toFixed(2)}</span></div>
          )}
        </div>
        <div className="text-[11px] rpg-text-muted font-mono break-all mt-2">{w.wallet_address}</div>
        <div className="text-[10px] rpg-text-muted">{new Date(w.created_at).toLocaleString()}</div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onApprove}
          className="btn-rpg btn-rpg-amber btn-rpg-sm"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          className="btn-rpg btn-rpg-danger btn-rpg-sm"
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
      <span className={`text-xs ${muted ? 'rpg-text-muted' : 'rpg-text'}`}>{label}</span>
      <span className={`font-mono text-xs ${
        accent ? 'rpg-gold-bright font-bold' : muted ? 'rpg-text-muted' : 'rpg-text'
      }`}>{value}</span>
    </div>
  );
}
