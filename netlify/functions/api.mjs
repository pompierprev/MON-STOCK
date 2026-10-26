import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import lib from "./lib.js";
import * as XLSX from "xlsx";

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

    /* ---------- Import Excel ---------- */
    if (method === "POST" && p === "/api/import") {
      const buf = Buffer.from(await req.arrayBuffer());
      if (!buf.length) return json(400, { error: "Fichier vide." });
      let wb;
      try { wb = XLSX.read(buf, { type: "buffer" }); }
      catch { return json(400, { error: "Fichier Excel illisible." }); }

      const nrm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const MOIS_FR = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
      const RAY = [['hygiene','Hygiène'],['entretien','Entretien'],['alimentation','Alimentation'],['boisson','Boisson']];
      const nb = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
      const moisDe = (v) => {
        if (typeof v === 'number' && v >= 1 && v <= 12) return v - 1;
        const t = nrm(v); const i = MOIS_FR.indexOf(t);
        if (i >= 0) return i;
        if (t.length >= 3) { const idx = MOIS_FR.findIndex(m => m.startsWith(t.slice(0, 4))); if (idx >= 0) return idx; }
        return 0;
      };
      const lignes = (ws) => ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : [];
      const cand = { comptes: [], familles: RAY.map(([id, nom]) => ({ id, nom, produits: [] })), courses: { fresh: [], leclerc: { hygiene: [], entretien: [], alimentation: [], boisson: [] } } };

      lignes(wb.Sheets['Comptes']).forEach((r, idx) => {
        if (idx === 0 || !r || !nb(r[0])) return;
        cand.comptes.push({ annee: Math.round(nb(r[0])), mois: moisDe(r[1]), intitule: String(r[2] || '').trim(), entree: Math.round(nb(r[3]) * 100) / 100, sortie: Math.round(nb(r[4]) * 100) / 100 });
      });

      let famC = null;
      lignes(wb.Sheets['Stock']).forEach((r) => {
        if (!r) return;
        const pleines = r.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
        if (!pleines.length) { famC = null; return; }
        if (pleines.length === 1) { famC = cand.familles.find(f => nrm(f.nom) === nrm(pleines[0])) || null; return; }
        if (!famC || nrm(r[0]) === 'produit') return;
        const nom = String(r[0] || '').trim();
        if (!nom) return;
        const garage = Math.max(0, Math.round(nb(r[1])));
        const maison = (r[3] !== null && r[3] !== undefined && String(r[3]).trim() !== '') ? Math.max(0, Math.round(nb(r[4]))) : Math.max(0, Math.round(nb(r[2])));
        famC.produits.push({ nom, garage, maison });
      });

      let listeC = null;
      lignes(wb.Sheets['Courses']).forEach((r) => {
        if (!r) return;
        const pleines = r.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
        if (!pleines.length) { listeC = null; return; }
        if (pleines.length === 1) {
          const t = nrm(pleines[0]);
          if (t === 'fresh') listeC = cand.courses.fresh;
          else if (t.startsWith('leclerc')) {
            const nom = t.replace(/^leclerc\s*-*\s*/, '');
            const ray = RAY.find(([id, n]) => nrm(n) === nom || nrm(n).startsWith(nom.slice(0, 5)));
            listeC = ray ? cand.courses.leclerc[ray[0]] : null;
          } else listeC = null;
          return;
        }
        if (!listeC || nrm(r[0]) === 'designation') return;
        const nom = String(r[0] || '').trim();
        if (!nom) return;
        listeC.push({ nom, fait: /oui|true|x/i.test(String(r[1] || '')) });
      });

      const rien = !cand.comptes.length && !cand.familles.some(f => f.produits.length) && !cand.courses.fresh.length && !RAY.some(([r]) => cand.courses.leclerc[r].length);
      if (rien) return json(400, { error: "Aucune donnée reconnue (feuilles Comptes/Stock/Courses ?)." });

      const db = await loadDb();
      const saved = { ...sanitize(cand), rev: db.rev + 1 };
      await store().setJSON("data", saved);
      return json(200, { rev: saved.rev, comptes: saved.comptes.length, produits: saved.familles.reduce((n, f) => n + f.produits.length, 0) });
    }

    return json(404, { error: "Introuvable." });
  } catch (e) {
    return json(400, { error: "Requête invalide." });
  }
};

export const config = { path: "/api/*" };
