# Manual Deployment Guide - Step by Step

This guide walks you through manually deploying/updating your Community Map on Render.com.

---

## Part 1: Prepare Your Code

### Step 1: Verify Your API URL
Open `frontend/app.js` and check line 3-5:
- If your backend is at `https://community-map.onrender.com`, you're good!
- If different, update line 5 to match your backend URL

### Step 2: Commit Your Changes
Run these commands in your terminal (PowerShell):

```powershell
# Navigate to project root
cd C:\Users\Cyber\Desktop\EmergentApp1

# Check what changed
git status

# Add files (we'll exclude .env for security)
git add README.md frontend/ backend/server.py .gitignore DEPLOYMENT.md render.yaml

# Commit
git commit -m "Update app: modern UI, like/dislike, active users, filters"

# Push to GitHub/GitLab/Bitbucket
git push origin main
```

**Note**: If `.env` is already tracked in git and you need to update it, that's okay for now. But ideally, set environment variables in Render Dashboard instead.

---

## Part 2: Update Backend on Render

### Step 1: Go to Render Dashboard
1. Open browser → https://dashboard.render.com
2. Log in to your account

### Step 2: Find Your Backend Service
1. Look for your backend service (might be named "community-map-api" or similar)
2. Click on it to open

### Step 3: Check Environment Variables
1. Click the **"Environment"** tab (left sidebar)
2. Verify these variables exist:
   - ✅ `MONGO_URL` - Your MongoDB connection string
   - ✅ `DB_NAME` - Should be `community_map`
   - ✅ `CORS_ORIGINS` - Should be `*` (or your frontend URL)
   - ✅ `ADMIN_ACCOUNT` - Your admin username
   - ✅ `ADMIN_PIN` - Your admin PIN
   - ✅ `PYTHON_VERSION` - Should be `3.11.0` or `3.13.0`

3. **If any are missing**, click **"Add Environment Variable"** and add them

### Step 4: Check Build Settings
1. Click the **"Settings"** tab
2. Verify:
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Root Directory**: (leave empty - this means root of repo)

### Step 5: Deploy the Backend
You have two options:

**Option A: Auto-Deploy (if enabled)**
- After pushing to git, Render automatically deploys
- Check the **"Events"** tab to see deployment progress
- Wait 2-5 minutes for build to complete

**Option B: Manual Deploy**
1. Click the **"Manual Deploy"** tab
2. Select **"Deploy latest commit"**
3. Click **"Deploy"**
4. Watch the **"Logs"** tab for progress
5. Wait until you see: `Application started` or `Uvicorn running on...`

### Step 6: Test Backend
1. Copy your backend URL (should be something like `https://community-map-api-xxxx.onrender.com`)
2. Open in browser: `YOUR-BACKEND-URL/api/`
3. You should see: `{"message": "Community Map API"}`
4. ✅ If yes, backend is working!

---

## Part 3: Update Frontend on Render

### Step 1: Find Your Frontend Service
1. In Render Dashboard, find your frontend service (Static Site)
2. Click on it

### Step 2: Check Settings
1. Click **"Settings"** tab
2. Verify:
   - **Build Command**: (can be empty or `echo "No build needed"`)
   - **Publish Directory**: `frontend`
   - **Root Directory**: (leave empty)

### Step 3: Update API URL (if needed)
1. If your backend URL is NOT `https://community-map.onrender.com`:
   - Edit `frontend/app.js` line 5
   - Replace `https://community-map.onrender.com/api` with your actual backend URL
   - Commit and push:
     ```powershell
     git add frontend/app.js
     git commit -m "Update API URL"
     git push origin main
     ```

### Step 4: Deploy Frontend
**Option A: Auto-Deploy (if enabled)**
- After git push, it automatically deploys
- Check **"Events"** tab

**Option B: Manual Deploy**
1. Click **"Manual Deploy"** tab
2. Select **"Deploy latest commit"**
3. Click **"Deploy"**
4. Wait 1-2 minutes

### Step 5: Test Frontend
1. Copy your frontend URL (from Render Dashboard)
2. Open in browser
3. Test:
   - ✅ Map loads
   - ✅ Can see incidents (if any)
   - ✅ "Report Incident" button works
   - ✅ Can open detail modals
   - ✅ Active users count shows (if location enabled)

---

## Part 4: Troubleshooting

### Backend not starting?
1. Check **"Logs"** tab for errors
2. Common issues:
   - Missing environment variables → Add them in Environment tab
   - MongoDB connection failed → Check MONGO_URL
   - Port error → Ensure start command uses `$PORT`

### Frontend can't connect to backend?
1. Check browser console (F12) for errors
2. Verify API URL in `frontend/app.js` matches your backend URL
3. Check CORS settings in backend (CORS_ORIGINS should include frontend URL or `*`)

### Environment variables not working?
1. Go to Environment tab
2. Make sure variables are spelled exactly:
   - `MONGO_URL` (not `MONGO_URI` or `MONGO_URL_STRING`)
   - `DB_NAME` (not `DATABASE_NAME`)
3. Click **"Save Changes"** after adding/editing

---

## Quick Checklist

- [ ] Code committed and pushed to git
- [ ] Backend service exists on Render
- [ ] All environment variables set in backend
- [ ] Backend deployed and accessible at `/api/`
- [ ] Frontend service exists on Render
- [ ] Frontend API URL updated (if needed)
- [ ] Frontend deployed and accessible
- [ ] Both services working together

---

## Your Backend URL
After deploying, your backend will have a URL like:
- `https://community-map-api-xxxx.onrender.com`

**Make sure `frontend/app.js` line 5 uses this exact URL!**

---

## Need Help?
- Render Logs: Check the Logs tab for detailed error messages
- Render Docs: https://render.com/docs
- MongoDB: Check MongoDB Atlas connection settings if database errors occur

Good luck! 🚀
