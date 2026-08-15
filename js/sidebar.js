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
 *  - Les groupes (Réviser / Suivre / Références / Briefing) sont des
 *    <details> natifs : ouverture/fermeture et clavier gérés par le
 *    navigateur, aucune logique JS de repli à écrire ou à maintenir.
 *  - Le groupe correspondant à la page courante s'ouvre automatiquement
 *    (ex: "Briefing" pré-ouvert quand on est sur navlog.html).
 *  - Les sous-éléments de "Briefing" pointent vers les onglets internes de
 *    navlog.html (navlog.html#meteo, etc.). Si on est DÉJÀ sur navlog.html,
 *    le clic appelle directement window.switchTab() au lieu de recharger la
 *    page — sinon la navigation normale se fait et navlog.html lit le hash
 *    au chargement (voir le script ajouté en fin de ce fichier-là).
 * ============================================================================
 */
(function () {
  var GROUP_LABELS = {
    reviser: '🎯 Réviser',
    suivre: '📊 Suivre',
    references: '📚 Références',
    briefing: '🗺️ Briefing'
  };

  // Structure unique de la navigation. `href` sert à la fois de lien réel et
  // de clé de détection de la page courante (comparée par nom de fichier,
  // sans se soucier des paramètres ?... ou #...).
  var STRUCTURE = [
    { type: 'link', href: 'index.html?accueil=1', icon: '🏠', label: 'Accueil' },
    { type: 'group', id: 'reviser', items: [
      { href: 'quiz.html', icon: '🎯', label: 'Quiz' },
      { href: 'rates.html', icon: '📖', label: 'Révisions' },
      { href: 'echecs.html', icon: '🔥', label: 'Plus ratées' },
      { href: 'epreuve.html', icon: '📝', label: 'Examen blanc' }
    ] },
    { type: 'group', id: 'suivre', items: [
      { href: 'stats.html', icon: '📊', label: 'Stats' },
      { href: 'historique.html', icon: '📅', label: 'Historique' },
      { href: 'search.html', icon: '🔍', label: 'Recherche' }
    ] },
    { type: 'group', id: 'references', items: [
      { href: 'fiches.html', icon: '📝', label: 'Fiches' },
      { href: 'symboles.html', icon: '🔣', label: 'Symboles' },
      { href: 'urgences.html', icon: '🚨', label: 'Urgences' },
      { href: 'radial.html', icon: '📡', label: 'Radial' }
    ] },
    { type: 'group', id: 'briefing', featured: true, items: [
      { href: 'navlog.html', tab: 'nav', icon: '🧭', label: 'Vue d’ensemble' },
      { href: 'navlog.html#meteo', tab: 'meteo', icon: '🌦️', label: 'Météo' },
      { href: 'navlog.html#notam', tab: 'notam', icon: '⚠️', label: 'NOTAMs' },
      { href: 'navlog.html#masse', tab: 'masse', icon: '⚖️', label: 'Masse & centrage' },
      { href: 'navlog.html#perf', tab: 'perf', icon: '📊', label: 'Perf' },
      { href: 'navlog.html#altitudes', tab: 'altitudes', icon: '🏔️', label: 'Altitudes' },
      { href: 'navlog.html#fuel', tab: 'fuel', icon: '⛽', label: 'Carburant' },
      { href: 'navlog.html#checklist', tab: 'checklist', icon: '✅', label: 'Checklist' },
      { href: 'navlog.html#notes', tab: 'notes', icon: '📝', label: 'Notes' },
      { href: 'navlog.html#fpl', tab: 'fpl', icon: '✈️', label: 'FPL' },
      { href: 'navlog.html#dossiers', tab: 'dossiers', icon: '📂', label: 'Dossiers' }
    ] },
    { type: 'link', href: 'plongee.html', icon: '🤿', label: 'Plongée' },
    { type: 'sep' },
    { type: 'link', href: 'configuration.html', icon: '⚙️', label: 'Configuration' }
  ];

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
    var isCurrent = !item.tab && hrefFile(item.href) === cur;
    var attrs = 'href="' + esc(item.href) + '" class="sidebar-link' + (isCurrent ? ' sidebar-link-current' : '') + '"';
    if (item.tab) attrs += ' data-navlog-tab="' + esc(item.tab) + '"';
    return '<a ' + attrs + '>' + item.icon + ' <span>' + esc(item.label) + '</span></a>';
  }

  function buildHtml(cur) {
    var html = '';
    STRUCTURE.forEach(function (entry) {
      if (entry.type === 'link') {
        html += linkHtml(entry, cur);
      } else if (entry.type === 'sep') {
        html += '<hr class="sidebar-sep">';
      } else if (entry.type === 'group') {
        var containsCurrent = entry.items.some(function (it) { return hrefFile(it.href) === cur; });
        html += '<details class="sidebar-group"'
          + (entry.featured ? ' data-featured="1"' : '')
          + ' data-group="' + entry.id + '"'
          + (containsCurrent ? ' open' : '') + '>'
          + '<summary>' + GROUP_LABELS[entry.id] + '</summary>'
          + '<div class="sidebar-group-items">'
          + entry.items.map(function (it) { return linkHtml(it, cur); }).join('')
          + '</div></details>';
      }
    });
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
      + '<span class="sidebar-header-icon">✈️</span>'
      + '<span class="sidebar-header-title">Quiz PPL</span>'
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
