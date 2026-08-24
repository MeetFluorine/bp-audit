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
6. Go to **Authentication → URL Configuration** and add the exact URL you'll deploy this to (e.g. `https://yourname.github.io/reponame/`) under **Redirect URLs**. This is required for the "Forgot password" email link to work — Supabase rejects password-reset redirects to any URL that isn't on this allowlist.

> **Already running this in production?** You don't need to redo the whole schema — just run `supabase/add_profile_name_avatar.sql` once to add name/profile-picture support to your existing database (then step 6 above if you haven't already — needed for the new Forgot Password feature), `supabase/add_grn_source_type.sql` once to add GRN-pending stock support, `supabase/add_roles_circles_approval.sql` once to add the Circle Head / Client roles and the approval workflow, `supabase/add_grn_asn_column.sql` once to add ASN-number traceability on GRN Pending rows, and `supabase/add_auto_complete_and_circlehead_upload.sql` once to add automatic cycle completion and Circle Head base-data upload rights (see below for all of these).

## Circle Head can now set up base data — for their own circle only

A Circle Head sees **Setup Base Data** in their nav now (scoped to their circle): the Pre-Audit Readiness panel, the "Stores Submitted Without Base Data" panel, and the upload itself all only ever show or accept their own circle's stores. There's an optional "restrict to one store" dropdown for extra safety on top. This is enforced by RLS on the `base_serials` insert, not just hidden in the UI — a circle head's credentials genuinely can't insert base data for a store outside their circle even via a direct API call.

## Approvals moved off the admin dashboard, onto a dedicated Circle Head page

The Pending Approvals panel is gone from Overview entirely. A Circle Head now has a dedicated **Approvals** page (linked from the bell icon, which is circle-head-only now and just shows a count) with the full variance detail per pending store — every short/excess serial, its SKU, source, and ASN — plus a remark box and Approve/Reject/Unlock. Their remark carries straight through to the exported report's **Remarks** column, so an admin reviewing the file downstream sees exactly why a store was flagged.

## Circle Head Summary (admin) vs. Circle Summary (circle head)

Admin's Overview page now shows one card **per Circle Head** (not per raw circle) — clicking a card drills into that person's whole territory (every circle they're assigned to), scoping the KPIs, store grid, and detail table below to just their stores, with a "back" banner. Any circle with no Circle Head assigned shows up in its own "Unassigned" card so nothing silently disappears from view. A Circle Head's own Overview keeps the original per-circle cards, each still clickable down to that circle's store results.

## Cycle completion is automatic now

The "Complete audit" admin button is gone. A cycle's `completed` flag is now kept in sync by a database trigger: it flips to `true` the moment every store in the master list is locked **and approved** by its Circle Head (or an admin), and flips back to `false` if that stops being true — a rejection, or a store getting unlocked for correction. This matters most for the Client role, since a client's full detail view only unlocks once a cycle is completed — that now happens the moment the actual audit work is genuinely done, not when someone remembers to click a button.

## Client dashboard trimmed to client-relevant content

A client no longer sees the Circle/Circle-Head Summary rollup, the Stores Pending Audit panel, the Live Activity feed, or the Scan/Upload quick-action — those are operational tools, not something a client needs. What's left: the read-only banner, progress-only KPI on a live cycle (full detail on completion, as before), the store-results grid with export, and the reconciliation detail table.

## GRN Pending uploads: only genuinely-pending rows are kept

A GRN/ASN serial report (like `MultiUOMSerialReport.xlsx`) has a `GRNNo` column that's blank while a serial is still pending inward, and filled in once it's actually been GRN'd — at that point it's Inventory, not GRN Pending, anymore. Uploading a file as **GRN Stock (Pending Inward)** now automatically keeps only the blank-`GRNNo` rows and skips the rest, with a status message telling you how many were skipped and why. The report's `ASNNo` column is also kept (as `asn_no` on each row) purely for traceability — every GRN-sourced row in the Excel export shows which ASN/order it belongs to, so an admin can chase the right delivery instead of just a bare serial number.

## Roles: Admin, Circle Head, Auditor, Client

The app now supports four roles, assigned from **Users & Stores** (admin only):

- **Admin** — full control. Uploads base data, manages cycles, manages users/roles, sees everything.
- **Circle Head** — assigned to one or more circles (via a chip picker, same UI pattern as an auditor's store assignment). Sees the dashboard scoped to only their circle(s), can approve/reject a submitted store with a remark, and can unlock a store in their own circle for correction. Cannot upload base data or manage users.
- **Auditor** (`user` role, unchanged) — assigned to specific stores. Scans/submits only their own stores. Gets a new **My Stores** page showing submission/approval status for just their stores — no visibility into other stores' expected data, by design, so they can never see the "answer" before scanning.
- **Client** — read-only, sees every circle. For a cycle that's still in progress, they only see how many stores have been submitted so far (no match/short/excess numbers, so a mid-cycle "62% short" reading — which is really just "hasn't been counted yet" — never causes false alarm). Full detail and Excel export unlock automatically once a cycle is marked complete.

**This isn't just a UI toggle** — a circle head's and client's data visibility is enforced by Postgres Row Level Security (`can_view_store()` in the migration), so even a direct API call with a circle head's or client's credentials can't read another circle's data or an in-progress cycle's detail.

### Approval workflow

When an auditor submits (locks) a store, it starts **pending**. The store's circle head (if one is assigned to that circle) can Approve or Reject with a remark from the dashboard's **Pending Approvals** panel. Admins see the exact same panel and status for every store — a circle head is a review layer, not a gate admins are stuck behind; admins can approve/reject/unlock any store regardless of what a circle head has done. The submitted scan data counts toward every number on the dashboard immediately either way — approval is a sign-off record, not a data gate.

## GRN pending stock (upload as of a store's complete expected quantity)

Base/system data can now be uploaded as one of two source types, chosen with a radio toggle right above the upload box on the Setup Base Data screen:

- **Inventory Stock** — stock already inward in the system. This is the original, only, upload type the app had before.
- **GRN Stock (Pending Inward)** — stock that's physically present at the store but hasn't been GRN'd/inward into the system yet (e.g. an ASN serial report such as `MultiUOMSerialReport.xlsx`, where the `GRNNo` column is blank for units still pending). The app auto-detects that report's `Client`/`ItemNo`/`ItemSerialNo` columns the same way it detects `LocationCode`/`ItemNo`/`SerialNo` in a normal inventory file.

Both types land in the same `base_serials` table (tagged with a `source_type` column) and are combined into that store's complete expected quantity — a physical scan is reconciled against Inventory + GRN together, so a unit that's physically on the shelf but only shows up in the GRN report no longer reads as a false "Excess."

The Excel export (both the full audit export and each store's individual export) breaks the numbers back out by source:
- **Summary** sheet gets `Inventory Expected/Matched/Short` and `GRN Pending Expected/Matched/Short` columns alongside the combined totals.
- **Detail** sheet gets a `Source` column (`Inventory` / `GRN Pending`) per row.
- A dedicated **GRN Pending** sheet lists every GRN-pending serial for the audited stores and whether it was matched in the physical scan or is still pending.

If you already have a live Supabase project, run `supabase/add_grn_source_type.sql` once in the SQL Editor to add the `source_type` column (existing base data backfills as `inventory`, so nothing already uploaded changes behavior). Fresh projects get this column directly from `schema.sql`.

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
- When a base file has both a `BoxIDSerial` and an `ItemSerialNo` column (as GRN/ASN reports do), the app uses whichever one appears first left-to-right in the file — normally they're identical, but if a source file ever has them differ, only the first is used.
