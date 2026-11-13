// Launch Hub admin API. Runs server-side on Netlify with the Supabase service key.
// Every action except `status` and `bootstrap` requires a signed-in admin.
import { createClient } from "@supabase/supabase-js";

const env = (k) => Netlify.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const APP_URL = env("APP_URL").replace(/\/$/, "");
const BOOTSTRAP_EMAIL = env("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function adminCount(db) {
  const { count } = await db.from("members").select("user_id", { count: "exact", head: true }).eq("role", "admin").eq("is_disabled", false);
  return count ?? 0;
}

async function loadMembers(db) {
  const { data: members, error } = await db.from("members").select("user_id,email,display_name,role,is_disabled,invited_at");
  if (error) throw new HttpError(500, error.message);
  const { data: access } = await db.from("member_apps").select("user_id,app_key");
  const { data: authUsers } = await db.auth.admin.listUsers({ perPage: 1000 });
  const byUser = new Map((authUsers?.users ?? []).map((u) => [u.id, u]));
  return (members ?? []).map((m) => {
    const u = byUser.get(m.user_id);
    return {
      ...m,
      apps: (access ?? []).filter((a) => a.user_id === m.user_id).map((a) => a.app_key),
      status: !u ? "invited" : u.last_sign_in_at ? "active" : "invited",
      last_sign_in_at: u?.last_sign_in_at ?? null,
    };
  });
}

async function setAccess(db, userId, appKeys) {
  await db.from("member_apps").delete().eq("user_id", userId);
  const keys = Array.isArray(appKeys) ? [...new Set(appKeys.filter((x) => typeof x === "string"))] : [];
  if (!keys.length) return;
  const { error } = await db.from("member_apps").insert(keys.map((app_key) => ({ user_id: userId, app_key })));
  if (error) throw new HttpError(500, error.message);
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: "Server is not configured: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set in Netlify." }, 500);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const redirectTo = `${APP_URL || new URL(req.url).origin}/`;

    // ---- Unauthenticated: first-run setup -------------------------------
    if (action === "status" || action === "bootstrap") {
      const needsBootstrap = (await adminCount(db)) === 0;
      if (action === "status") return json({ needs_bootstrap: needsBootstrap });
      if (!needsBootstrap) throw new HttpError(403, "Setup has already been completed.");
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!BOOTSTRAP_EMAIL || email !== BOOTSTRAP_EMAIL) throw new HttpError(403, "This email is not authorized to set up the hub.");
      const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: { display_name: String(body.display_name ?? "Administrator") } });
      if (error) throw new HttpError(400, error.message);
      const { error: mErr } = await db.from("members").insert({ user_id: data.user.id, email, display_name: String(body.display_name ?? "Administrator"), role: "admin" });
      if (mErr) throw new HttpError(500, mErr.message);
      return json({ ok: true });
    }

    // ---- Authenticated ----------------------------------------------------
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Not signed in.");
    const { data: who, error: whoErr } = await db.auth.getUser(token);
    if (whoErr || !who.user) throw new HttpError(401, "Session is invalid or expired.");

    const { data: me } = await db.from("members").select("*").eq("user_id", who.user.id).maybeSingle();
    if (!me || me.is_disabled) throw new HttpError(403, "Your access has been disabled.");

    // Any signed-in member can read the app/member directory needed to render their own tiles.
    if (action === "my_apps") {
      const { data: access } = await db.from("member_apps").select("app_key").eq("user_id", who.user.id);
      const keys = (access ?? []).map((a) => a.app_key);
      if (!keys.length) return json({ apps: [] });
      const { data: apps } = await db.from("apps").select("*").in("key", keys).order("sort");
      return json({ apps: apps ?? [] });
    }

    if (me.role !== "admin") throw new HttpError(403, "Only an administrator can do that.");

    if (action === "list_members") return json({ members: await loadMembers(db) });

    if (action === "list_apps") {
      const { data } = await db.from("apps").select("*").order("sort");
      return json({ apps: data ?? [] });
    }

    if (action === "save_app") {
      const key = String(body.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      if (!key) throw new HttpError(400, "App key is required.");
      const row = {
        key,
        name: String(body.name ?? "").trim() || key,
        url: String(body.url ?? "").trim(),
        description: String(body.description ?? "").trim(),
        icon: String(body.icon ?? "").trim(),
        sort: Number.isFinite(body.sort) ? body.sort : 0,
      };
      if (!row.url) throw new HttpError(400, "App URL is required.");
      const { error } = await db.from("apps").upsert(row);
      if (error) throw new HttpError(500, error.message);
      return json({ ok: true });
    }

    if (action === "delete_app") {
      const { error } = await db.from("apps").delete().eq("key", String(body.key ?? ""));
      if (error) throw new HttpError(500, error.message);
      return json({ ok: true });
    }

    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!email) throw new HttpError(400, "Email is required.");
      const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: { display_name: String(body.display_name ?? "") } });
      if (error) throw new HttpError(400, error.message);
      const { error: mErr } = await db.from("members").insert({
        user_id: data.user.id, email, display_name: String(body.display_name ?? "") || null, role: body.role === "admin" ? "admin" : "user",
      });
      if (mErr) throw new HttpError(500, mErr.message);
      await setAccess(db, data.user.id, body.apps);
      return json({ ok: true });
    }

    if (action === "resend_invite") {
      const target = String(body.user_id ?? "");
      const { data: tm } = await db.from("members").select("email").eq("user_id", target).maybeSingle();
      if (!tm) throw new HttpError(404, "User not found.");
      const { error } = await db.auth.admin.inviteUserByEmail(tm.email, { redirectTo });
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true });
    }

    if (action === "update") {
      const target = String(body.user_id ?? "");
      if (target === who.user.id && body.is_disabled === true) throw new HttpError(400, "You can't disable your own account.");
      if (target === who.user.id && body.role && body.role !== "admin") {
        if ((await adminCount(db)) <= 1) throw new HttpError(400, "You're the only administrator — promote someone else first.");
      }
      const patch = {};
      if (typeof body.display_name === "string") patch.display_name = body.display_name || null;
      if (body.role === "admin" || body.role === "user") patch.role = body.role;
      if (typeof body.is_disabled === "boolean") patch.is_disabled = body.is_disabled;
      if (Object.keys(patch).length) {
        const { error } = await db.from("members").update(patch).eq("user_id", target);
        if (error) throw new HttpError(500, error.message);
      }
      if (body.apps !== undefined) await setAccess(db, target, body.apps);
      if (patch.is_disabled === true) await db.auth.admin.updateUserById(target, { ban_duration: "87600h" }).catch(() => {});
      if (patch.is_disabled === false) await db.auth.admin.updateUserById(target, { ban_duration: "none" }).catch(() => {});
      return json({ ok: true });
    }

    if (action === "send_reset") {
      const target = String(body.user_id ?? "");
      const { data: tm } = await db.from("members").select("email").eq("user_id", target).maybeSingle();
      if (!tm) throw new HttpError(404, "User not found.");
      const { error } = await db.auth.resetPasswordForEmail(tm.email, { redirectTo });
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true });
    }

    if (action === "delete") {
      const target = String(body.user_id ?? "");
      if (target === who.user.id) throw new HttpError(400, "You can't delete your own account.");
      await db.from("members").delete().eq("user_id", target);
      const { error } = await db.auth.admin.deleteUser(target);
      if (error) throw new HttpError(500, error.message);
      return json({ ok: true });
    }

    throw new HttpError(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
};
