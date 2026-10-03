# Kept

**The record of what you actually did.** A personal operating system for execution: your own routines and tasks in areas you define, a full Gym logger, Learning, Money, private Groups with friends, and a Journal for every day of the year — checked off in one tap, and measured without lying to yourself.

Five tabs: **Today · Areas · Groups · Money · Progress** (Journal lives under Progress; Profile sits behind the avatar).

**New to it?** Read the illustrated guide: `public/guide.html` — served by the app at `/guide.html` and linked from Profile → *How to use Kept*.

- `docs/PRODUCT.md` — thesis, users, differentiators, loop, IA, prioritisation, risks, flows
- `docs/DESIGN.md` — the design system
- `docs/ARCHITECTURE.md` — stack, data model, security, every formula, deploy guide, tests

## Open it on this PC

Double-click **`Start Kept.bat`**. It rebuilds when the code changed (about a minute), starts Kept in production mode and opens http://localhost:3100. Keep that window open while you use it; close it to stop.

Only one copy of Kept can use the database at a time. If another one is running (for example Claude's preview), the second shows an error instead of risking your data — close the first one.

## Share it with friends (hosted on Railway)

The app ships as one container (`Dockerfile`): the web server plus its embedded database, with the database and photos on a persistent volume. Railway's Hobby plan is $5/month and includes $5 of usage, which covers an app this size.

1. Create an account at railway.com (only you can do this).
2. Install the CLI and sign in: `npm.cmd i -g @railway/cli`, then `railway login`.
3. In the `kept` folder: `railway init` (new project), then `railway up` (builds and deploys the Dockerfile).
4. Add a volume to the service mounted at **`/data`** (dashboard → service → Volumes, or `railway volume add --mount-path /data`).
5. Set variables on the service:
   - `KEPT_SECRET` — 32+ random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`)
   - `KEPT_INVITE_CODE` — any word you like; people need it to create an account
   - `KEPT_DEMO_MODE=sandbox` — every visitor can try a private demo, deleted after 24 hours
6. `railway domain` gives you the `https://…up.railway.app` link. Send friends the link **and** the invite code.

On the hosted link, phones can "Add to Home Screen" and it behaves like an app. Accounts made on your PC stay on your PC — the hosted version starts empty.

## Run it for development (Windows, portable Node)

```powershell
cd kept
$env:Path = "C:\Users\alcev\AppData\Local\nodejs-portable;" + $env:Path
npm.cmd install
npm.cmd run dev        # http://localhost:3100  (or run-dev.bat)
```

No accounts or Docker needed: the database is embedded Postgres stored in `KEPT_DATA_DIR` (set in `.env.local`, kept outside OneDrive on purpose), migrated automatically on first start. Migrations only ever move forward and keep existing data: a V1 database opens in V2 with every area, routine, completion and transaction intact.

**`run-dev-v2.bat`** runs a second dev server on port 3101 against a separate test database (`C:/Users/alcev/AppData/Local/kept-v2-data`), so V2 can be tried without touching your real data.

On the sign-in page, **Explore the demo** builds a demo account with ~5 months of realistic history: an Upper/Lower gym program with every workout logged set by set, German and Reading sessions, Business and Health areas with a project, a journal, multi-currency money with budgets, targets and a monthly plan, and a group of three friends with finished seasons and a Hall of Fame. Credentials are in `.env.local` (`KEPT_DEMO_EMAIL` / `KEPT_DEMO_PASSWORD`).

From a phone on the same Wi-Fi: `http://<this-pc-ip>:3100`.

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js on port 3100 |
| `npm test` | engine (incl. gym, groups, money plan), grammar and row-level-security tests (incl. V2 tables, groups, legacy-data survival) |
| `npm run typecheck` | TypeScript |
| `npm run db:migrate` / `db:seed` / `db:reset` | database tasks (stop the dev server first — the embedded DB is single-process) |
| `E2E_BASE=http://localhost:3101 node scripts/e2e.mjs` | end-to-end flows in headless Chrome: new user, gym, money, journal, two users in a group (creates accounts — point it at a dev database) |
| `node scripts/a11y.mjs --theme dark` | accessibility probe |
| `node scripts/shot.mjs --login --pages /today --device mobile` | screenshots to `.verify/` |

Keyboard: **N** quick add (context-aware: a workout in Gym, a session in Learning, an expense in Money) · **⌘/Ctrl K** command bar (`€18 lunch`, `+800 salary`, `gym done`, `log German 45`, `add task call Martin tomorrow`, `journal`).
