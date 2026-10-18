// ============================================================
// account.js — Carte « Mon compte » (connexion Firebase) réutilisable
// ============================================================
//
// Chaque application (Quiz PPL, Briefing VFR, Bibliothèque du pilote) a son propre stockage sur
// le téléphone : il faut donc pouvoir se connecter depuis chacune d'elles pour retrouver sa
// sauvegarde (progression, dossiers de vol, surlignages…). Même logique que l'accueil du quiz :
// connexion, ou création du compte s'il n'existe pas encore.
//
// Usage : renderAccountCard(element)   — nécessite window.auth (Firebase Auth initialisé).

(function () {
  'use strict';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function render(el, user) {
    if (user) {
      el.innerHTML = '<div class="acc-row"><span class="acc-dot on"></span><div class="acc-grow"><b>Connecté</b><br>'
        + '<small>' + esc(user.email || user.uid.slice(0, 8)) + ' · sauvegarde et synchronisation actives</small></div>'
        + '<button type="button" class="acc-btn" data-acc="out">Se déconnecter</button></div>';
      return;
    }
    el.innerHTML = '<div class="acc-row"><span class="acc-dot"></span><div class="acc-grow"><b>Non connecté</b><br>'
      + '<small>Connecte-toi avec ton compte habituel pour retrouver ta sauvegarde.</small></div></div>'
      + '<form class="acc-form" autocomplete="on"><input type="email" name="email" placeholder="E-mail" required autocomplete="username">'
      + '<input type="password" name="password" placeholder="Mot de passe (6 caractères min.)" minlength="6" required autocomplete="current-password">'
      + '<button type="submit" class="acc-btn primary">Se connecter</button></form><div class="acc-msg"></div>';
  }

  window.renderAccountCard = function (el) {
    if (!el) return;
    if (!window.auth) { el.innerHTML = '<small>Connexion indisponible (hors-ligne ?).</small>'; return; }
    render(el, window.auth.currentUser);
    window.auth.onAuthStateChanged(function (user) {
      if (user) { try { localStorage.setItem('cachedUid', user.uid); } catch (e) { /* ignore */ } }
      render(el, user);
    });
    el.addEventListener('click', function (e) {
      if (e.target.getAttribute('data-acc') !== 'out') return;
      try { localStorage.removeItem('cachedUid'); } catch (e2) { /* ignore */ }
      window.auth.signOut();
    });
    el.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, msg = el.querySelector('.acc-msg');
      var email = f.email.value.trim(), pw = f.password.value;
      msg.textContent = 'Connexion…';
      window.auth.signInWithEmailAndPassword(email, pw).catch(function (err) {
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-login-credentials') {
          if (!confirm('Aucun compte avec ces identifiants. Créer un nouveau compte pour ' + email + ' ?')) { msg.textContent = 'Vérifie l’e-mail et le mot de passe.'; return; }
          return window.auth.createUserWithEmailAndPassword(email, pw);
        }
        throw err;
      }).then(function () { msg.textContent = ''; }).catch(function (err) { msg.textContent = '❌ ' + (err.message || err); });
    });
  };
})();
