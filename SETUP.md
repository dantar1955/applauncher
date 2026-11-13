# Launch Hub — setup

A single page that lists tiles for your apps, with one login that controls who can see what. This is the "simple hub" version: signing in here just gets you to the tile page; opening an app from a tile still uses that app's own existing login the first time, exactly as it does today. None of your other four apps are touched by this.

Nothing here reads or changes anything inside Family Office, Kismet, Antar Family Archive, or Medvault — it's a brand-new, separate project with its own brand-new, empty database.

## 1. Create a new Supabase project (about 2 minutes)

1. Go to supabase.com, sign in, and click "New project".
2. Name it something like "Launch Hub". Pick a password for the database (you won't need to use it directly — just save it somewhere).
3. Once it's created, go to **Project Settings → API**. You'll need two things from this page in a minute: the **Project URL** and the **anon public key**. There's also a **service_role key** below it — keep that one secret, you'll only paste it into Netlify, never into the website file itself.

## 2. Set up the database tables

1. In the Supabase dashboard, open **SQL Editor** → **New query**.
2. Open `supabase-schema.sql` (included alongside this file), copy all of it, paste it into the SQL editor, and click **Run**.
3. That creates the three tables the hub needs and locks them down with security rules. It also adds one example tile (Antar Family Archive) so the page isn't empty the first time you open it — you'll add Family Office, Kismet, and Medvault the same way, from inside the hub itself, once you're signed in as admin.

## 3. Fill in the two public values in the website file

1. Open `index.html` in a text editor (TextEdit is fine).
2. Near the top, find:
   ```
   const SUPABASE_URL = "YOUR_SUPABASE_URL";
   const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
   ```
3. Replace those two placeholder values with the **Project URL** and **anon public key** from step 1. Save the file.

## 4. Put it on GitHub and connect it to Netlify

This is the same pattern you already used for Antar Family Archive.

1. Create a new, private GitHub repository (e.g. `launch-hub`) and upload all the files in this folder to it (GitHub's web "Add file → Upload files" works fine — no Terminal needed).
2. In Netlify, click "Add a new site" → "Import an existing project" → pick that GitHub repo.
3. Leave the build settings as Netlify suggests (there's no build step — it's a static site with one small serverless function).
4. Before the first deploy finishes mattering, go to **Site configuration → Environment variables** and add:
   - `SUPABASE_URL` — the same Project URL as above
   - `SUPABASE_ANON_KEY` — the same anon public key as above
   - `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key from Supabase (Project Settings → API) — keep this one private, it's what lets the hub invite and manage people. Make sure the name has `_KEY` on the end, exactly as written here — a name like `SUPABASE_SERVICE_ROLE` (missing `_KEY`) won't be found by the code and invites/admin actions will quietly fail.
   - `BOOTSTRAP_ADMIN_EMAIL` — your own email address, so you're the one allowed to set up the first admin account
   - `APP_URL` — the Netlify site's URL once you know it (e.g. `https://launch-hub.netlify.app`) — you can add this after the first deploy
   - `SECRETS_SCAN_OMIT_KEYS` — set this to `SUPABASE_ANON_KEY,SUPABASE_URL,BOOTSTRAP_ADMIN_EMAIL` (Netlify's secret scanner otherwise blocks the deploy whenever it finds those values anywhere in the repo — which is expected and fine here, the same way you handled this for Antar Family Archive)
5. Redeploy the site (Netlify → Deploys → Trigger deploy) so it picks up those variables.

## 5. First sign-in

1. Open your new site's URL. It will say nobody's set it up yet — enter your name and your email (must match `BOOTSTRAP_ADMIN_EMAIL`).
2. Check your email for the sign-in link, set a password, and you're in as the first admin.
3. Go to **Manage → Apps** and add Family Office, Kismet, and Medvault (name, URL, an emoji icon for each).
4. Go to **Manage → People** to invite anyone else (Rosanne, etc.) and tick which apps each person can see.

Everyone signs in here to get to the tile page, then clicks through to whichever app — each app still has its own separate login the first time you visit it there, same as it always has.


