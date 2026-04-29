# 🚀 Simple Deployment Steps

## What We Are Doing
1. Put code on GitHub
2. Connect GitHub to Railway (auto-deploys backend + game server)
3. Connect GitHub to Vercel (auto-deploys frontend)
4. Add environment variables (API keys)

---

## Step 1: Put Code on GitHub (2 minutes)

### A. Go to GitHub and create a new empty repo
1. Open https://github.com/new in your browser
2. Type `snake-arena` as the repo name
3. Select **Private** (so no one sees your code)
4. **UNCHECK** "Add a README" (we already have one)
5. Click **Create repository**

### B. Push your code to GitHub
Copy and paste this exact command into your terminal (PowerShell):

```powershell
cd "D:\Snake Run\snake-arena"
git remote add origin https://github.com/YOUR_USERNAME/snake-arena.git
git branch -M main
git push -u origin main
```

**Replace `YOUR_USERNAME` with your actual GitHub username.**

When it asks for password, use a **GitHub Personal Access Token** (not your password).

If you don't have one:
1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Check the `repo` checkbox
4. Generate and copy the token
5. Paste it when asked for password

---

## Step 2: Deploy Backend to Railway (3 minutes)

### A. Open Railway
Go to: https://railway.com/project/3b320651-abac-428c-a675-91f40f967bbb

### B. Add Backend Service
1. Click **"New"** button (big blue button)
2. Click **"GitHub Repo"**
3. Select your `snake-arena` repo
4. Click on the new service that appears
5. Click **"Settings"** tab
6. Under **"Root Directory"**, type: `backend`
7. Click **"Deploy"**

### C. Add Environment Variables
Click **"Variables"** tab, then add these one by one:

| Name | Value | Where to find |
|------|-------|---------------|
| `PORT` | `4000` | Just type it |
| `JWT_SECRET` | Make up a long random password | Make up something like `MySuperSecretKey123!@#` |
| `SUPABASE_URL` | Your Supabase URL | Supabase dashboard → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | Your service role key | Supabase dashboard → Project Settings → API → `service_role` key |
| `NOWPAYMENTS_API_KEY` | Your NOWPayments key | NOWPayments dashboard |
| `NOWPAYMENTS_IPN_SECRET` | Your IPN secret | NOWPayments dashboard |
| `FRONTEND_URL` | `https://your-app.vercel.app` | We'll update this later |
| `BACKEND_URL` | Leave blank for now | Railway will give you this |

Click **"Redeploy"** after adding all variables.

---

## Step 3: Deploy Game Server to Railway (2 minutes)

### A. Add Game Server Service
1. In the same Railway project, click **"New"**
2. Click **"GitHub Repo"**
3. Select `snake-arena` again
4. Click on the new service
5. Click **"Settings"** tab
6. Under **"Root Directory"**, type: `game-server`
7. Click **"Deploy"**

### B. Add Environment Variables
Click **"Variables"** tab, add these:

| Name | Value |
|------|-------|
| `PORT` | `4001` |
| `JWT_SECRET` | **Same exact value as backend** |
| `SUPABASE_URL` | Same as backend |
| `SUPABASE_SERVICE_KEY` | Same as backend |
| `BACKEND_URL` | Copy from your backend service domain (click backend service → see the domain URL) |

Click **"Redeploy"**

---

## Step 4: Update Backend URL

After game server deploys:
1. Go back to your **Backend** service in Railway
2. Click **"Variables"**
3. Add `BACKEND_URL` = the domain Railway gave your backend (e.g., `https://snake-arena-backend.up.railway.app`)
4. Click **"Redeploy"**

---

## Step 5: Deploy Frontend to Vercel (2 minutes)

### A. Open Vercel
Go to https://vercel.com/dashboard

### B. Import Project
1. Click **"Add New..."** → **"Project"**
2. Select your `snake-arena` GitHub repo
3. Click **"Import"**
4. Under **"Root Directory"**, type: `frontend`
5. Click **"Deploy"**

### C. Add Environment Variables
After first deploy, go to **Project Settings** → **Environment Variables**:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_BACKEND_URL` | Your Railway backend domain (with `https://`) |
| `NEXT_PUBLIC_GAME_SERVER_URL` | Your Railway game server domain (with `wss://`) |
| `NEXT_PUBLIC_SITE_URL` | Your Vercel domain |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase `anon` key |

Click **"Redeploy"**

---

## Step 6: Update Backend CORS

Go back to Railway backend service:
1. Click **"Variables"**
2. Update `FRONTEND_URL` to your actual Vercel domain (e.g., `https://snake-arena.vercel.app`)
3. Click **"Redeploy"**

---

## ✅ Done!

Your app should now be live at your Vercel URL.

---

## 🆘 If Something Goes Wrong

**Build fails?**
- Check Railway build logs (click the service → "Deployments" tab → click latest deploy → "Logs")

**Health check fails?**
- Make sure `PORT` variable is set correctly

**Can't connect from frontend?**
- Make sure `FRONTEND_URL` on backend matches your Vercel URL exactly
- Make sure game server uses `wss://` (not `ws://`) in `NEXT_PUBLIC_GAME_SERVER_URL`

---

## Your Railway Project
https://railway.com/project/3b320651-abac-428c-a675-91f40f967bbb
