const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('app_token');
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('app_token', token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('app_token');
}

async function request<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BACKEND_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Request failed' }));

    // Single-device enforcement: backend says our session was revoked because
    // the user logged in on another device. Clear the local token and emit a
    // window event so AuthContext can sign out cleanly and redirect to login.
    if (res.status === 401 && (errorData as { code?: string }).code === 'SESSION_REVOKED') {
      clearToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:session-revoked', {
          detail: { message: errorData.error || 'Logged in from another device.' },
        }));
      }
    }

    throw new Error(errorData.error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  login: (access_token: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ access_token }),
    }),

  me: () => request<{ user: User }>('/api/auth/me'),

  updateUsername: (username: string) =>
    request<{ user: User }>('/api/auth/me/username', {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    }),

  updateAvatar: (avatar: string) =>
    request<{ user: User }>('/api/auth/me/avatar', {
      method: 'PATCH',
      body: JSON.stringify({ avatar }),
    }),

  setGameMode: (game_mode: 'demo' | 'pro') =>
    request<{ user: User }>('/api/auth/mode', {
      method: 'PATCH',
      body: JSON.stringify({ game_mode }),
    }),

  // Wallet
  getBalance: () => request<{ balance: number }>('/api/wallet/balance'),

  getTransactions: (page = 1, limit = 20) =>
    request<{
      transactions: Transaction[];
      pagination: { page: number; limit: number; total: number };
    }>(`/api/wallet/transactions?page=${page}&limit=${limit}`),

  // Payments
  createDeposit: (amount: number) =>
    request<{ invoice_id: string; payment_url: string; amount: number }>(
      '/api/payments/deposit',
      {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }
    ),

  quoteDeposit: (amount: number) =>
    request<DepositQuote>(`/api/payments/deposit/quote?amount=${amount}`),

  getDeposits: () =>
    request<{ deposits: PaymentInvoice[] }>('/api/payments/deposits'),

  cancelDeposit: (invoiceId: string) =>
    request<{ status: string }>(`/api/payments/deposit/${invoiceId}/cancel`, { method: 'POST' }),

  // TRC20 Auto-Deposits
  getTrc20Wallet: () =>
    request<Trc20Wallet>('/api/trc20/wallet'),

  getTrc20Deposits: () =>
    request<{ deposits: Trc20Deposit[] }>('/api/trc20/deposits'),

  getTrc20Status: () =>
    request<Trc20DepositStatus>('/api/trc20/status'),

  // Withdrawals
  createWithdrawal: (amount: number, wallet_address: string) =>
    request<{ withdrawal: Withdrawal; breakdown: WithdrawalBreakdown }>(
      '/api/withdrawals',
      {
        method: 'POST',
        body: JSON.stringify({ amount, wallet_address }),
      }
    ),

  quoteWithdrawal: (amount: number) =>
    request<WithdrawalQuote>(`/api/withdrawals/quote?amount=${amount}`),

  getWithdrawals: () =>
    request<{ withdrawals: Withdrawal[] }>('/api/withdrawals'),

  // Matchmaking
  joinMatchmaking: (bet_amount: number) =>
    request<{ status: string; match_id?: string; position?: number }>(
      '/api/matchmaking/join',
      {
        method: 'POST',
        body: JSON.stringify({ bet_amount }),
      }
    ),

  leaveMatchmaking: () =>
    request<{ status: string }>('/api/matchmaking/leave', { method: 'POST' }),

  matchmakingStatus: () =>
    request<{
      in_queue: boolean;
      bet_amount?: number;
      wait_seconds?: number;
      queue_size?: number;
    }>('/api/matchmaking/status'),

  // Admin
  getMetrics: () => request<AdminMetrics>('/api/admin/metrics'),

  getUsers: (page = 1) =>
    request<{ users: User[]; pagination: { total: number } }>(
      `/api/admin/users?page=${page}`
    ),

  setUserStatus: (id: string, account_status: string) =>
    request(`/api/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ account_status }),
    }),

  getPendingWithdrawals: () =>
    request<{ withdrawals: AdminWithdrawal[] }>('/api/withdrawals/admin/pending'),

  getAllWithdrawals: (status?: 'pending' | 'approved' | 'rejected') =>
    request<{ withdrawals: AdminWithdrawal[] }>(
      `/api/withdrawals/admin/all${status ? `?status=${status}` : ''}`
    ),

  approveWithdrawal: (
    id: string,
    status: 'approved' | 'rejected',
    options?: { admin_note?: string; tx_hash?: string }
  ) =>
    request(`/api/withdrawals/admin/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...(options || {}) }),
    }),

  getAdminDeposits: () =>
    request<{ deposits: AdminDeposit[] }>('/api/admin/deposits'),

  getRevenueHistory: (source?: string, limit = 100) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (source) params.set('source', source);
    return request<{ events: RevenueEvent[] }>(
      `/api/admin/revenue/history?${params.toString()}`
    );
  },

  // Skins
  getSkins: () => request<{ skins: Skin[] }>('/api/skins'),

  getMySkins: () => request<{ owned: Skin[]; equippedSkinId: string | null }>('/api/skins/my'),

  buySkin: (skinId: string) =>
    request<{ success: boolean; skin: Skin }>('/api/skins/buy', {
      method: 'POST',
      body: JSON.stringify({ skinId }),
    }),

  equipSkin: (skinId: string | null) =>
    request<{ success: boolean; skin?: Skin }>('/api/skins/equip', {
      method: 'POST',
      body: JSON.stringify({ skinId }),
    }),

  getLeaderboard: (limit = 10) =>
    request<{ entries: LeaderboardEntry[] }>(`/api/leaderboard?limit=${limit}`),
};

// ============================================
// Types
// ============================================
export interface User {
  id: string;
  email: string;
  username: string | null;
  avatar: string | null;
  created_at?: string;
  username_changed_at?: string | null;
  account_status?: string;
  is_admin?: boolean;
  game_mode?: 'demo' | 'pro' | null;
  demo_balance?: number;
  equipped_skin_id?: string | null;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: 'deposit' | 'bet' | 'win' | 'skill_purchase' | 'withdraw' | 'withdraw_fee' | 'skin_purchase';
  amount: number;
  reference: string | null;
  status: 'pending' | 'completed' | 'failed';
  created_at: string;
}

export interface Skin {
  id: string;
  skin_key: string;
  name: string;
  description: string;
  price_usd: number;
  tier: 'standard' | 'premium';
  color_primary: string;
  color_secondary: string;
  created_at: string;
}

export interface Trc20Wallet {
  address: string;
  network: string;
  token: string;
  contract: string;
  isNew: boolean;
  note: string;
}

export interface Trc20Deposit {
  id: string;
  tx_hash: string;
  amount: number;
  from_address: string;
  to_address: string;
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
  confirmations: number;
  credited: boolean;
  detected_at: string;
  confirmed_at: string | null;
}

export interface Trc20DepositStatus {
  pending: Trc20Deposit[];
  recentlyConfirmed: Trc20Deposit[];
}

export interface PaymentInvoice {
  id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_url: string | null;
  created_at: string;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  amount: number;
  service_fee?: number;
  network_fee?: number;
  net_amount?: number;
  wallet_address: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_note?: string;
  tx_hash?: string | null;
  approved_at?: string | null;
  created_at: string;
}

// Withdrawal with joined user info (for admin views)
export interface AdminWithdrawal extends Withdrawal {
  users?: { email: string; username: string | null; avatar: string | null } | null;
}

export interface AdminDeposit extends PaymentInvoice {
  users?: { email: string; username: string | null; avatar: string | null } | null;
}

export interface AdminMetrics {
  activeUsers: number;
  totalDeposits: number;
  totalConfirmedPayments: number;
  totalWithdrawals: number;
  totalNetWithdrawn: number;
  activeMatches: number;
  pendingWithdrawals: number;
  totalMatches: number;
  totalRevenue: number;
  revenueBySource: {
    match_rake: number;
    withdraw_fee: number;
    skin_purchase: number;
    zone_penalty: number;
    deposit_fee: number;
  };
}

export interface RevenueEvent {
  id: string;
  source: 'match_rake' | 'withdraw_fee' | 'skin_purchase' | 'zone_penalty' | 'deposit_fee';
  amount: number;
  reference: string | null;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  users?: { email: string; username: string | null } | null;
}

export interface DepositQuote {
  amount: number;
  processorFee: number;
  processorFeeRate: number;
  youPay: number;
  networkLabel: string;
  youReceiveInWallet: number;
  note: string;
}

export interface WithdrawalQuote {
  amount: number;
  serviceFee: number;
  serviceFeePercent: number;
  networkFee: number;
  netAmount: number;
  currency: string;
}

export interface WithdrawalBreakdown {
  amount: number;
  serviceFee: number;
  networkFee: number;
  netAmount: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string | null;
  equippedSkinId: string | null;
  totalEarnings: number;
  winsCount: number;
}
