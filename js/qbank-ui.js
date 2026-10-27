// === qbank-ui.js === Banques de questions par classe (ATPL, CAEA, Drones, PPL(H)…)
// Registre généré : js/qbank.js (window.QBANK, par tools/qbank/build_qbank.py).
// Valeur de catégorie : "QB ATPL" (toute la classe), "QB ATPL 010" (un module),
// "QB ATPL 010 :: <série>" (une série du module). La clé de progression d'une question
// reste celle du MODULE ("QB ATPL 010") et son numéro d'origine (id stable) : réviser une
// série ou le module entier compte pour la même question.

const QB_SEP = ' :: ';

/** Catégorie normalisée d'une banque (module ou classe, sans la série), sinon null. */
function _qbNorm(cat) {
  if (!cat || typeof cat !== 'string') return null;
  const c = cat.trim();
  if (!/^QB\s/i.test(c)) return null;
  return c.split(QB_SEP)[0].trim().toUpperCase();
}

function _qbSujetOf(cat) {
  const i = (cat || '').indexOf(QB_SEP);
  return i >= 0 ? cat.slice(i + QB_SEP.length) : '';
}

function _qbClasses() { return (window.QBANK && window.QBANK.classes) || []; }

function _qbFind(norm) {
  for (const c of _qbClasses()) {
    if (('QB ' + c.key) === norm) return { cls: c, mod: null };
    for (const m of c.modules) if (m.cat === norm) return { cls: c, mod: m };
  }
  return null;
}

/** Nom lisible : "ATPL · 010 Droit aérien… · série" */
function _qbLabel(cat) {
  const f = _qbFind(_qbNorm(cat));
  if (!f) return cat;
  const sj = _qbSujetOf(cat);
  return [f.cls.short, f.mod ? f.mod.code + ' ' + f.mod.name : 'tous les modules', sj].filter(Boolean).join(' · ');
}

const _qbFileCache = new Map();
async function _qbLoadModule(m) {
  if (_qbFileCache.has(m.file)) return _qbFileCache.get(m.file);
  const data = await _loadQuestionFileResilient(m.file);
  const list = (Array.isArray(data) ? data : []).map(q => ({
    ...q,
    categorie: m.cat,
    image: q.image || q.image_url || null
  }));
  if (list.length) _qbFileCache.set(m.file, list);
  return list;
}

/** Questions d'une catégorie banque (classe entière, module, ou série d'un module). */
async function _qbLoad(cat) {
  const f = _qbFind(_qbNorm(cat));
  if (!f) return [];
  if (!f.mod) {
    const all = [];
    for (const m of f.cls.modules) all.push(...await _qbLoadModule(m));
    return all;
  }
  const list = await _qbLoadModule(f.mod);
  const sj = _qbSujetOf(cat);
  return sj ? list.filter(q => (q.sujets || []).includes(sj)) : list;
}

/** Options du menu Catégorie : un groupe par classe (toute la classe + chaque module). */
function _qbAppendOptions(select) {
  for (const c of _qbClasses()) {
    const g = document.createElement('optgroup');
    g.label = '── ' + c.label + ' ──';
    const all = document.createElement('option');
    all.value = 'QB ' + c.key;
    all.textContent = `${c.short} - TOUS LES MODULES (${c.count})`;
    g.appendChild(all);
    c.modules.forEach(m => {
      const o = document.createElement('option');
      o.value = m.cat;
      o.textContent = `${c.short} ${m.code} - ${m.name} (${m.count})`;
      g.appendChild(o);
    });
    select.appendChild(g);
  }
}

/** Menu « Série » (sous-catégorie) affiché à côté du menu Catégorie quand un module est choisi. */
function _qbRenderSujetSelect(sujet) {
  const cat = document.getElementById('categorie');
  if (!cat) return;
  let sel = document.getElementById('qbSujet');
  const f = _qbFind(_qbNorm(cat.value));
  if (!f || !f.mod || !f.mod.sujets.length) { if (sel) sel.style.display = 'none'; if (sel) sel.value = ''; return; }
  if (!sel) {
    sel = document.createElement('select');
    sel.id = 'qbSujet';
    sel.className = cat.className;
    sel.style.cssText = 'flex:1 1 100%;min-width:120px;margin-top:6px';
    sel.title = 'Série (sous-catégorie) du module';
    sel.onchange = () => categoryChanged();
    cat.parentNode.insertBefore(sel, cat.nextSibling);
  }
  sel.style.display = '';
  // autre module : on repart sur « toutes les séries » (sinon on garde la série choisie)
  if (sujet === undefined) sujet = sel.dataset.mod === f.mod.cat ? sel.value : '';
  sel.dataset.mod = f.mod.cat;
  sel.innerHTML = `<option value="">Toutes les séries du module (${f.mod.count})</option>` +
    f.mod.sujets.map(([n, k]) => `<option value="${n.replace(/"/g, '&quot;')}">${n} (${k})</option>`).join('');
  sel.value = sujet;
  if (sel.selectedIndex < 0) sel.value = '';
}

/** Valeur complète de la sélection : module + série éventuelle. */
function _qbSelectedValue() {
  const cat = document.getElementById('categorie');
  const v = cat ? cat.value : '';
  const sel = document.getElementById('qbSujet');
  if (_qbNorm(v) && sel && sel.style.display !== 'none' && sel.value) return v + QB_SEP + sel.value;
  return v;
}

/** Remet le menu Catégorie (+ Série) sur une valeur enregistrée ; false si inconnue. */
function _qbRestoreSelection(saved) {
  const norm = _qbNorm(saved);
  if (!norm) return false;
  const cat = document.getElementById('categorie');
  const base = saved.split(QB_SEP)[0];
  if (!cat || !Array.from(cat.options).some(o => o.value === base)) return false;
  cat.value = base;
  _qbRenderSujetSelect(_qbSujetOf(saved));
  return true;
}

/** Questions des modules de banque où l'utilisateur a déjà répondu (pages Échecs, Difficultés,
 *  Historique, Recherche) — sans charger toute la banque. */
async function _qbAnswered(responses) {
  const mods = new Set();
  Object.keys(responses || {}).forEach(k => { const m = /^question_(QB \S+ \S+)_\d+$/.exec(k); if (m) mods.add(m[1]); });
  const out = [];
  for (const c of _qbClasses()) for (const m of c.modules) if (mods.has(m.cat)) out.push(...await _qbLoadModule(m));
  return out;
}
