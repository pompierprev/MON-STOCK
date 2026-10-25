(() => {
  'use strict';
  const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const RAYONS = [
    { id: 'hygiene', nom: 'Hygiène' },
    { id: 'entretien', nom: 'Entretien' },
    { id: 'alimentation', nom: 'Alimentation' },
    { id: 'boisson', nom: 'Boisson' }
  ];
  const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const videCourses = () => ({ fresh: [], leclerc: { hygiene: [], entretien: [], alimentation: [], boisson: [] } });
  const videMenus = () => [0, 1].map(() => ({ debut: '', fin: '', jours: JOURS.map(() => '') }));
  const etatVide = () => ({ rev: 0, comptes: [], familles: [], courses: videCourses(), menus: videMenus() });
  let state = etatVide();
  let saveChain = Promise.resolve();

  /* ---------- Réseau ---------- */
  async function api(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
    const r = await fetch(url, opts);
    let data = null;
    try { data = await r.json(); } catch (e) { /* pas de JSON */ }
    return { status: r.status, data };
  }

  function setStatus(msg, bad) {
    const el = $('#status');
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
  }

  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#code').focus(); }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; }

  function recevoir(data) {
    state = data;
    state.courses = state.courses || videCourses();
    state.courses.leclerc = state.courses.leclerc || videCourses().leclerc;
    state.familles = state.familles || [];
    const src = Array.isArray(state.menus) ? state.menus : [];
    state.menus = videMenus().map((b, i) => {
      const m = src[i] || {};
      return { debut: m.debut || '', fin: m.fin || '', jours: b.jours.map((_, j) => (m.jours && m.jours[j]) || '') };
    });
  }

  async function loadData() {
    const r = await api('GET', '/api/data');
    if (r.status === 401) return showLogin();
    if (r.status !== 200) { showApp(); return setStatus('Impossible de charger les données.', true); }
    recevoir(r.data);
    showApp();
    render();
    setStatus('');
  }
/* ---------- Fusion en cas de conflit ---------- */
function fusionner(serveur) {
  const parId = (arr) => { const m = new Map(); (arr || []).forEach(x => m.set(x.id, x)); return m; };

  // Comptes : union par id
  const cm = parId([...(serveur.comptes || []), ...state.comptes]);
  state.comptes = [...cm.values()];

  // Familles/produits : union + quantité max (aucun + n'est perdu)
  const famsLoc = parId(state.familles);
  (serveur.familles || []).forEach(fs => {
    const fl = famsLoc.get(fs.id);
    if (!fl) { famsLoc.set(fs.id, fs); return; }
    const prods = parId(fl.produits);
    (fs.produits || []).forEach(ps => {
      const pl = prods.get(ps.id);
      if (!pl) { prods.set(ps.id, ps); return; }
      pl.garage = Math.max(pl.garage | 0, ps.garage | 0);
      pl.maison = Math.max(pl.maison | 0, ps.maison | 0);
    });
    fl.produits = [...prods.values()];
  });
  state.familles = [...famsLoc.values()];

  // Courses : union par id, "fait" si coché sur l'un des deux
  const fusionListe = (srvList, locList) => {
    const m = parId(srvList || []);
    (locList || []).forEach(c => {
      const s = m.get(c.id);
      if (!s) m.set(c.id, c);
      else s.fait = s.fait || c.fait;
    });
    return [...m.values()];
  };
  state.courses.fresh = fusionListe(serveur.courses.fresh, state.courses.fresh);
  RAYONS.forEach(r => {
    state.courses.leclerc[r.id] = fusionListe(serveur.courses.leclerc[r.id], state.courses.leclerc[r.id]);
  });

  // Menus : on garde le local, et on complète avec le serveur ce qui est vide
  (serveur.menus || []).forEach((o, i) => {
    const m = state.menus[i];
    if (!m || !o) return;
    if (!m.debut) m.debut = o.debut || '';
    if (!m.fin) m.fin = o.fin || '';
    m.jours = m.jours.map((v, j) => v || (o.jours && o.jours[j]) || '');
  });

  state.rev = serveur.rev;
}

function commit(msg) {
  saveChain = saveChain.then(async () => {
    let r = await api('PUT', '/api/data', state);
    if (r.status === 409 && r.data && typeof r.data === 'object' && r.data.rev !== undefined) {
      fusionner(r.data);
      r = await api('PUT', '/api/data', state);
      if (r.status === 200) { state.rev = r.data.rev; setStatus(msg || 'Synchronisé (conflit fusionné).', false); }
      else setStatus('Synchronisation impossible, rechargez la page.', true);
    } else if (r.status === 200) {
      state.rev = r.data.rev;
      if (msg) setStatus(msg, false);
    } else {
      setStatus('Erreur de sauvegarde.', true);
    }
    render();
  }).catch(() => setStatus('Erreur réseau.', true));
}
  

   /* ---------- Connexion ---------- */
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#loginError');
    err.textContent = '';
    try {
      const r = await api('POST', '/api/login', { code: $('#code').value });
      if (r.status === 200) await loadData();
      else if (r.status === 429) err.textContent = `Trop de tentatives. Réessayez dans ${r.data.minutes} min.`;
      else err.textContent = 'Code incorrect. Réessayez.';
    } catch (x) {
      err.textContent = 'Serveur injoignable. Réessayez.';
    }
    $('#code').value = '';
  });

  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/logout');
    state = etatVide();
    showLogin();
  });

  /* ---------- Menus (2 semaines) ---------- */
  function construireMenus() {
    const btnCompte = document.querySelector('nav button[data-page="comptes"]');
    const pageCompte = $('#page-comptes');
    if (!btnCompte || !pageCompte) return;

    // Onglet MENUS, placé au-dessus (avant) de Comptes
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = btnCompte.className.replace(/\bactive\b/g, '').trim();
    btn.dataset.page = 'menus';
    btn.textContent = 'MENUS';
    btnCompte.parentNode.insertBefore(btn, btnCompte);

    // Page MENUS, placée avant la page Comptes
    const page = document.createElement(pageCompte.tagName);
    page.id = 'page-menus';
    page.className = pageCompte.className;
    page.hidden = true;
    page.innerHTML = `<h3>MENUS</h3>` + [0, 1].map(i => `
      <div class="panel" data-sem="${i}">
        <div class="form-row mb14">
          <div class="field"><label for="menuDebut${i}">Semaine du :</label><input type="date" id="menuDebut${i}" data-champ="debut"></div>
          <div class="field"><label for="menuFin${i}">au :</label><input type="date" id="menuFin${i}" data-champ="fin"></div>
        </div>
        <table style="width:100%">
          <tbody>
            ${JOURS.map((j, k) => `
              <tr>
                <th scope="row" style="text-align:left;white-space:nowrap;padding:4px 10px 4px 0"><label for="menu${i}j${k}">${j}</label></th>
                <td style="padding:4px 0"><input type="text" id="menu${i}j${k}" data-jour="${k}" maxlength="300" style="width:100%;box-sizing:border-box"></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="no-print" style="margin-top:12px">
          <button type="button" class="btn danger small" data-effacer="${i}">Effacer</button>
        </div>
      </div>`).join('');
    pageCompte.parentNode.insertBefore(page, pageCompte);

    page.addEventListener('input', (e) => {
      const pan = e.target.closest('[data-sem]');
      if (!pan) return;
      const m = state.menus[+pan.dataset.sem];
      if (e.target.dataset.champ) m[e.target.dataset.champ] = e.target.value;
      else if (e.target.dataset.jour !== undefined) m.jours[+e.target.dataset.jour] = e.target.value;
    });
    page.addEventListener('change', (e) => {
      if (e.target.closest('[data-sem]')) commit();
    });
    page.addEventListener('click', (e) => {
      const i = e.target.dataset.effacer;
      if (i === undefined) return;
      if (!confirm(`Effacer tout le menu de la semaine ${+i + 1} ?`)) return;
      state.menus[+i] = videMenus()[0];
      render(); commit();
    });
  }

  function renderMenus() {
    state.menus.forEach((m, i) => {
      const pan = document.querySelector(`#page-menus [data-sem="${i}"]`);
      if (!pan) return;
      const set = (el, v) => { if (el && el !== document.activeElement && el.value !== v) el.value = v; };
      set(pan.querySelector('[data-champ="debut"]'), m.debut);
      set(pan.querySelector('[data-champ="fin"]'), m.fin);
      m.jours.forEach((v, k) => set(pan.querySelector(`[data-jour="${k}"]`), v));
    });
  }
  construireMenus();

  /* ---------- Menu et impression ---------- */
  document.querySelectorAll('nav button[data-page]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav button[data-page]').forEach(x => x.classList.toggle('active', x === b));
      ['menus', 'comptes', 'stock', 'courses'].forEach(n => { const p = $('#page-' + n); if (p) p.hidden = b.dataset.page !== n; });
    });
  });
  document.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => window.print()));
  window.addEventListener('beforeprint', () => {
    const d = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    document.querySelectorAll('.print-date').forEach(el => { el.textContent = `Imprimé le ${d}`; });
  });

  /* ---------- Comptes ---------- */
  $('#cMois').innerHTML = MOIS.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  const now = new Date();
  $('#cAnnee').value = now.getFullYear();
  $('#cMois').value = now.getMonth();

  $('#addCompte').addEventListener('click', () => {
    const annee = parseInt($('#cAnnee').value, 10);
    if (!annee) { $('#cAnnee').focus(); return; }
    state.comptes.push({
      id: uid(), annee,
      mois: parseInt($('#cMois').value, 10),
      intitule: $('#cIntitule').value.trim(),
      entree: parseFloat($('#cEntree').value) || 0,
      sortie: parseFloat($('#cSortie').value) || 0
    });
    $('#cIntitule').value = ''; $('#cEntree').value = ''; $('#cSortie').value = '';
    render(); commit();
  });

  function renderComptes() {
    const rows = [...state.comptes].sort((a, b) => a.annee - b.annee || a.mois - b.mois);
    let cumul = 0, tE = 0, tS = 0;
    const cls = (n) => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    $('#compteTable tbody').innerHTML = rows.map(r => {
      const res = r.entree - r.sortie;
      cumul += res; tE += r.entree; tS += r.sortie;
      return `<tr>
        <td>${r.annee}</td><td>${MOIS[r.mois]}</td><td>${esc(r.intitule || '')}</td>
        <td class="num">${eur(r.entree)}</td><td class="num">${eur(r.sortie)}</td>
        <td class="num ${cls(res)}">${eur(res)}</td>
        <td class="num ${cls(cumul)}">${eur(cumul)}</td>
        <td class="num no-print"><button class="btn danger small" data-del="${esc(r.id)}" aria-label="Supprimer la ligne ${MOIS[r.mois]} ${r.annee}">Supprimer</button></td>
      </tr>`;
    }).join('');
    $('#compteTable tfoot').innerHTML = rows.length ? `<tr>
      <td colspan="3">Total</td><td class="num">${eur(tE)}</td><td class="num">${eur(tS)}</td>
      <td class="num">${eur(tE - tS)}</td><td class="num">${eur(tE - tS)}</td><td class="no-print"></td></tr>` : '';
    $('#compteEmpty').hidden = rows.length > 0;
  }

  $('#compteTable').addEventListener('click', (e) => {
    const id = e.target.dataset.del;
    if (!id) return;
    if (confirm('Supprimer cette ligne ?')) {
      state.comptes = state.comptes.filter(c => c.id !== id);
      render(); commit();
    }
  });

  /* ---------- Stock : garage (gauche) et maison (droite) ---------- */
  function stockColonne(f, lieu) {
    const titre = lieu === 'garage' ? 'GARAGE' : 'MAISON';
    const moins = lieu === 'garage' ? 'Retirer du garage et ajouter à la maison' : 'Retirer de la maison';
    const plus = lieu === 'garage' ? 'Ajouter au garage' : 'Ajouter à la maison';
    return `
      <div class="col">
        <h4 class="col-title">${titre}</h4>
        <div class="table-wrap">
          <table class="stockTable">
            <thead><tr><th>Produit</th><th class="no-print"></th><th class="num">Total</th></tr></thead>
            <tbody>
              ${f.produits.map(p => `
                <tr class="${p[lieu] <= 1 ? 'last' : ''}" data-prod="${esc(p.id)}" data-lieu="${lieu}">
                  <td class="name">${esc(p.nom)}</td>
                  <td class="actions no-print">
                    <button class="qty-btn" data-act="minus" title="${moins}" aria-label="${moins} : ${esc(p.nom)}">−</button>
                    <button class="qty-btn" data-act="plus" title="${plus}" aria-label="${plus} : ${esc(p.nom)}">+</button>
                    <button class="qty-btn" data-act="setqty" title="Corriger la quantité (aucun déplacement)" aria-label="Définir la quantité de ${esc(p.nom)} (${lieu})">Qté</button>
                    ${lieu === 'garage' ? `<button class="btn ghost small" data-act="delProd" title="Supprime le produit du garage et de la maison">Supprimer</button>` : ''}
                  </td>
                  <td class="total">${p[lieu]}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function renderStock() {
    $('#families').innerHTML = state.familles.map(f => `
      <div class="panel" data-fam="${esc(f.id)}">
        <div class="family-head"><h3>${esc(f.nom)}</h3></div>
        <div class="form-row no-print mb14">
          <div class="field"><label>Nouveau produit</label><input type="text" class="pNom w220" maxlength="100"></div>
          <div class="field"><label>Quantité garage</label><input type="number" min="0" value="1" class="pGarage w110"></div>
          <div class="field"><label>Quantité maison</label><input type="number" min="0" value="0" class="pMaison w110"></div>
          <button class="btn" data-act="addProd">Ajouter le produit</button>
        </div>
        ${f.produits.length
          ? `<div class="two-cols">${stockColonne(f, 'garage')}${stockColonne(f, 'maison')}</div>`
          : '<p class="empty">Aucun produit dans cette famille.</p>'}
      </div>`).join('');
  }

  // Quand le stock TOTAL d'un produit (garage + maison) tombe à 1 ou moins,
  // il est ajouté à la liste LECLERC de la même famille (sans doublon).
  function verifierCourses(fam, prod, avant) {
    const total = prod.garage + prod.maison;
    if (!(avant > 1 && total <= 1)) return '';
    const liste = state.courses.leclerc[fam.id];
    if (!liste) return '';
    const ou = `LECLERC – ${fam.nom}`;
    const deja = liste.find(c => c.nom.trim().toLowerCase() === prod.nom.trim().toLowerCase());
    if (deja) {
      if (!deja.fait) return '';
      deja.fait = false;
      return `« ${prod.nom} » est presque épuisé : remis à acheter dans ${ou}. Enregistré.`;
    }
    liste.push({ id: uid(), nom: prod.nom, fait: false });
    return `« ${prod.nom} » est à ${total} : ajouté à la liste de courses (${ou}). Enregistré.`;
  }

  $('#families').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const famEl = e.target.closest('[data-fam]');
    const fam = state.familles.find(f => f.id === famEl.dataset.fam);
    if (!fam) return;

    if (act === 'addProd') {
      const nom = famEl.querySelector('.pNom').value.trim();
      const garage = Math.max(0, parseInt(famEl.querySelector('.pGarage').value, 10) || 0);
      const maison = Math.max(0, parseInt(famEl.querySelector('.pMaison').value, 10) || 0);
      if (!nom) { famEl.querySelector('.pNom').focus(); return; }
      const neuf = { id: uid(), nom, garage, maison };
      fam.produits.push(neuf);
      const info = verifierCourses(fam, neuf, Infinity);
      render(); commit(info);
      return;
    }
    const rowEl = e.target.closest('[data-prod]');
    const prod = rowEl && fam.produits.find(p => p.id === rowEl.dataset.prod);
    if (!prod) return;
    const lieu = rowEl.dataset.lieu;
    const avant = prod.garage + prod.maison;
    let msg = '';
    if (act === 'plus') prod[lieu]++;                       // aucun effet sur l'autre colonne
    if (act === 'minus') {
      if (prod[lieu] <= 0) return;
      prod[lieu]--;
      if (lieu === 'garage') {                              // garage -  =>  maison +
        prod.maison++;
        msg = `1 « ${prod.nom} » retiré du garage et ajouté à la maison. Enregistré.`;
      }
    }
    if (act === 'setqty') {
      const v = prompt(`Quantité « ${prod.nom} » (${lieu}) :`, prod[lieu]);
      if (v === null) return;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) return;
      prod[lieu] = n;
    }
    if (act === 'delProd') {
      if (!confirm(`Supprimer « ${prod.nom} » du garage et de la maison ?`)) return;
      fam.produits = fam.produits.filter(p => p !== prod);
    }
    if (act !== 'delProd') msg = verifierCourses(fam, prod, avant) || msg;
    render(); commit(msg);
  });

  $('#families').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('pNom')) {
      e.target.closest('[data-fam]').querySelector('[data-act=addProd]').click();
    }
  });

  /* ---------- Courses : FRESH et LECLERC (4 rayons) ---------- */
  const listeCourses = (mag, rayon) => mag === 'fresh' ? state.courses.fresh : state.courses.leclerc[rayon];

  function blocCourses(mag, rayon, titre, balise) {
    const liste = listeCourses(mag, rayon);
    const restants = liste.filter(c => !c.fait).length;
    return `
      <div class="cblock" data-mag="${mag}" data-rayon="${rayon}">
        <div class="cblock-head">
          <${balise}>${titre}</${balise}>
          <span class="count no-print">${liste.length ? `${restants} à acheter sur ${liste.length}` : ''}</span>
        </div>
        <div class="form-row no-print mb10">
          <div class="field"><label>Désignation</label><input type="text" class="cNom w260" maxlength="200"></div>
          <button class="btn small" data-cact="add">Ajouter</button>
        </div>
        ${liste.length ? `
        <div class="table-wrap">
          <table class="courseTable">
            <thead><tr><th>Désignation</th><th class="fait-col">Fait</th><th class="no-print"></th></tr></thead>
            <tbody>
              ${liste.map(c => `
                <tr class="${c.fait ? 'done' : ''}">
                  <td class="name">${esc(c.nom)}</td>
                  <td class="fait">
                    <input type="checkbox" class="no-print" data-course="${esc(c.id)}" ${c.fait ? 'checked' : ''} aria-label="Fait : ${esc(c.nom)}">
                    <span class="print-only">${c.fait ? '☑' : '☐'}</span>
                  </td>
                  <td class="num no-print"><button class="btn danger small" data-delcourse="${esc(c.id)}" aria-label="Supprimer ${esc(c.nom)}">Supprimer</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<p class="empty">Aucun article.</p>'}
      </div>`;
  }

  function renderCourses() {
    $('#courseSections').innerHTML =
      `<div class="panel">${blocCourses('fresh', '', 'FRESH', 'h3')}</div>` +
      `<div class="panel"><h3 class="magasin">LECLERC</h3>` +
      RAYONS.map(r => blocCourses('leclerc', r.id, r.nom, 'h4')).join('') +
      `</div>`;
  }

  const blocDe = (el) => el.closest('.cblock');
  const listeDe = (bloc) => listeCourses(bloc.dataset.mag, bloc.dataset.rayon);

  $('#courseSections').addEventListener('click', (e) => {
    const bloc = blocDe(e.target);
    if (!bloc) return;
    if (e.target.dataset.cact === 'add') {
      const nom = bloc.querySelector('.cNom').value.trim();
      if (!nom) { bloc.querySelector('.cNom').focus(); return; }
      listeDe(bloc).push({ id: uid(), nom, fait: false });
      const { mag, rayon } = bloc.dataset;
      render(); commit();
      const champ = document.querySelector(`.cblock[data-mag="${mag}"][data-rayon="${rayon}"] .cNom`);
      if (champ) champ.focus();
      return;
    }
    const id = e.target.dataset.delcourse;
    if (id) {
      const liste = listeDe(bloc);
      liste.splice(liste.findIndex(c => c.id === id), 1);
      render(); commit();
    }
  });
  $('#courseSections').addEventListener('change', (e) => {
    const id = e.target.dataset.course;
    if (!id) return;
    const c = listeDe(blocDe(e.target)).find(x => x.id === id);
    if (!c) return;
    c.fait = e.target.checked;
    render(); commit();
  });
  $('#courseSections').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('cNom')) {
      blocDe(e.target).querySelector('[data-cact=add]').click();
    }
  });
  $('#clearDone').addEventListener('click', () => {
    if (!confirm('Supprimer tous les articles déjà faits (FRESH et LECLERC) ?')) return;
    state.courses.fresh = state.courses.fresh.filter(c => !c.fait);
    RAYONS.forEach(r => { state.courses.leclerc[r.id] = state.courses.leclerc[r.id].filter(c => !c.fait); });
    render(); commit();
  });

  function render() { renderMenus(); renderComptes(); renderStock(); renderCourses(); }

  /* ---------- Démarrage ---------- */
  loadData().catch(() => { showLogin(); });
})();
