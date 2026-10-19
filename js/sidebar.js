/**
 * ============================================================================
 * Menu latéral (sidebar) — remplace l'ancienne barre top-nav-bar dupliquée
 * dans les 15 pages HTML par un unique composant injecté via JS.
 * ----------------------------------------------------------------------------
 * Comportement :
 *  - Mobile (< 880px) : tiroir hors-écran, ouvert/fermé par le bouton ☰,
 *    un clic sur l'overlay, Échap, ou un clic sur un vrai lien de navigation.
 *  - Desktop (≥ 880px) : le menu reste affiché en permanence sur la gauche
 *    (le bouton ☰ et l'overlay sont masqués, inutiles dans ce cas).
 *  - Un menu par application (Briefing VFR / Quiz PPL / Bibliothèque du pilote, voir
 *    js/apps.js) : chaque application n'affiche que ses pages, et un lien vers les deux autres.
 *  - Les entrées du Briefing pointent vers les onglets internes de
 *    navlog.html (navlog.html#meteo, etc.). Si on est DÉJÀ sur navlog.html,
 *    le clic appelle directement window.switchTab() au lieu de recharger la
 *    page — sinon la navigation normale se fait et navlog.html lit le hash
 *    au chargement (voir le script ajouté en fin de ce fichier-là).
 *  - Icônes : un seul jeu SVG cohérent (trait, même épaisseur, `currentColor`)
 *    au lieu d'emoji — plus lisible en petite taille et rendu identique sur
 *    toutes les plateformes (les emoji varient selon l'OS/le clavier).
 * ============================================================================
 */
(function () {
  // Chaque entrée est le contenu interne (<path>/<circle>/...) d'un <svg viewBox="0 0 24 24">,
  // dessiné au trait (stroke, pas de remplissage) pour rester cohérent quelle que soit la taille
  // d'affichage — voir .sidebar-icon dans style.css pour l'épaisseur/couleur communes.
  var ICONS = {
    home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none"/>',
    bookOpen: '<path d="M12 6c-2-1.5-5-2-8-1v13c3-1 6-.5 8 1 2-1.5 5-2 8-1V5c-3-1-6-.5-8 1Z"/><path d="M12 6v13"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
    flame: '<path d="M12 21c3.5 0 6-2.3 6-5.8 0-2.7-1.7-4.6-2.8-6.4-.3 1.8-1.4 2.6-2.3 2.6.6-1.8-.3-3.6-2.1-4.6C10.6 9.3 8 11 8 14.5A5 5 0 0 0 12 21Z"/>',
    clipboardCheck: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 13l2 2 4-4"/>',
    barChart: '<path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="M20 20l-5.2-5.2"/>',
    layers: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 13l9 5 9-5"/>',
    fileText: '<path d="M6 3h9l3 3v15H6Z"/><path d="M15 3v3h3"/><path d="M9 12h6"/><path d="M9 16h6"/>',
    hash: '<path d="M5 8h14"/><path d="M5 16h14"/><path d="M10 4 8 20"/><path d="M16 4 14 20"/>',
    alertTriangle: '<path d="M12 3 2 21h20Z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".8" fill="currentColor" stroke="none"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-6 2 2-6Z"/>',
    map: '<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
    lifeBuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.5 3.5M18.4 5.6l-3.5 3.5M5.6 18.4l3.5-3.5M18.4 18.4l-3.5-3.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-7.95A5 5 0 0 1 16 8a4.5 4.5 0 0 1 1 8.9"/><path d="M7 18h9.5"/>',
    scale: '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7 3 12a2 2 0 0 0 4 0Z"/><path d="M19 7l-2 5a2 2 0 0 0 4 0Z"/>',
    mountain: '<path d="M3 20 9 8l4 6 3-4 5 10Z"/>',
    droplet: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11Z"/>',
    checkSquare: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l2.5 2.5L16 9"/>',
    zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    send: '<path d="M4 12 20 4 13 20l-2-7-7-1Z"/>',
    folder: '<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    antenna: '<path d="M12 13v8"/><circle cx="12" cy="11" r="2"/><path d="M8.5 7.5a5 5 0 0 0 0 7"/><path d="M15.5 7.5a5 5 0 0 1 0 7"/><path d="M5.6 4.6a9 9 0 0 0 0 12.8"/><path d="M18.4 4.6a9 9 0 0 1 0 12.8"/>'
  };

  function iconSvg(key) {
    var inner = ICONS[key] || '';
    return '<svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  // Un menu PAR APPLICATION (voir js/apps.js) : chaque application n'affiche que ses propres
  // pages, plus un accès aux deux autres en bas du menu. `href` sert à la fois de lien réel et
  // de clé de détection de la page courante (comparée par nom de fichier, sans ?... ni #...).
  var MENUS = {
    briefing: [
      { href: 'briefing.html', icon: 'home', label: 'Accueil' },
      { type: 'label', label: 'Préparer le vol' },
      { href: 'navlog.html', tab: 'nav', icon: 'compass', label: 'Navlog & route' },
      { href: 'navlog.html#meteo', tab: 'meteo', icon: 'cloud', label: 'Météo & OPMET' },
      { href: 'navlog.html#metar', tab: 'metar', icon: 'antenna', label: 'METAR de secours' },
      { href: 'navlog.html#notam', tab: 'notam', icon: 'alertTriangle', label: 'NOTAMs' },
      { href: 'navlog.html#altitudes', tab: 'altitudes', icon: 'mountain', label: 'Altitudes' },
      { href: 'navlog.html#fuel', tab: 'fuel', icon: 'droplet', label: 'Carburant' },
      { href: 'navlog.html#fpl', tab: 'fpl', icon: 'send', label: 'Plan de vol (FPL)' },
      { type: 'label', label: 'Avion' },
      { href: 'navlog.html#masse', tab: 'masse', icon: 'scale', label: 'Masse & centrage' },
      { href: 'navlog.html#perf', tab: 'perf', icon: 'barChart', label: 'Performances' },
      { href: 'navlog.html#checklist', tab: 'checklist', icon: 'checkSquare', label: 'Checklist' },
      { href: 'urgences.html', icon: 'lifeBuoy', label: 'Procédures d’urgence' },
      { type: 'label', label: 'Mes vols' },
      { href: 'navlog.html#dossiers', tab: 'dossiers', icon: 'folder', label: 'Dossiers' },
      { href: 'navlog.html#notes', tab: 'notes', icon: 'fileText', label: 'Notes' }
    ],
    ppl: [
      { href: 'index.html?accueil=1', icon: 'home', label: 'Accueil' },
      { type: 'label', label: 'Réviser' },
      { href: 'quiz.html', icon: 'target', label: 'Quiz' },
      { href: 'rates.html', icon: 'bookOpen', label: 'Révisions' },
      { href: 'echecs.html', icon: 'flame', label: 'Plus ratées' },
      { href: 'difficultes.html', icon: 'zap', label: 'Difficultés' },
      { href: 'epreuve.html', icon: 'clipboardCheck', label: 'Examen blanc' },
      { href: 'examen.html', icon: 'flag', label: 'Révisions finales' },
      { href: 'syllabus.html', icon: 'clock', label: 'Syllabus' },
      { type: 'label', label: 'Suivre' },
      { href: 'stats.html', icon: 'barChart', label: 'Stats' },
      { href: 'historique.html', icon: 'calendar', label: 'Historique' },
      { href: 'search.html', icon: 'search', label: 'Recherche' },
      { type: 'label', label: 'Références' },
      { href: 'fiches.html', icon: 'fileText', label: 'Fiches' },
      { href: 'symboles.html', icon: 'hash', label: 'Symboles' },
      { href: 'radial.html', icon: 'compass', label: 'Radial VOR' },
      { href: 'plongee.html', icon: 'lifeBuoy', label: 'Plongée' }
    ],
    biblio: [
      { href: 'bibliotheque.html', icon: 'home', label: 'Ma bibliothèque' },
      { type: 'label', label: 'Manuels' },
      { href: 'livre.html?b=afh', icon: 'bookOpen', img: 'livre/afh/cover.webp', label: 'Manuel de vol (AFH)' },
      { href: 'livre.html?b=phak', icon: 'bookOpen', img: 'livre/phak/cover.webp', label: 'Manuel du pilote (PHAK)' },
      { href: 'livre.html?b=rmh', icon: 'bookOpen', img: 'livre/rmh/cover.webp', label: 'Gestion des risques (RMH)' },
      { href: 'livre.html?b=ac6022', icon: 'bookOpen', img: 'livre/ac6022/cover.webp', label: 'Décision aéronautique (AC 60-22)' },
      { href: 'livre.html?b=cap737', icon: 'bookOpen', img: 'livre/cap737/cover.webp', label: 'Facteurs humains (CAP 737)' },
      { href: 'livre.html?b=hpl', icon: 'bookOpen', img: 'livre/hpl/cover.webp', label: 'Performances humaines (ATPL)' }
    ]
  };
  var CURRENT_APP = (window.CURRENT_APP && MENUS[window.CURRENT_APP]) ? window.CURRENT_APP : 'ppl';
  var APPS = window.APPS || {};

  function currentFile() {
    var f = location.pathname.split('/').pop();
    return f || 'index.html';
  }
  function hrefFile(href) {
    return href.split('#')[0].split('?')[0].split('/').pop();
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function linkHtml(item, cur) {
    if (item.type === 'label') return '<div class="sidebar-sublabel">' + esc(item.label) + '</div>';
    var isCurrent = !item.tab && hrefFile(item.href) === cur;
    // Plusieurs entrées vers la même page (livre.html?b=afh / ?b=phak) : on compare aussi le paramètre
    var bk = /[?&]b=([a-z0-9]+)/.exec(item.href);
    if (isCurrent && bk) isCurrent = ((/[?&]b=([a-z0-9]+)/.exec(location.search) || [0, 'afh'])[1] === bk[1]);
    var attrs = 'href="' + esc(item.href) + '" class="sidebar-link' + (isCurrent ? ' sidebar-link-current' : '') + '"';
    if (item.tab) attrs += ' data-navlog-tab="' + esc(item.tab) + '"';
    var ic = item.img ? '<img class="sidebar-cover" src="' + esc(item.img) + '" alt="">' : iconSvg(item.icon);
    return '<a ' + attrs + '>' + ic + '<span>' + esc(item.label) + '</span></a>';
  }

  function buildHtml(cur) {
    var html = MENUS[CURRENT_APP].map(function (it) { return linkHtml(it, cur); }).join('');
    html += '<hr class="sidebar-sep">' + linkHtml({ href: 'configuration.html?app=' + CURRENT_APP, icon: 'settings', label: 'Configuration' }, cur);
    // Les deux autres applications : simple lien sur le web ; dans un APK, la page d'installation
    // de l'autre application (ses pages ne sont pas embarquées dans celle-ci).
    var others = (window.APP_ORDER || []).filter(function (id) { return id !== CURRENT_APP && APPS[id]; });
    if (others.length) {
      html += '<div class="sidebar-sublabel">Autres applications</div>';
      others.forEach(function (id) {
        var a = APPS[id];
        var href = window.appLinkTo ? window.appLinkTo(id) : a.home;
        var ext = /^https?:/.test(href);
        html += '<a href="' + esc(href) + '" class="sidebar-link sidebar-app-link"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>'
          + '<img class="sidebar-app-logo" src="' + esc(a.logo) + '" alt="">' + '<span>' + esc(a.name) + (ext ? ' <small>· installer</small>' : '') + '</span></a>';
      });
    }
    return html;
  }

  function init() {
    var cur = currentFile();

    var toggleBtn = document.createElement('button');
    toggleBtn.id = 'sidebarToggleBtn';
    toggleBtn.className = 'sidebar-toggle-btn';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', 'Ouvrir le menu');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-controls', 'appSidebar');
    toggleBtn.innerHTML = '<span></span><span></span><span></span>';

    var overlay = document.createElement('div');
    overlay.id = 'sidebarOverlay';
    overlay.className = 'sidebar-overlay';

    var nav = document.createElement('nav');
    nav.id = 'appSidebar';
    nav.className = 'app-sidebar';
    nav.setAttribute('aria-label', 'Navigation principale');
    nav.innerHTML =
      '<div class="sidebar-header">'
      + (APPS[CURRENT_APP] ? '<img class="sidebar-header-logo" src="' + esc(APPS[CURRENT_APP].logo) + '" alt="">' : '<span class="sidebar-header-icon">✈️</span>')
      + '<span class="sidebar-header-title">' + esc(APPS[CURRENT_APP] ? APPS[CURRENT_APP].name : 'Quiz PPL') + '</span>'
      + '<button type="button" class="sidebar-close-btn" aria-label="Fermer le menu">✕</button>'
      + '</div>'
      + '<div class="sidebar-body">' + buildHtml(cur) + '</div>';

    document.body.prepend(nav);
    document.body.prepend(overlay);
    document.body.prepend(toggleBtn);

    function openSidebar() {
      document.body.classList.add('sidebar-open');
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
    function closeSidebar() {
      document.body.classList.remove('sidebar-open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
    toggleBtn.addEventListener('click', function () {
      document.body.classList.contains('sidebar-open') ? closeSidebar() : openSidebar();
    });
    overlay.addEventListener('click', closeSidebar);
    nav.querySelector('.sidebar-close-btn').addEventListener('click', closeSidebar);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSidebar();
    });

    /* ---- Ouverture par glissement depuis le bord gauche ----
       Geste attendu de toute application Android pour un menu latéral. Le bouton ☰ reste bien
       sûr en place : ce geste s'ajoute, il ne remplace rien.

       Contraintes retenues pour ne JAMAIS déclencher le menu par accident, en particulier
       pendant une session de révision où un faux positif ferait perdre le fil :
         • le doigt doit partir des 24 premiers pixels de l'écran ;
         • le mouvement doit être franchement horizontal (au moins deux fois plus horizontal
           que vertical), pour ne pas confisquer un défilement vertical ;
         • un seul doigt, sinon on laisse passer (pincement pour zoomer sur une image).
       `passive: true` sur touchmove : on n'appelle jamais preventDefault ici, donc autant ne
       pas pénaliser la fluidité du défilement. */
    var EDGE_PX = 24, MIN_DX = 45;
    var swipe = null;

    document.addEventListener('touchstart', function (e) {
      if (document.body.classList.contains('sidebar-open')) { swipe = null; return; }
      if (!e.touches || e.touches.length !== 1) { swipe = null; return; }
      var t = e.touches[0];
      swipe = (t.clientX <= EDGE_PX) ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!swipe || !e.touches || e.touches.length !== 1) return;
      var t = e.touches[0];
      var dx = t.clientX - swipe.x;
      var dy = Math.abs(t.clientY - swipe.y);
      if (dx > MIN_DX && dx > dy * 2) {
        openSidebar();
        swipe = null;
      } else if (dy > 40) {
        // Défilement vertical assumé : on abandonne ce geste plutôt que de le surveiller
        // jusqu'à ce qu'il finisse par ressembler à un glissement horizontal.
        swipe = null;
      }
    }, { passive: true });

    document.addEventListener('touchend', function () { swipe = null; }, { passive: true });
    document.addEventListener('touchcancel', function () { swipe = null; }, { passive: true });

    nav.querySelectorAll('a.sidebar-link').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var tab = a.getAttribute('data-navlog-tab');
        if (tab && cur === 'navlog.html' && typeof window.switchTab === 'function') {
          e.preventDefault();
          window.switchTab(tab);
          try { history.replaceState(null, '', '#' + tab); } catch (e2) { /* ignore */ }
        }
        closeSidebar();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
