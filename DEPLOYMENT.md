# Deployment Guide for Community Map

This guide will help you deploy (or update) your Community Map application on Render.com.

## Prerequisites
- Render.com account
- MongoDB Atlas account (or MongoDB connection string)
- Git repository (GitHub, GitLab, or Bitbucket) connected to Render

---

## Step 1: Update Your Backend Service

### If you already have a backend service on Render:

1. **Go to Render Dashboard**: https://dashboard.render.com
2. **Find your backend service** (likely named "community-map-api" or similar)
3. **Go to Environment tab** and verify these environment variables are set:
   - `MONGO_URL` - Your MongoDB connection string
   - `DB_NAME` - `community_map`
   - `CORS_ORIGINS` - `*` (or your frontend URL)
   - `ADMIN_ACCOUNT` - Your admin username
   - `ADMIN_PIN` - Your admin PIN
   - `PYTHON_VERSION` - `3.11.0` (or `3.13.0` if preferred)

4. **Update the service**:
   - Go to the **Settings** tab
   - Check **Build Command**: Should be `pip install -r backend/requirements.txt`
   - Check **Start Command**: Should be `cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT`
   - Check **Root Directory**: Leave empty (or set to repo root)

5. **Manual Deploy**:
   - Go to **Manual Deploy** tab
   - Click **Deploy latest commit** (or push new commits to trigger auto-deploy)

### If you need to create a new backend service:

1. **In Render Dashboard**, click **"New +"** → **"Web Service"**
2. **Connect your repository** (GitHub/GitLab/Bitbucket)
3. **Configure the service**:
   - **Name**: `community-map-api`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Free

4. **Add Environment Variables**:
   - `MONGO_URL` - Your MongoDB connection string
   - `DB_NAME` = `community_map`
   - `CORS_ORIGINS` = `*` (update later with your frontend URL for security)
   - `ADMIN_ACCOUNT` = Your admin username
   - `ADMIN_PIN` = Your admin PIN
   - `PYTHON_VERSION` = `3.11.0`

5. **Create Service** - Render will automatically deploy

---

## Step 2: Update Your Frontend Service

### If you already have a frontend service on Render:

1. **Find your frontend service** in Render Dashboard
2. **Go to Settings** tab
3. Verify:
   - **Build Command**: (can be empty or `echo "No build needed"`)
   - **Publish Directory**: `frontend`
   - **Root Directory**: (leave empty)

4. **Update the API URL**:
   - The `frontend/app.js` file now automatically uses:
     - `http://localhost:8000/api` for local development
     - `https://community-map.onrender.com/api` for production
   - **Update line 3 in `frontend/app.js`** if your backend URL is different

5. **Deploy**: Push commits or use Manual Deploy

### If you need to create a new frontend service:

1. **In Render Dashboard**, click **"New +"** → **"Static Site"**
2. **Connect your repository**
3. **Configure**:
   - **Name**: `community-map-frontend`
   - **Build Command**: (leave empty or use `echo "No build needed"`)
   - **Publish Directory**: `frontend`
   - **Plan**: Free

4. **Create Static Site** - Render will deploy

5. **Update API URL**: 
   - Edit `frontend/app.js` line 3
   - Replace `https://community-map.onrender.com/api` with your actual backend URL
   - Commit and push changes

---

## Step 3: Update Your Deployment

### Quick Update (if services already exist):

1. **Commit your changes**:
   ```bash
   git add .
   git commit -m "Update app with new features"
   git push origin main
   ```

2. **Render will auto-deploy** (if auto-deploy is enabled)
   - Or manually trigger deploy from Render Dashboard

3. **Verify deployment**:
   - Backend: Check the backend service logs for errors
   - Frontend: Visit your frontend URL and test the app

---

## Step 4: Update API URL in Frontend

After deploying your backend, you'll get a URL like:
- `https://community-map-api.onrender.com`

**Update the frontend**:

1. Edit `frontend/app.js` line 3-4:
   ```javascript
   const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
     ? "http://localhost:8000/api" 
     : "https://YOUR-BACKEND-URL.onrender.com/api";
   ```

2. Replace `YOUR-BACKEND-URL` with your actual backend service URL

3. Commit and push:
   ```bash
   git add frontend/app.js
   git commit -m "Update API URL for production"
   git push origin main
   ```

---

## Troubleshooting

### Backend Issues:
- Check logs in Render Dashboard → Your Service → Logs
- Verify all environment variables are set correctly
- Ensure MongoDB connection string is correct
- Check that Python version matches your local environment

### Frontend Issues:
- Verify API_BASE URL points to correct backend
- Check browser console for CORS errors
- Ensure backend CORS_ORIGINS includes your frontend URL

### Environment Variables:
- **Never commit `.env` file** - use Render's Environment Variables
- Update `.env` locally for development only

---

## Important Notes

1. **Auto-Deploy**: Render automatically deploys on git push (if enabled)
2. **Free Tier**: Services sleep after 15 minutes of inactivity (first request will be slow)
3. **CORS**: Update `CORS_ORIGINS` in backend to your frontend URL for better security
4. **MongoDB**: Ensure your MongoDB Atlas allows connections from Render's IPs (or use 0.0.0.0/0 for testing)

---

## Quick Commands

```bash
# Check git status
git status

# Add all changes
git add .

# Commit changes
git commit -m "Your commit message"

# Push to trigger deployment
git push origin main
```

Your Render services should auto-deploy after you push! 🚀
