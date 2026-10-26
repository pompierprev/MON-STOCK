'use strict';
/*
 * Code commun au serveur Node et à la fonction Netlify :
 * structure des données, familles fixes, export Excel.
 */
const crypto = require('crypto');
const { buildWorkbook, S } = require('./xlsx');

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// Familles de stock FIXES (on ne peut ni en ajouter, ni en supprimer)
const FAMILLES = [
  { id: 'hygiene', nom: 'Hygiène' },
  { id: 'entretien', nom: 'Entretien' },
  { id: 'alimentation', nom: 'Alimentation' },
  { id: 'boisson', nom: 'Boisson' }
];
// Rayons de LECLERC pour la liste de courses (mêmes noms)
const RAYONS = FAMILLES;

const JOURS = [['lundi', 'Lundi'], ['mardi', 'Mardi'], ['mercredi', 'Mercredi'], ['jeudi', 'Jeudi'], ['vendredi', 'Vendredi'], ['samedi', 'Samedi'], ['dimanche', 'Dimanche']];

const rid = () => crypto.randomBytes(6).toString('hex');
const str = (x, n) => String(x === undefined || x === null ? '' : x).slice(0, n);
const money = (x) => { const n = Number(x); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const qty = (x) => Math.min(1e9, Math.max(0, parseInt(x, 10) || 0));
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function sanitize(input) {
  const d = input && typeof input === 'object' ? input : {};

  const comptes = (Array.isArray(d.comptes) ? d.comptes : []).slice(0, 5000).map(c => ({
    id: str(c && c.id, 40) || rid(),
    annee: Math.min(2200, Math.max(1900, parseInt(c && c.annee, 10) || new Date().getFullYear())),
    mois: Math.min(11, Math.max(0, parseInt(c && c.mois, 10) || 0)),
    intitule: str(c && c.intitule, 200).trim(),
    entree: money(c && c.entree),
    sortie: money(c && c.sortie)
  }));

  // Stock : toujours exactement les 4 familles fixes, dans cet ordre
  const entrees = Array.isArray(d.familles) ? d.familles : [];
  const familles = FAMILLES.map(F => {
    const sources = entrees.filter(f => f && (f.id === F.id || norm(f.nom).startsWith(F.id)));
    const produits = sources
      .flatMap(f => (Array.isArray(f.produits) ? f.produits : []))
      .slice(0, 2000)
      .map(p => {
        // Ancien format : une seule quantité "qte", reprise dans le garage
        const ancien = p && p.qte !== undefined && p.garage === undefined;
        return {
          id: str(p && p.id, 40) || rid(),
          nom: str(p && p.nom, 100).trim() || 'Sans nom',
          garage: qty(ancien ? p.qte : p && p.garage),
          maison: ancien ? 0 : qty(p && p.maison)
        };
      });
    return { id: F.id, nom: F.nom, produits };
  });

  // Courses : FRESH (liste simple) et LECLERC (4 rayons)
  const liste = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 1000).map(c => ({
    id: str(c && c.id, 40) || rid(),
    nom: str(c && c.nom, 200).trim() || 'Sans nom',
    fait: !!(c && c.fait)
  }));
  let src = d.courses;
  if (Array.isArray(src)) src = { fresh: src };            // ancienne liste unique -> FRESH
  src = src && typeof src === 'object' ? src : {};
  const lec = src.leclerc && typeof src.leclerc === 'object' ? src.leclerc : {};
  const leclerc = {};
  RAYONS.forEach(r => { leclerc[r.id] = liste(lec[r.id]); });
  const courses = { fresh: liste(src.fresh), leclerc };

  // Menus : toujours exactement 2 semaines, 7 jours chacune
  const dateOk = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : '');
  const semaine = (w) => {
    w = w && typeof w === 'object' ? w : {};
    const j = w.jours && typeof w.jours === 'object' ? w.jours : {};
    const jours = {};
    JOURS.forEach(([k]) => { jours[k] = str(j[k], 500); });
    return { debut: dateOk(w.debut), fin: dateOk(w.fin), jours };
  };
  const sem = d.menus && Array.isArray(d.menus.semaines) ? d.menus.semaines : [];
  const menus = { semaines: [semaine(sem[0]), semaine(sem[1])] };

  return { rev: Math.max(0, parseInt(d.rev, 10) || 0), comptes, familles, courses, menus };
}

/* ---------- Export Excel ---------- */
function comptesSheet(db) {
  const rows = [...db.comptes].sort((a, b) => a.annee - b.annee || a.mois - b.mois);
  const out = [[
    { v: 'Année', s: S.HEADER }, { v: 'Mois', s: S.HEADER }, { v: 'Intitulé', s: S.HEADER },
    { v: 'Entrée', s: S.HEADER_RIGHT }, { v: 'Sortie', s: S.HEADER_RIGHT },
    { v: 'Résultat par unité', s: S.HEADER_RIGHT }, { v: 'Résultat total', s: S.HEADER_RIGHT }
  ]];
  let cumul = 0, tE = 0, tS = 0;
  rows.forEach((c, i) => {
    const r = i + 2;
    const res = Math.round((c.entree - c.sortie) * 100) / 100;
    cumul = Math.round((cumul + res) * 100) / 100;
    tE += c.entree; tS += c.sortie;
    const blue = i % 2 === 0;
    const txt = blue ? S.BLUE_TXT : S.BEIGE_TXT;
    const eur = blue ? S.BLUE_EUR : S.BEIGE_EUR;
    out.push([
      { v: c.annee, s: txt }, { v: MOIS[c.mois], s: txt }, { v: c.intitule || '', s: txt },
      { v: c.entree, s: eur }, { v: c.sortie, s: eur },
      { f: `D${r}-E${r}`, v: res, s: eur },
      { f: i === 0 ? `F${r}` : `G${r - 1}+F${r}`, v: cumul, s: eur }
    ]);
  });
  if (rows.length) {
    const t = rows.length + 2, last = rows.length + 1;
    tE = Math.round(tE * 100) / 100; tS = Math.round(tS * 100) / 100;
    const tot = Math.round((tE - tS) * 100) / 100;
    out.push([
      { v: 'Total', s: S.TOTAL_TXT }, { v: '', s: S.TOTAL_TXT }, { v: '', s: S.TOTAL_TXT },
      { f: `SUM(D2:D${last})`, v: tE, s: S.TOTAL_EUR },
      { f: `SUM(E2:E${last})`, v: tS, s: S.TOTAL_EUR },
      { f: `SUM(F2:F${last})`, v: tot, s: S.TOTAL_EUR },
      { f: `F${t}`, v: tot, s: S.TOTAL_EUR }
    ]);
  }
  return { name: 'Comptes', cols: [10, 14, 32, 16, 16, 20, 18], rows: out };
}

function stockSheet(db) {
  const out = [];
  db.familles.forEach(f => {
    out.push([{ v: f.nom, s: S.TITLE }]);
    if (!f.produits.length) {
      out.push([{ v: 'Aucun produit dans cette famille.' }]);
    } else {
      out.push([
        { v: 'Produit', s: S.HEADER }, { v: 'GARAGE', s: S.HEADER_RIGHT }, null,
        { v: 'Produit', s: S.HEADER }, { v: 'MAISON', s: S.HEADER_RIGHT }
      ]);
      f.produits.forEach((p, i) => {
        const grey = i % 2 === 0;
        const txt = (q) => q <= 1 ? S.DARK_TXT : grey ? S.GREY_TXT : S.WHITE_TXT;
        const num = (q) => q <= 1 ? S.DARK_QTY : grey ? S.GREY_QTY : S.WHITE_QTY;
        out.push([
          { v: p.nom, s: txt(p.garage) }, { v: p.garage, s: num(p.garage) }, null,
          { v: p.nom, s: txt(p.maison) }, { v: p.maison, s: num(p.maison) }
        ]);
      });
    }
    out.push([]);
  });
  return { name: 'Stock', cols: [30, 12, 3, 30, 12], rows: out };
}

function coursesSheet(db) {
  const out = [];
  const bloc = (titre, items) => {
    out.push([{ v: titre, s: S.TITLE }]);
    out.push([{ v: 'Désignation', s: S.HEADER }, { v: 'Fait', s: S.HEADER_RIGHT }]);
    if (!items.length) out.push([{ v: 'Aucun article.' }]);
    items.forEach((c, i) => {
      const txt = i % 2 === 0 ? S.GREY_TXT : S.WHITE_TXT;
      out.push([{ v: c.nom, s: txt }, { v: c.fait ? 'Oui' : 'Non', s: txt }]);
    });
    out.push([]);
  };
  bloc('FRESH', db.courses.fresh);
  RAYONS.forEach(r => bloc('LECLERC - ' + r.nom, db.courses.leclerc[r.id]));
  return { name: 'Courses', cols: [50, 10], rows: out };
}

function menusSheet(db) {
  const fr = (iso) => (iso ? iso.split('-').reverse().join('/') : '...');
  const out = [];
  db.menus.semaines.forEach((w, i) => {
    out.push([{ v: `Semaine ${i + 1} : du ${fr(w.debut)} au ${fr(w.fin)}`, s: S.TITLE }]);
    out.push([{ v: 'Jour', s: S.HEADER }, { v: 'Menu', s: S.HEADER }]);
    JOURS.forEach(([k, nom], n) => {
      const st = n % 2 === 0 ? S.BLUE_WRAP : S.BEIGE_WRAP;
      out.push([{ v: nom, s: st }, { v: w.jours[k] || '', s: st }]);
    });
    out.push([]);
  });
  return { name: 'Menus', cols: [14, 70], rows: out };
}

function exportXlsx(db, type) {
  const sheets = type === 'comptes' ? [comptesSheet(db)]
    : type === 'stock' ? [stockSheet(db)]
    : type === 'courses' ? [coursesSheet(db)]
    : type === 'menus' ? [menusSheet(db)]
    : [comptesSheet(db), stockSheet(db), coursesSheet(db), menusSheet(db)];
  return buildWorkbook(sheets);
}

module.exports = { sanitize, exportXlsx };
