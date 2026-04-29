# Snake Arena - Deployment Guide

## Project URLs
- **Railway Project**: https://railway.com/project/3b320651-abac-428c-a675-91f40f967bbb
- **GitHub Repo**: (You need to create this - see Step 1)

---

## Step 1: Push Code to GitHub

### Create a GitHub repository
1. Go to https://github.com/new
2. Repository name: `snake-arena`
3. Make it **Private** (recommended - contains deployment configs)
4. Do NOT initialize with README (we already have one)
5. Click **Create repository**

### Push your local code
Copy and run these exact commands in your terminal:

```powershell
# Make sure you're in the snake-arena folder
cd "D:\Snake Run\snake-arena"

# Add the GitHub remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/snake-arena.git

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy Backend to Railway

### Create the Backend Service
1. Go to your Railway project: https://railway.com/project/3b320651-abac-428c-a675-91f40f967bbb
2. Click **New** → **GitHub Repo**
3. Select your `snake-arena` repository
4. Railway will detect the Dockerfile automatically

### Configure the Backend Service
Click on the newly created service, then set:

**Settings → Build:**
- Builder: `Dockerfile`
- Root Directory: `backend`
- Dockerfile Path: `Dockerfile` (auto-detected)

**Settings → Deploy:**
- Healthcheck Path: `/api/health`
- Healthcheck Timeout: `30`
- Restart Policy: `ON_FAILURE`
- Max Retries: `10`

**Variables (Environment):**
Add these one by one:

| Variable | Value | Notes |
|----------|-------|-------|
| `PORT` | `4000` | Required |
| `FRONTEND_URL` | `https://your-app.vercel.app` | Change after Vercel deploy |
| `JWT_SECRET` | `your-strong-secret-here` | Generate a random 32+ char string |
| `SUPABASE_URL` | `your-supabase-url` | From Supabase dashboard |
| `SUPABASE_SERVICE_KEY` | `your-service-role-key` | From Supabase dashboard (NOT anon key) |
| `NOWPAYMENTS_API_KEY` | `your-nowpayments-key` | From NOWPayments dashboard |
| `NOWPAYMENTS_IPN_SECRET` | `your-ipn-secret` | From NOWPayments dashboard |
| `BACKEND_URL` | `https://backend-xxx.up.railway.app` | Railway gives you this after first deploy |

### Deploy
Click **Deploy** and wait for the health check to pass.

---

## Step 3: Deploy Game Server to Railway

### Create the Game Server Service
1. In the same Railway project, click **New** → **GitHub Repo**
2. Select your `snake-arena` repository again

### Configure the Game Server Service
**Settings → Build:**
- Builder: `Dockerfile`
- Root Directory: `game-server`
- Dockerfile Path: `Dockerfile`

**Settings → Deploy:**
- Healthcheck Path: `/health`
- Healthcheck Timeout: `30`
- Restart Policy: `ON_FAILURE`
- Max Retries: `10`

**Variables (Environment):**

| Variable | Value | Notes |
|----------|-------|-------|
| `PORT` | `4001` | Required |
| `JWT_SECRET` | `same-as-backend` | Must match backend JWT_SECRET exactly |
| `SUPABASE_URL` | `your-supabase-url` | Same as backend |
| `SUPABASE_SERVICE_KEY` | `your-service-role-key` | Same as backend |
| `BACKEND_URL` | `https://backend-xxx.up.railway.app` | Copy from your backend service domain |

### Deploy
Click **Deploy** and wait for health check to pass.

**Important:** After the game server deploys, go back to the **Backend service** and update its `BACKEND_URL` to its actual Railway domain. Then redeploy the backend.

---

## Step 4: Deploy Frontend to Vercel

### Environment Variables
Go to your Vercel project → **Settings** → **Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_BACKEND_URL` | `https://your-backend-domain.up.railway.app` |
| `NEXT_PUBLIC_GAME_SERVER_URL` | `wss://your-game-server-domain.up.railway.app` |
| `NEXT_PUBLIC_SITE_URL` | `https://your-app.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | `your-supabase-url` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `your-supabase-anon-key` |

### Redeploy
Click **Redeploy** in Vercel dashboard.

---

## Step 5: Final CORS Update

After you have your Vercel domain, update the Backend service variable:
- `FRONTEND_URL` = `https://your-app.vercel.app`

Redeploy the backend once more.

---

## Health Check Endpoints

- **Backend**: `GET https://your-backend.up.railway.app/api/health`
- **Game Server**: `GET https://your-game-server.up.railway.app/health`

Both should return: `{"status":"ok","timestamp":"..."}`

---

## Files Already Prepared

- `backend/Dockerfile` - Node 20 Alpine, builds TypeScript
- `backend/railway.json` - Health check `/api/health`
- `game-server/Dockerfile` - Node 20 Alpine, builds TypeScript
- `game-server/railway.json` - Health check `/health`
- `.gitignore` - Excludes `.env`, `node_modules`, `dist`, `.next`

---

## Troubleshooting

**Build fails?** Check Railway build logs for npm install errors.

**Health check fails?** Make sure PORT environment variable is set.

**CORS errors in frontend?** Update `FRONTEND_URL` on backend to match your Vercel domain exactly.

**WebSocket fails?** Make sure `NEXT_PUBLIC_GAME_SERVER_URL` uses `wss://` (not `ws://`) and matches the Railway game server domain.

---

## Need Help?

Railway Project ID: `3b320651-abac-428c-a675-91f40f967bbb`

You can also use Railway's web dashboard for everything - no CLI needed.
