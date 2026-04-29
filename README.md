# Snake Arena

Real-time multiplayer snake game with crypto betting.
Built with **Next.js + Phaser** (frontend), **Node.js + Express + native WebSocket** (backend/game-server), **Supabase** (database/auth), **NOWPayments** (crypto deposits).

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16, React, TailwindCSS, Phaser 3 |
| Backend API | Node.js, Express, JWT, Supabase service role |
| Game Server | Node.js, native `ws` WebSocket library |
| Database | Supabase (Postgres + Auth) |
| Payments | NOWPayments (USDT-TRC20) |
| Hosting | Frontend → Vercel · Backend & Game Server → Railway |

## Folder Structure

```
snake-arena/
  frontend/      # Next.js + Phaser client
  backend/       # Express REST API (auth, wallet, payments, withdrawals, admin)
  game-server/   # Native WebSocket game server (matchmaking, simulation)
  database/      # SQL schema for Supabase
```

## Quick Start

### 1. Install dependencies

```powershell
npm run install:all
```

### 2. Configure environment files

Three env files need real values:

- `frontend/.env.local`
- `backend/.env`
- `game-server/.env`

See `.env.example` files for required keys. **Both backend and game-server must share the same `JWT_SECRET`.**

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run the contents of `database/schema.sql`.
3. Enable **Email** and **Google** providers under Authentication → Providers.
4. Copy `Project URL`, `anon key`, and `service_role key` into the env files.

### 4. Set up NOWPayments (optional for development)

1. Register at [nowpayments.io](https://nowpayments.io).
2. Generate an API key and an IPN secret.
3. Set `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` in `backend/.env`.

### 5. Run all three services in dev mode

```powershell
npm run dev
```

This starts (in parallel):
- Frontend on [http://localhost:3000](http://localhost:3000)
- Backend API on [http://localhost:4000](http://localhost:4000)
- Game Server WebSocket on `ws://localhost:4001`

## Game Mechanics

| Item | Value |
|---|---|
| Tick rate | 50 ms (20 ticks/sec) |
| Coin value | $0.10 USDT |
| Speed Boost cost | $0.05 USDT, 3 s duration |
| Fake Coin Trap cost | $0.10 USDT, slows for 3 s |
| Match duration | 3 minutes |
| Min / Max players | 3 / 10 |
| Bet matching range | ± 5 USDT |
| Queue timeout | 15 s |
| Min withdrawal | 5 USDT |
| Account age lock | 24 h after signup |

## Controls

- **WASD** or **Arrow keys** — Move
- **SPACE** — Speed Boost
- **SHIFT** — Place Fake Coin Trap

## Phase Roadmap

- [x] Phase 1 — Project Infrastructure
- [x] Phase 2 — Authentication (Supabase + JWT)
- [x] Phase 3 — Wallet System (ledger-based)
- [x] Phase 4 — Crypto Deposits (NOWPayments + webhook)
- [x] Phase 5 — Withdrawal System (admin approval)
- [x] Phase 6 — WebSocket Game Server (native `ws`)
- [x] Phase 7 — Matchmaking System
- [x] Phase 8 — Game Mechanics (Phaser)
- [x] Phase 9 — Skills System
- [x] Phase 10 — Demo Mode (AI bots)
- [x] Phase 11 — Admin Dashboard
- [x] Phase 12 — Security (Helmet, JWT, rate limit, anti-cheat)
- [ ] Phase 13 — Production deployment (Vercel + Railway)
- [ ] Phase 14 — Beta testing

## Deployment

### Frontend → Vercel

1. Push the repo to GitHub.
2. Import into Vercel and set root directory to `frontend`.
3. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_GAME_SERVER_URL`.

### Backend → Railway

1. Create a new Railway service from the same repo.
2. Set root directory to `backend`. Build command: `npm install && npm run build`. Start: `npm start`.
3. Set env vars from `backend/.env.example` with real values.

### Game Server → Railway

1. Create another Railway service.
2. Set root directory to `game-server`. Build: `npm install && npm run build`. Start: `npm start`.
3. Use the **same** `JWT_SECRET` as the backend.

### Database → Supabase

Already hosted. Just keep the schema and policies in sync via `database/schema.sql`.

## Architecture

```
Player Browser
   ↓
Next.js + Phaser (Vercel)
   ↓                   ↓
Backend REST API     Game Server WebSocket
(Railway)            (Railway, native ws)
   ↓
Supabase Postgres + Auth
   ↓
NOWPayments (deposit webhooks)
```

## Security Notes

- Never expose `SUPABASE_SERVICE_KEY` to the frontend.
- The game server validates JWTs issued by the backend before accepting WS connections.
- All wallet mutations go through `addTransaction()` in `backend/src/routes/wallet.ts` — no direct balance updates.
- NOWPayments IPN webhook is HMAC-verified against `NOWPAYMENTS_IPN_SECRET`.
- Rate limiting (100 req / 15 min) applied to all `/api/*` routes via `express-rate-limit`.
