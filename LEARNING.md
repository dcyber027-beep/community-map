# LEARNING.md — Prompts to learn how this project actually works

A curated set of ChatGPT prompts that teach you, hands-on, how the Melbourne
Community Map project is built, deployed, and maintained. Use them one at a
time and add your stack context at the top of each new conversation:

> My stack is **FastAPI + Motor + MongoDB Atlas** backend on **Render**, and a
> **static HTML/CSS/JS frontend with Leaflet + PWA** on **Netlify**, source on
> **GitHub**, developed on **Windows with PowerShell**.

---

## How to use this document

- Paste prompts **one at a time** — do not combine them.
- Always paste the stack context above at the start of a new ChatGPT chat.
- Ask follow-ups like *"Show me the exact PowerShell commands"* or
  *"Why does that step matter?"* — that's where the real learning happens.
- After you've done a section hands-on, come back with *"Now go deeper on
  step 3"* for the next layer.

---

## 1. Project structure & file organisation

```
I have a full-stack web app with this structure:
- backend/  → FastAPI + Motor (async MongoDB) + Pydantic
- frontend/ → static HTML/CSS/JS, Leaflet maps, PWA (manifest.json + sw.js)
- DEPLOYMENT.md and MANUAL_DEPLOY.md
- .melbCommunity/melbCommunity.yml

Explain the purpose of each folder and file, what should NEVER be committed
to git (with .gitignore examples), and how to keep frontend and backend
decoupled so they can be deployed independently. Show me a recommended
production-grade tree for this exact stack.
```

```
What is the difference between a monorepo and split repos for a project
with a FastAPI backend and a static frontend? Given that I deploy backend
on Render and frontend on Netlify, which is better and why?
```

```
Explain the role of these files in my project and whether each is required:
requirements.txt, .env, manifest.json, sw.js, _headers, _redirects,
runtime.txt, Procfile, render.yaml, netlify.toml.
```

---

## 2. Local development setup (first time)

```
Walk me through setting up a FastAPI + MongoDB + static frontend project
locally on Windows 10/11 using PowerShell. I need:
- Python venv creation and activation
- pip install -r requirements.txt
- MongoDB Atlas free-tier connection string in a .env file
- Running uvicorn for the backend on port 8000
- Serving the static frontend with `python -m http.server` on port 3000
- CORS so the frontend can talk to the backend
Give me the exact commands in order.
```

```
What is a Python virtual environment, why do I need one, and what's the
difference between venv, conda, and pipenv? Which should I use for a
FastAPI project deployed on Render?
```

```
Explain environment variables: what they are, why secrets like MONGO_URL
must not be committed, how python-dotenv loads them locally, and how
they're set differently on Render and Netlify.
```

---

## 3. Git fundamentals

```
I'm new to git. Explain the mental model: working directory, staging area,
local repo, remote repo. Then give me the 10 commands I'll use 95% of the
time (status, add, commit, push, pull, log, diff, branch, checkout, restore)
with one concrete example for each.
```

```
What is the difference between `git add .`, `git add -A`, `git add -u`,
and `git add <file>`? When should I use each?
```

```
Explain HEAD, main, origin, origin/main, and "detached HEAD" in plain
English with examples.
```

```
Show me how to write a good commit message. What is conventional commits?
Give me 5 real examples for a project like mine (a community map app).
```

```
What does `git push origin main` actually do under the hood, step by step?
What happens if it's rejected and how do I fix common errors like
"non-fast-forward" or "behind the remote"?
```

---

## 4. GitHub specifics

```
I've created a local git repo. Walk me step-by-step through:
1. Creating a new GitHub repository (public vs private)
2. Connecting my local repo to it (`git remote add origin`)
3. The first push with `-u`
4. Setting up a personal access token (PAT) on Windows for HTTPS pushes,
   because GitHub no longer accepts passwords
5. Or alternatively, setting up SSH keys
Which is easier for a beginner on Windows?
```

```
Explain GitHub branches, pull requests, and merging — even if I'm working
solo, why are they useful? Show me a workflow for adding a new feature
safely without breaking `main`.
```

```
What is a .gitignore file? Give me a complete .gitignore for a project
with a Python FastAPI backend (with venv, __pycache__, .env) and a static
JS frontend (node_modules if I use a build tool, .DS_Store, etc.).
```

---

## 5. First-time deployment — Backend on Render

```
I have a FastAPI app in backend/server.py with requirements.txt and a
.env file. Walk me through deploying it to Render.com for free, step by step:
1. Creating a Render account and linking GitHub
2. Creating a new "Web Service"
3. Setting build command (`pip install -r requirements.txt`)
4. Setting start command (`uvicorn server:app --host 0.0.0.0 --port $PORT`)
5. Adding environment variables (MONGO_URL, DB_NAME)
6. Free tier limitations (sleeps after 15 min of inactivity) and how to
   handle them
7. Reading deployment logs when something fails
```

```
My Render backend sleeps after 15 minutes. Explain all the options to
keep it warm (cron pings, UptimeRobot, paid tier) and the trade-offs of
each. I currently show a "waking up" loading overlay in the frontend —
is that a reasonable solution?
```

```
How do I connect MongoDB Atlas (free M0 cluster) to my Render-hosted
FastAPI app? Walk me through:
1. Creating the cluster
2. Database user + password
3. Network access (0.0.0.0/0 for Render or specific IPs?)
4. Building the connection string
5. Putting it in Render's environment variables
What are the security risks of 0.0.0.0/0 and what's the alternative?
```

---

## 6. First-time deployment — Frontend on Netlify

```
I have a static frontend folder with index.html, app.js, styles.css,
manifest.json, sw.js, and an icons/ folder. Walk me through deploying
it to Netlify, step by step:
1. Connecting Netlify to my GitHub repo
2. Setting base directory to `frontend/`
3. Build command (none — it's static) and publish directory
4. Setting the backend API URL via env var or hardcoded constant
5. Custom domain (optional)
6. HTTPS (automatic via Let's Encrypt)
```

```
Explain Netlify's _headers and _redirects files. When do I need each?
Give me examples for:
- Allowing my service worker to control the whole site (Service-Worker-Allowed)
- Setting the correct MIME type for manifest.json
- SPA-style fallback redirects to index.html
```

```
My frontend calls a backend at https://my-app.onrender.com. How do I
configure CORS correctly on the FastAPI side so Netlify's domain can
talk to it without breaking? Show me FastAPI's CORSMiddleware config.
```

---

## 7. Deploying changes after a commit (the daily workflow)

```
I have auto-deploy enabled on both Netlify and Render, connected to my
GitHub main branch. Walk me through what happens, end-to-end, when I run:

git add .
git commit -m "fix: update map tiles to CARTO Voyager"
git push origin main

What does each platform do? How long does each take? How do I monitor
the deploy? What do I do if Netlify or Render fails the build?
```

```
What's the safest workflow for deploying a small change to production
when I'm a solo developer? Should I push directly to main, or use feature
branches and PRs even when working alone? Give me a recommended workflow.
```

```
My frontend deployed but the change isn't showing up in my browser.
Explain the layers of caching that could be at play:
- Browser cache
- Service worker cache (sw.js)
- Netlify CDN edge cache
- DNS cache
How do I bust each one? What's a cache-busting strategy I should bake in
(e.g., versioned filenames, query strings, Cache-Control headers)?
```

```
How do I roll back a bad deploy on Netlify and Render? Explain both the
git-revert approach (`git revert <hash>`) and the platform-native rollback
UI. Which is better and when?
```

---

## 8. PWA & service workers

```
Explain Progressive Web Apps in plain language. What does manifest.json
do, what does sw.js do, and how do they make a website installable on
mobile? Walk through the lifecycle of a service worker: install →
activate → fetch.
```

```
My service worker is caching old files and users see stale content after
I deploy. Explain cache-versioning strategies (CACHE_NAME = 'v1', 'v2'...)
and the skipWaiting / clients.claim pattern. Give me a production-ready
sw.js template for a static site that calls an external API.
```

---

## 9. Debugging deployments

```
My Render build failed. What are the most common reasons a FastAPI
deployment fails on Render and how do I read the logs to find the cause?
List the top 10 errors with their fixes.
```

```
My Netlify deploy succeeded but the site is broken. Walk me through
debugging:
1. Browser DevTools Console errors
2. Network tab — checking which requests fail (CORS, 404, 500)
3. Application tab — manifest, service worker, storage
4. Netlify's deploy log and function log
```

```
What is CORS, why does it exist, and why does it constantly break
frontend-backend communication during deployment? Show me how to
diagnose a CORS error from the browser console and fix it on the
FastAPI side.
```

---

## 10. Going beyond the basics

```
I want to add automated testing and CI/CD to my project. Explain GitHub
Actions in simple terms and give me a basic workflow that:
1. Runs pytest on the backend on every push
2. Runs a JS linter on the frontend
3. Only deploys if tests pass
```

```
What are the security basics I should know as a beginner deploying a
public web app? Cover: secrets management, HTTPS, rate limiting,
authentication, MongoDB injection, XSS, CSRF, and how each applies (or
doesn't) to a FastAPI + static JS setup.
```

```
How do I monitor a live web app for free? Explain uptime monitoring
(UptimeRobot), error tracking (Sentry free tier), and basic analytics
(Plausible, Umami, or Google Analytics) and how I'd add each to my app.
```

---

## Suggested learning order

If you're starting from zero, do them in this order:

1. **Section 3** — Git fundamentals (you'll use this every day)
2. **Section 4** — GitHub specifics (one-time setup pain)
3. **Section 1** — Project structure (why your repo looks the way it does)
4. **Section 2** — Local dev setup (run the app on your machine)
5. **Section 5** — Backend deploy on Render
6. **Section 6** — Frontend deploy on Netlify
7. **Section 7** — Daily deploy workflow (this is your real job)
8. **Section 9** — Debugging (because things will break)
9. **Section 8** — PWA & service workers (when you want to polish)
10. **Section 10** — CI/CD, security, monitoring (when you're ready to level up)

---

## A few extra "meta" prompts to keep handy

```
Pretend you're a senior engineer reviewing my project. Look at this file
[paste content] and tell me three things that could be improved, ordered
by impact. Be specific and show me the code changes.
```

```
I made this change to my project: [paste diff]. Before I commit and deploy,
play devil's advocate — what could go wrong in production? What edge cases
am I missing?
```

```
Explain this code to me line by line as if I'm a junior developer:
[paste code block]
```

```
I'm getting this error: [paste error]. Don't just give me the fix —
explain what the error means, why it happens, and three ways to prevent
it from happening again.
```

---

Happy learning. Bookmark this file and revisit it whenever you hit a wall.
