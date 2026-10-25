import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import lib from "./lib.js";

const { sanitize, exportXlsx } = lib;

/* ---------- Réglages (variables d'environnement Netlify) ---------- */
const adminCode = () => process.env.ADMIN_CODE || "0102Pnosi";
const secret = () =>
  process.env.SESSION_SECRET ||
  crypto.createHash("sha256").update("sess:" + adminCode()).digest("hex");
const SESSION_MS = 12 * 60 * 60 * 1000;   // 12 h
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;           // 15 min

const store = () => getStore({ name: "gestion", consistency: "strong" });

async function loadDb() {
  const raw = await store().get("data", { type: "json" });
  return sanitize(raw || {});
}

/* ---------- Session (jeton signé, sans état serveur) ---------- */
function sign(exp) {
  const mac = crypto.createHmac("sha256", secret()).update(String(exp)).digest("hex");
  return `${exp}.${mac}`;
}

function verify(token) {
  if (!token) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || !(Number(exp) > Date.now())) return false;
  const good = crypto.createHmac("sha256", secret()).update(exp).digest("hex");
  const a = Buffer.from(mac), b = Buffer.from(good);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieOf(req, name) {
  const h = req.headers.get("cookie") || "";
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function codeOk(input) {
  const a = crypto.createHash("sha256").update(String(input)).digest();
  const b = crypto.createHash("sha256").update(adminCode()).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---------- Réponses ---------- */
const SEC = {
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};
const json = (status, obj, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...SEC, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

/* ---------- Fonction ---------- */
export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "");
    const method = req.method;

    const needJson = () => {
      if (!String(req.headers.get("content-type") || "").startsWith("application/json")) throw new Error("type invalide");
    };

    /* Connexion */
    if (method === "POST" && p === "/api/login") {
      needJson();
      const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "inconnu";
      const key = "fails-" + crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 32);
      const f = (await store().get(key, { type: "json" })) || { count: 0, until: 0 };
      if (f.until && f.until > Date.now()) {
        return json(429, { error: "Trop de tentatives.", minutes: Math.ceil((f.until - Date.now()) / 60000) });
      }
      const body = await req.json();
      if (codeOk(body.code)) {
        if (f.count || f.until) await store().delete(key);
        const exp = Date.now() + SESSION_MS;
        const cookie = `sid=${sign(exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
        return json(200, { ok: true }, { "Set-Cookie": cookie });
      }
      f.count += 1;
      if (f.count >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.count = 0; }
      await store().setJSON(key, f);
      return json(401, { error: "Code incorrect." });
    }

    /* Déconnexion */
    if (method === "POST" && p === "/api/logout") {
      return json(200, { ok: true }, { "Set-Cookie": "sid=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
    }

    /* Le reste exige d'être connecté */
    if (!verify(cookieOf(req, "sid"))) return json(401, { error: "Connexion requise." });

    if (method === "GET" && p === "/api/data") return json(200, await loadDb());

    if (method === "PUT" && p === "/api/data") {
      needJson();
      const body = await req.json();
      const db = await loadDb();
      if (parseInt(body.rev, 10) !== db.rev) return json(409, db);   // modifié depuis un autre appareil
      const next = sanitize(body);
      const saved = { ...next, rev: db.rev + 1 };
      await store().setJSON("data", saved);
      return json(200, { rev: saved.rev });
    }

    if (method === "GET" && p === "/api/export") {
      const db = await loadDb();
      const type = url.searchParams.get("type");
      const d = new Date().toISOString().slice(0, 10);
      const name = ["comptes", "stock", "courses"].includes(type) ? `${type}-${d}.xlsx` : `gestion-${d}.xlsx`;
      return new Response(exportXlsx(db, type), {
        status: 200,
        headers: {
          ...SEC,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return json(404, { error: "Introuvable." });
  } catch (e) {
    return json(400, { error: "Requête invalide." });
  }
};

export const config = { path: "/api/*" };
