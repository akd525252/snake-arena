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

  getDeposits: () =>
    request<{ deposits: PaymentInvoice[] }>('/api/payments/deposits'),

  // Withdrawals
  createWithdrawal: (amount: number, wallet_address: string) =>
    request<{ withdrawal: Withdrawal }>('/api/withdrawals', {
      method: 'POST',
      body: JSON.stringify({ amount, wallet_address }),
    }),

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
  getMetrics: () =>
    request<{
      activeUsers: number;
      totalDeposits: number;
      totalWithdrawals: number;
      activeMatches: number;
      pendingWithdrawals: number;
      totalMatches: number;
    }>('/api/admin/metrics'),

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
    request<{ withdrawals: Withdrawal[] }>('/api/withdrawals/admin/pending'),

  approveWithdrawal: (id: string, status: 'approved' | 'rejected', admin_note?: string) =>
    request(`/api/withdrawals/admin/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, admin_note }),
    }),

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
  wallet_address: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_note?: string;
  created_at: string;
}
