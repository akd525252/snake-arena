import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth';
import walletRoutes from './routes/wallet';
import paymentRoutes from './routes/payments';
import withdrawalRoutes from './routes/withdrawals';
import matchmakingRoutes from './routes/matchmaking';
import adminRoutes from './routes/admin';
import skinsRoutes from './routes/skins';
import leaderboardRoutes from './routes/leaderboard';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Trust the first proxy (Railway, Vercel, etc.) so req.ip resolves to the
// real client IP via X-Forwarded-For. Without this every request would be
// keyed by the proxy IP, making rate limiting useless.
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());

// Global rate limiter — generous baseline for normal browsing.
// Per-route limiters in middleware/rateLimits.ts apply stricter caps to
// sensitive endpoints (auth, deposits, withdrawals, purchases).
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  // Skip the NOWPayments IPN webhook — it can fire dozens of times per
  // invoice, and bursts of confirmations would otherwise hit the cap.
  skip: req => req.path === '/api/payments/webhook',
});
app.use('/api/', limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/matchmaking', matchmakingRoutes);
app.use('/api/skins', skinsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Friendly status page at root so visiting the Railway URL doesn't show "Cannot GET /"
app.get(['/', '/status'], (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Snake Arena · API</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{margin:0;background:#05050a;color:#e0e0e8;font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:560px;width:100%;background:#0a0a12;border:1px solid #1a1a2e;border-radius:24px;padding:40px;text-align:center;box-shadow:0 0 60px rgba(0,240,255,0.06)}
  h1{margin:0 0 8px 0;font-size:28px;color:#00f0ff;letter-spacing:1px}
  .pill{display:inline-block;padding:6px 14px;border-radius:999px;background:#39ff1422;color:#39ff14;font-weight:700;font-size:12px;margin:12px 0;border:1px solid #39ff1444}
  p{margin:8px 0;color:#8a8a9a;line-height:1.6}
  code{background:#11111a;padding:2px 8px;border-radius:6px;color:#00f0ff;font-size:13px}
  ul{text-align:left;color:#8a8a9a;font-size:13px;margin-top:18px;padding-left:20px}
  ul li{margin:4px 0}
  .stats{margin-top:24px;font-size:12px;color:#5a5a6a}
</style>
</head>
<body>
  <div class="card">
    <h1>SNAKE ARENA · API</h1>
    <div class="pill">● Backend Online</div>
    <p>This is the <strong>REST API backend</strong> for Snake Arena. The admin dashboard, deposits, and withdrawals live in the web app.</p>
    <ul>
      <li><code>/api/auth</code> &mdash; Login &amp; user profile</li>
      <li><code>/api/wallet</code> &mdash; Balance &amp; transactions</li>
      <li><code>/api/payments</code> &mdash; Deposits (NOWPayments)</li>
      <li><code>/api/withdrawals</code> &mdash; Withdraw requests</li>
      <li><code>/api/admin</code> &mdash; Admin metrics, revenue, users</li>
      <li><code>/api/skins</code> &mdash; Skin shop</li>
      <li><code>/api/health</code> &mdash; Service health</li>
    </ul>
    <p style="margin-top:24px">Open the web app and sign in as an admin to manage withdrawals &amp; revenue.</p>
    <div class="stats">${new Date().toISOString()}</div>
  </div>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`[Backend] Server running on port ${PORT}`);
});

export default app;
