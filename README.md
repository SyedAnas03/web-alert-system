# Web Alert System — Setup & Viva Guide

This is a working real-time notification platform matching your FYP proposal, built with:
- **Backend:** Node.js + Express
- **Database:** MongoDB (via Mongoose)
- **Real-time:** Socket.IO
- **Auth:** JWT + bcrypt password hashing
- **Email:** Nodemailer
- **Frontend:** Plain HTML/CSS/JS (no framework — easier to explain and demo)

---

## 1. Prerequisites

Install these once on your machine:
- **Node.js** (v18 or later) — download from nodejs.org
- **MongoDB** — either:
  - Install locally (mongodb.com/try/download/community), OR
  - Easier: create a free cloud database at mongodb.com/cloud/atlas (no local install needed)
- **VS Code** (or any editor) with the "Live Server" extension, for running the frontend

---

## 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
```

Now open `.env` and fill in:
- `MONGO_URI` — your local MongoDB URL or your Atlas connection string
- `JWT_SECRET` — any random long string, e.g. `mySecretKey12345xyz`
- `EMAIL_USER` / `EMAIL_PASS` — your Gmail + an "App Password" (see note below)

**Getting a Gmail App Password:**
1. Turn on 2-Step Verification on your Google account
2. Go to myaccount.google.com/apppasswords
3. Generate a password for "Mail" — use that 16-character code as `EMAIL_PASS`

Then start the backend:
```bash
npm start
```
You should see `MongoDB connected successfully` and `Server running on http://localhost:5000`.

---

## 3. Frontend Setup

No install needed — it's plain HTML/CSS/JS.

1. Open the `frontend` folder in VS Code
2. Right-click `index.html` → "Open with Live Server" (or just double-click the file to open it in a browser, though Live Server is more reliable for Socket.IO)
3. Register two accounts to test with:
   - One with role **Admin** — this is who sends alerts
   - One with role **User** — this is who receives them

---

## 4. Testing the Real-Time Flow

1. Open the **Admin** dashboard in one browser tab (log in as admin)
2. Open the **User** view in another tab/browser (log in as user)
3. From the admin dashboard, create an alert
4. Watch it appear **instantly** on the user's screen — no refresh. This is the core "wow" demo moment for your viva.

---

## 5. How This Maps to Your Proposal (for your viva)

| Proposal Feature | Where it lives in the code |
|---|---|
| Real-Time Notifications | `server.js` (Socket.IO setup) + `routes/alerts.js` (`io.emit(...)`) + `dashboard.html`/`user.html` (`socket.on(...)`) |
| User Authentication | `routes/auth.js`, `models/User.js` (bcrypt hashing), `middleware/auth.js` (JWT check) |
| Admin Dashboard | `dashboard.html` + role-restricted routes via `middleware/roleCheck.js` |
| Multi-Channel Alerts (Web + Email) | `utils/email.js` triggered from `routes/alerts.js` when `sendEmail: true` |
| Alert Categories | `category` field in `models/Alert.js` (Emergency / System Update / General Announcement) |
| Alert History | `GET /api/alerts` returns all alerts sorted newest-first — timestamps come free from Mongoose's `timestamps: true` |
| Password hashing (bcrypt) | `models/User.js`, the `pre("save")` hook |
| JWT authentication | `middleware/auth.js` |
| Role-based API protection | `middleware/roleCheck.js`, applied to admin-only routes |
| Rate limiting | `server.js`, the `express-rate-limit` middleware applied to all `/api` routes |

**Likely viva questions and short answers:**
- *"Why MongoDB and not SQL?"* — Alerts and users are simple, self-contained documents with no complex relational joins needed, so a document database keeps the code simpler.
- *"How does real-time actually work?"* — Socket.IO keeps a persistent connection open between browser and server (built on WebSockets). When an alert is created, the server calls `io.emit()`, which pushes it to every connected browser instantly, instead of the browser having to repeatedly ask "anything new?".
- *"How do you know only admins can send alerts?"* — Every alert-creation route runs `middleware/auth.js` (checks the JWT is valid) then `middleware/roleCheck.js` (checks `role === "admin"`), rejecting anyone else with a 403 error.
- *"Where are passwords stored?"* — Never in plain text. `bcrypt` hashes them before saving, and login compares the entered password's hash, not the raw text.

---

## 5b. New: Discord Webhook + Analytics (added for demo polish)

**Discord mirroring:** every alert can also post live to a Discord channel — great for a viva demo (send an alert, show it appear on your phone's Discord app instantly).
1. In your Discord server, go to a channel → Settings (gear icon) → Integrations → Webhooks → New Webhook → Copy Webhook URL
2. Paste it into `.env` as `DISCORD_WEBHOOK_URL=...`
3. Restart the backend (`Ctrl+C` then `npm start`)
4. Send an alert from the admin dashboard — it now appears in Discord too, no extra steps needed. Leave this blank if you don't want it — nothing else breaks.

**Live stats + chart:** the admin dashboard now shows total alerts, alerts sent today, users online right now (updates live via Socket.IO), and a 7-day bar chart of alert volume — all pulled from a new `GET /api/alerts/stats` endpoint.

**Redesigned UI:** both dashboards now use a "dispatch console" visual theme — category colors (red/amber/teal) map directly to Emergency/System Update/General so the color itself communicates severity, monospace timestamps for that live-log feel, and a pulsing "online" indicator as the signature visual element. Good talking point for your viva: explain that the design choices aren't just decoration — they encode real information (severity, live status).

## 5c. New: A Real User Panel (not just a read-only feed)

**Read/unread tracking:** every alert shows an unread indicator until the user clicks "Mark as read" (or acknowledges it). The header shows a live unread count.

**"I'm Safe" acknowledgment:** on Emergency alerts, users get an "I'm Safe" button instead of "Mark as read." The admin dashboard shows a live "Acknowledged: N" count on that alert — this is a real pattern used by campus/corporate emergency systems, and gives your project a genuine safety-use-case story for the viva.

**Search + category filter:** users can filter their own feed by keyword or category — client-side, instant, no page reload.

**Self-service subscriptions:** users can edit which groups they're subscribed to from their own panel (`PUT /api/auth/me`), instead of being stuck with whatever the admin assigned at registration.

**Native browser notifications:** in addition to the in-page toast, the browser's own Notification API fires a real OS-level popup (if the user grants permission) — works even if the tab isn't focused.

**For admins:** every alert in the log now shows "Read by N" and, for Emergency alerts, "Acknowledged: N" — updating live via Socket.IO as users check in.

New endpoints backing this: `POST /api/alerts/:id/read`, `POST /api/alerts/:id/acknowledge`, `GET /api/auth/me`, `PUT /api/auth/me`.

## 5d. New: Roles, Priority Levels, and Templates

**Three roles now, not two:**
- **Admin** — full control, including the only role allowed to send Emergency alerts, and the only role that can delete alerts
- **Moderator** — can send System Update / General Announcement alerts, but the "Emergency" option is hidden from their form entirely, and the backend rejects it too (`403`) even if someone tries to force it via a raw API call — this is real role-based access control, not just a hidden button
- **User** — receives alerts only

Register a moderator account the same way as before (role dropdown on the register page) to test this.

**Priority is now separate from category:** category is *what kind* of alert it is (Emergency/System Update/General), priority is *how urgent* it is (Critical/High/Medium/Low) — a "System Update" can still be Critical. Critical, unread alerts sort to the top of both the admin log and the user feed regardless of when they were sent, get a subtle pulsing highlight, and re-trigger a reminder toast every 45 seconds until the user marks it read or acknowledges it.

**Templates:** the admin/moderator compose form has a "Load a template" dropdown (Emergency Drill, Exam Alert, Maintenance Notice, Meeting Reminder, Fee Reminder) that pre-fills title/message/category/priority — you can still edit before sending.

**Talking point for your viva:** explain the RBAC boundary as a real design decision — Emergency alerts are the highest-trust action in the system, so that permission is deliberately *not* delegated to moderators, enforced at both the UI layer (hidden option) and the API layer (`403` if bypassed).

## 5e. New: Real App-Shell Layout (not a scrolling single page anymore)

Both the staff dashboard and user panel now have a **left sidebar with section navigation** (Compose / Analytics / Alert Log for staff; Live Feed / Subscriptions for users) that highlights the active section as you scroll, plus a consistent icon system (Material Symbols) on stat cards, nav links, and buttons instead of plain text everywhere.

**Quick filter chips** on the user panel (All / Unread / Critical / Emergency) sit above the search bar for one-click filtering, faster than opening the category dropdown every time.

On narrow screens the sidebar collapses into a horizontal scrollable bar under the header, so it still works on mobile.

## 5f. New: Forgot Password + Admin User Management

**Forgot password (self-service):** "Forgot password?" link on the login page → user enters their email → gets a reset link by email (valid 1 hour) → sets a new password. Uses the same Gmail setup you already configured for alert emails — no extra setup needed if that's already working. If email isn't set up, admins can reset a user's password directly instead (see below).

**Admin: Users panel** (new "Users" link in the sidebar, admin-only — moderators don't see it):
- See every registered account: name, email, role, groups, join date
- **Change anyone's role** with a dropdown (User / Moderator / Admin) — updates instantly, backend blocks an admin from demoting themselves so you can't accidentally lock yourself out
- **Reset any user's password directly** — useful when someone's locked out and email isn't configured
- **Delete an account** (with confirmation, can't delete your own while logged in as it)

New endpoints: `POST /api/auth/forgot-password`, `POST /api/auth/reset-password/:token`, `GET /api/users`, `PUT /api/users/:id/role`, `PUT /api/users/:id/set-password`, `DELETE /api/users/:id` — all user-management routes require an admin token.

**Viva talking point:** the reset-password flow deliberately returns the same generic message whether or not the email exists ("If that email is registered...") — this is a real security practice (prevents someone from using the form to discover which emails have accounts), and worth mentioning if asked about security design.

## 6. Future Enhancements (already scoped, not built — for your "future work" slide)

- SMS alerts via Twilio
- AI-based alert prioritization
- Mobile app (React Native) consuming the same API
- Geo-location-based targeting

---

## 7. Common Issues

- **"Could not reach the server"** on login → backend isn't running, or `API_BASE` in `frontend/js/config.js` doesn't match your backend port.
- **CORS errors in browser console** → make sure `CLIENT_ORIGIN` in `.env` matches the URL your frontend actually runs on (Live Server usually uses `http://127.0.0.1:5500`).
- **MongoDB connection error** → double check `MONGO_URI`; if using Atlas, make sure your IP is whitelisted under Network Access.

## 8. Deploying Live (Frontend: Netlify, Backend: Render, Database: MongoDB Atlas)

Netlify only hosts static files — it cannot run your Node/Express/Socket.IO server. This is a two-service deployment: **Netlify for the frontend, Render for the backend**, both talking to the same MongoDB Atlas database you already set up. This is completely normal — most real full-stack apps are deployed this way.

### Step A — Push your code to GitHub
Both Render and Netlify deploy from a GitHub repo.
1. Install Git if you don't have it: git-scm.com
2. Create a free GitHub account, then click "New repository" (name it `web-alert-system`, leave it empty — no README)
3. In your terminal, at the project root (the `web-alert-system` folder containing both `backend` and `frontend`):
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/web-alert-system.git
   git push -u origin main
   ```
   (The `.gitignore` in `backend/` already keeps your `.env` and `node_modules` out of GitHub — your secrets stay private.)

### Step B — Deploy the backend to Render
1. Go to render.com, sign up (you can use your GitHub account to sign in)
2. Click **New +** → **Web Service** → connect your `web-alert-system` GitHub repo
3. Set:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment Variables**, add every value from your local `.env` file one by one: `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `EMAIL_USER`, `EMAIL_PASS`, `DISCORD_WEBHOOK_URL`. For `CLIENT_ORIGIN`, put `*` for now — you'll come back and fix this in Step F.
5. Click **Create Web Service** and wait for it to build. You'll get a URL like `https://your-app-name.onrender.com` — copy it.

### Step C — Let Render reach your database
MongoDB Atlas only allows connections from IPs you've whitelisted, but Render's free tier doesn't have a fixed IP. Go to Atlas → **Database & Network Access** → **Network Access** tab → **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`). This is fine for a student project; a real production app would restrict this further.

### Step D — Point your frontend at the live backend
Open `frontend/js/config.js` and change this one line:
```
const BACKEND_URL = "https://your-app-name.onrender.com";
```
(using the URL Render gave you in Step B). Save it.

### Step E — Deploy the frontend to Netlify
1. Go to app.netlify.com, sign up
2. Easiest method: drag and drop your entire `frontend` folder onto the Netlify dashboard — it deploys instantly, no Git needed
3. (Or, for auto-redeploys on every code change: "Import from Git" → pick your repo → set **Base directory** to `frontend`, leave build command empty since it's static HTML)
4. You'll get a URL like `https://your-project.netlify.app`

### Step F — Close the loop: update CORS
Go back to Render → your backend service → **Environment** → update `CLIENT_ORIGIN` from `*` to your actual Netlify URL (`https://your-project.netlify.app`) → save. Render redeploys automatically.

### Step G — Test it
Open your Netlify URL, register an account, log in, send a test alert. Everything should work exactly like it did locally, just on real public URLs now.

### Important honest caveat: free-tier "cold starts"
Render's free web services fall asleep after ~15 minutes of no traffic. The *first* request after that takes 30–50 seconds to wake back up — this isn't a crash, it's expected free-tier behavior. **Before your actual demo/viva**, open your Netlify URL a minute or two early to "wake up" the backend so it's instant when you present. If asked, this is a completely reasonable thing to explain honestly: "the free tier sleeps when idle; a paid tier or a keep-alive ping would remove this in a real deployment."

## 9. New: Real Mobile Responsiveness + Password Policy

**The actual mobile bug, fixed:** every page was missing the `<meta name="viewport">` tag. Without it, phones (and DevTools device emulation) render the page at a wide desktop width and shrink the whole thing down visually — which is why it looked tiny and squished instead of properly reflowing. All 7 pages now include it, so responsive layouts actually kick in on real devices, not just look broken at a smaller scale.

**Password policy:** registration, self-service password reset, and admin-set-password now all require **at least 10 characters, including an uppercase letter, a lowercase letter, a number, and a special character** — enforced both in the browser (instant feedback) and on the server (`backend/utils/passwordPolicy.js` — the real source of truth; never trust client-side validation alone). Registration and reset-password now also require typing the password twice to confirm.

## 10. New: Admin Can Add Users Directly + Visual Polish

**Admin: Add User** — the Users page now has a form at the top to create an account directly (name, email, password, role, groups) instead of relying on self-registration. Same password policy applies. New endpoint: `POST /api/users` (admin only).

**Visual polish pass:** subtle background texture (soft radial glow + faint dot grid, adapts to light/dark), hover lift on cards and log entries, a soft shadow/glow on button hover, and a gentle entrance animation on the login/register card. All motion respects `prefers-reduced-motion` for accessibility.

**Note on a prior mix-up:** an earlier local edit to `users.html`/`style.css` introduced a broken sidebar link and a duplicate, conflicting responsive CSS block pasted at the end of the file — that's what caused the "still not responsive" symptom. This version replaces those files cleanly rather than merging on top of the broken edit. If you want to hand-edit CSS again in the future, edit the existing rules in place rather than pasting a second block of the same selectors at the end of the file — later rules silently override earlier ones with the same specificity.
