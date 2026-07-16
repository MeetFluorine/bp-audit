# PV Recon Ledger

A physical verification (PV) / stock reconciliation tool for serialized inventory across multiple stores. Admins upload the "expected" system data per audit cycle; auditors scan physical serials store-by-store; the dashboard reconciles Match / Short / Excess live, with an Excel export.

Runs entirely as a static site (no backend server to host) — data lives in Supabase (Postgres + Auth), and hosting is just static files.

## Project structure

```
index.html          — markup only
css/style.css        — all styling
js/config.js         — Supabase project URL/key + store master list (edit this per deployment)
js/app.js            — all application logic
supabase/schema.sql   — full database schema + security policies (run once per Supabase project)
.gitignore
README.md
```

## Roles

- **Admin** — creates/deletes audit cycles, uploads base (expected) data, approves new sign-ups, assigns auditors to stores, views the full reconciliation dashboard, exports Excel reports.
- **User (auditor)** — signs up, waits for admin approval, then scans/uploads physical serials only for the store(s) they've been assigned. Can delete their own scans; cannot see other stores' data or the admin dashboard.

New sign-ups are **not** usable until an admin approves them from the Admin tab — this is enforced by the database itself (Row Level Security), not just hidden in the UI.

## One-time setup (new Supabase project)

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor → New query**, paste the entire contents of `supabase/schema.sql`, and run it. This creates every table, the store master data, and all security policies in one pass.
3. Go to **Authentication → Providers → Email** and turn **off** "Confirm email." (Supabase's built-in email sender is rate-limited to a handful of emails per hour — fine for occasional use, but since access is already gated by admin approval, email confirmation is redundant friction here.)
4. Go to **Project Settings → API Keys**, copy your **Project URL** and **anon/public key**.
5. Open `js/config.js` and replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your own values.

> **Is it safe to commit the anon key to a public GitHub repo?** Yes — the anon/public key is specifically designed to be exposed in client-side code; that's its purpose. Real protection comes from the Row Level Security policies in `schema.sql`, not from hiding this key. Never put the **service_role** key anywhere in this project — it grants full admin access to your database and must never appear in browser-side code.

## Deploying (GitHub Pages)

1. Push this whole folder to a GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment," set Source to **Deploy from a branch**, pick your branch (e.g. `main`) and root folder (`/`).
4. Save — GitHub gives you a live URL in a minute or two (`https://yourusername.github.io/reponame/`).
5. Any time you edit `js/config.js`, `js/app.js`, or `css/style.css` and push, GitHub Pages redeploys automatically.

(Netlify or Vercel work identically — just point them at this same folder; no build step is needed since this is a plain static site.)

## Bootstrapping your first admin

There's no pre-existing admin account. You create one the same way any auditor would, then promote yourself via SQL:

1. Open your deployed site, click **Sign up**, and create an account with your own email/password.
2. You'll land on a "waiting for approval" screen — expected, since every new account starts unapproved, including yours.
3. In Supabase's SQL Editor, open `supabase/schema.sql`, find the last line, uncomment it, and put in your real email:
   ```sql
   update profiles set role = 'admin', approved = true where email = 'you@example.com';
   ```
   Run just that one line.
4. Back on the site, click "Check again" (or sign out/in). You should now see the Admin tab.

From here on, approve every other user directly from the **Admin** tab — no more SQL needed for routine use.

## Known limitations

- **No true "delete account" from the app.** Deleting a user (as admin) or your own account (from the Profile tab) revokes all access immediately, but the underlying Supabase Auth login isn't removed — that requires the `service_role` key, which is never safe to use in browser code. If someone needs a full, clean wipe (e.g. to free up their email for reuse), remove them manually via Supabase's dashboard: **Authentication → Users**. A proper self-service full-delete would need a small server-side function (Supabase Edge Function) — not currently built, but straightforward to add later if needed.
- **Supabase free tier** auto-pauses a project after 7 days of total inactivity (one-click resume, no data loss) and has no automated backups — export an Excel snapshot periodically as your own backup.
- Serial number matching normalizes purely-numeric serials (strips leading zeros) but does not otherwise fuzzy-match; formatting differences beyond that (e.g. mixed case, extra punctuation) won't auto-reconcile.
