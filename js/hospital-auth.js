/* =====================================================
   MedConnect 2.0 — HospitalAuth (entrée DESKTOP)
   Connexion / inscription par ÉTABLISSEMENT.

   Logique voulue (desktop ≠ mobile) : le desktop est destiné à
   l'hôpital, pas à un professionnel isolé ni à un patient. On
   n'ouvre donc PAS l'écran mobile (inscription médecin/patient…).
   On demande une clé d'établissement :
     matricule (officialId) + mot de passe hôpital.
   Puis l'agent choisit son rôle dans cet hôpital (le rôle fixe
   son niveau d'accès dans le tableau de bord).

   Sécurité : le mot de passe hôpital n'est JAMAIS stocké en clair.
   On conserve seulement son empreinte SHA-256 (passwordHash) dans
   le document établissement. Firestore reste la source de vérité ;
   localStorage n'est qu'un cache de session.

   Rôles desktop autorisés (jamais 'patient') :
     admin_hospital, doctor, nurse, lab, reception, pharmacist
   ===================================================== */
const HospitalAuth = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const SESSION_KEY = 'mc_hospital_session';

  // Domaine technique pour les comptes établissement Firebase Auth.
  // L'agent ne le voit jamais : il saisit matricule + mot de passe,
  // on dérive l'email de façon déterministe pour signInWithEmailAndPassword.
  const EST_EMAIL_DOMAIN = 'etablissement.medconnect';
  function establishmentEmail(officialId) {
    return `est_${String(officialId||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'')}@${EST_EMAIL_DOMAIN}`;
  }

  const DESK_ROLES = [
    { key:'admin_hospital', label:'Administration hôpital', icon:'🏛️' },
    { key:'doctor',         label:'Médecin',                icon:'👨‍⚕️' },
    { key:'nurse',          label:'Infirmier(e)',           icon:'🩺' },
    { key:'lab',            label:'Laboratoire',            icon:'🧪' },
    { key:'reception',      label:'Réception',              icon:'🛎️' },
    { key:'pharmacist',     label:'Pharmacie',              icon:'💊' },
  ];

  /* ── Hachage du mot de passe (SHA-256) ─────────────── */
  async function hashPassword(pw) {
    const data = new TextEncoder().encode(String(pw));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ── Session hôpital (cache) ───────────────────────── */
  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function saveSession(s) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function clearSession()  { sessionStorage.removeItem(SESSION_KEY); }

  /* ── Recherche d'établissement par matricule ───────── */
  async function findByOfficialId(officialId) {
    const oid = String(officialId || '').trim().toUpperCase();
    if (!oid) return null;
    // Cloud d'abord (source de vérité), repli cache local.
    if (typeof firebaseDB !== 'undefined' && firebaseDB) {
      try {
        for (const field of ['officialId', 'matricule']) {
          const snap = await firebaseDB.collection('establishments').where(field, '==', oid).limit(1).get();
          if (!snap.empty) { const d = snap.docs[0]; return { id: d.id, ...d.data() }; }
        }
      } catch (e) { console.warn('[HospitalAuth] Recherche cloud :', e?.message || e); }
    }
    return (window.HospitalsRegistry?.getHospitals?.() || [])
      .find(h => String(h.officialId || '').toUpperCase() === oid) || null;
  }

  /* ── ÉCRAN DE CONNEXION ────────────────────────────── */
  function renderScreen() {
    const scr = document.getElementById('auth-screen');
    if (!scr) return;
    scr.style.display = 'block';
    document.getElementById('landing') && (document.getElementById('landing').style.display = 'none');
    document.getElementById('app-layout') && (document.getElementById('app-layout').style.display = 'none');

    scr.innerHTML = `
      <div class="hospital-auth-wrap">
        <div class="hospital-auth-card">
          <div class="hospital-auth-brand">🏥 <strong>MedConnect</strong><span>Desktop — Espace hôpital</span></div>

          <div class="hospital-auth-tabs">
            <button id="ha-tab-login" class="ha-tab active" onclick="HospitalAuth.showTab('login')">Connexion</button>
            <button id="ha-tab-register" class="ha-tab" onclick="HospitalAuth.showTab('register')">Inscription hôpital</button>
          </div>

          <div id="ha-login">
            <div class="form-group">
              <label>Matricule de l'établissement</label>
              <input id="ha-login-mat" placeholder="Ex : 1234567890" autocomplete="off">
            </div>
            <div class="form-group">
              <label>Mot de passe hôpital</label>
              <input id="ha-login-pw" type="password" placeholder="••••••••">
            </div>
            <button class="btn btn-primary btn-full" onclick="HospitalAuth.login()">Se connecter</button>
          </div>

          <div id="ha-register" style="display:none">
            <div class="form-group">
              <label>Nom de l'établissement *</label>
              <input id="ha-reg-name" placeholder="Ex : Hôpital Saint-Paul">
            </div>
            <div class="form-group">
              <label>Matricule officiel *</label>
              <input id="ha-reg-mat" placeholder="Numéro d'enregistrement officiel">
            </div>
            <div class="form-group">
              <label>Ville</label>
              <input id="ha-reg-city" placeholder="Ex : Kinshasa">
            </div>
            <div class="form-group">
              <label>Mot de passe hôpital *</label>
              <input id="ha-reg-pw" type="password" placeholder="Minimum 6 caractères">
            </div>
            <div class="form-group">
              <label>Confirmer le mot de passe *</label>
              <input id="ha-reg-pw2" type="password" placeholder="Répétez le mot de passe">
            </div>
            <div class="auth-register-info">
              L'inscription crée l'établissement et une demande de validation
              auprès de l'administration MedConnect. L'abonnement desktop est
              activé après paiement (mobile money 0856373707).
            </div>
            <button class="btn btn-primary btn-full" onclick="HospitalAuth.register()">Créer l'établissement</button>
          </div>
        </div>
      </div>`;
  }

  function showTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('ha-login').style.display = isLogin ? 'block' : 'none';
    document.getElementById('ha-register').style.display = isLogin ? 'none' : 'block';
    document.getElementById('ha-tab-login').classList.toggle('active', isLogin);
    document.getElementById('ha-tab-register').classList.toggle('active', !isLogin);
  }

  /* ── CONNEXION ─────────────────────────────────────── */
  async function login() {
    try {
      const mat = document.getElementById('ha-login-mat').value.trim();
      const pw  = document.getElementById('ha-login-pw').value;
      if (!mat || !pw) { App.toast('Matricule et mot de passe requis.', 'error'); return; }

      const est = await findByOfficialId(mat);
      if (!est) { App.toast('Établissement introuvable pour ce matricule.', 'error'); return; }

      // 1) Session Firebase Auth RÉELLE (identité request.auth pour les
      //    règles serveur). L'email est dérivé du matricule.
      if (typeof firebaseAuth !== 'undefined' && firebaseAuth) {
        try {
          await firebaseAuth.signInWithEmailAndPassword(establishmentEmail(est.officialId), pw);
        } catch (authErr) {
          // Mot de passe refusé par Firebase = mauvais mot de passe
          // (ou compte établissement pas encore créé côté Auth).
          console.warn('[HospitalAuth] Auth établissement :', authErr?.code || authErr?.message);
          App.toast('Mot de passe incorrect ou établissement non activé. Contactez l\'administration.', 'error');
          return;
        }
      }

      // 2) Double vérification locale par empreinte (défense en profondeur).
      if (est.passwordHash) {
        const hash = await hashPassword(pw);
        if (hash !== est.passwordHash) {
          if (firebaseAuth?.signOut) { try { await firebaseAuth.signOut(); } catch (_) {} }
          App.toast('Mot de passe incorrect.', 'error'); return;
        }
      }

      // Établissement authentifié → identification de l'agent.
      renderRolePicker(est);
    } catch (e) {
      console.error('[HospitalAuth] login :', e);
      App.toast(e.message || 'Connexion impossible.', 'error');
    }
  }

  /* ── VÉRIFICATION DE L'AGENT PAR NUMÉRO PROFESSIONNEL ──
     Le rôle ne se CHOISIT pas : l'agent saisit son numéro d'ordre
     (médecin) ou matricule (infirmier, pharmacien, labo…). On le
     retrouve dans le staff VÉRIFIÉ de l'établissement, et son rôle
     + niveau d'accès en découlent. Un laborantin ne peut donc pas
     se présenter comme médecin. */
  function renderRolePicker(est) {
    const scr = document.getElementById('auth-screen');
    scr.innerHTML = `
      <div class="hospital-auth-wrap">
        <div class="hospital-auth-card">
          <div class="hospital-auth-brand">🏥 <strong>${esc(est.name || 'Établissement')}</strong><span>Matricule ${esc(est.officialId || '')}</span></div>
          <p style="margin:.5rem 0 1rem;opacity:.75">Identifiez-vous avec votre numéro professionnel (numéro d'ordre pour les médecins, matricule pour les autres) :</p>
          <div class="form-group">
            <label>Numéro d'ordre / matricule</label>
            <input id="ha-agent-num" placeholder="Votre numéro professionnel" autocomplete="off">
          </div>
          <button class="btn btn-primary btn-full" onclick="HospitalAuth.verifyAgent('${esc(est.establishmentId || est.id)}')">Vérifier et entrer</button>
          <div id="ha-agent-msg" style="margin-top:.8rem"></div>
          <button class="btn btn-ghost btn-full" style="margin-top:1rem" onclick="HospitalAuth.renderScreen()">← Retour</button>
        </div>
      </div>`;
  }

  /* Cherche l'agent dans le staff de l'établissement (source de
     vérité du rôle au sein de l'hôpital), avec repli sur les
     registres professionnels vérifiés. */
  function findAgent(est, number) {
    const num = String(number || '').trim().toUpperCase();
    if (!num) return null;

    // 1) staff de l'établissement (rôle affilié + validé par l'admin)
    const staff = Array.isArray(est.staff) ? est.staff : [];
    const member = staff.find(s =>
      String(s.professionalNumber || '').toUpperCase() === num &&
      (s.status === 'active' || s.status === 'approved'));
    if (member) {
      return { role: member.role, name: member.name, professionalNumber: num, source: 'staff' };
    }

    // 2) registres professionnels vérifiés (identité nationale)
    //    — n'accorde PAS l'accès seul : il faut être dans le staff.
    //    Ici on distingue "numéro inconnu" de "connu mais non affilié".
    const inRegistry =
      window.ACL?.getVerifiedDoctors?.().some(d => String(d.order_num||'').toUpperCase() === num) ||
      window.ACL?.getVerifiedNurses?.().some(n => String(n.matricule||'').toUpperCase() === num) ||
      window.ACL?.getVerifiedPharmacists?.().some(p => String(p.matricule||'').toUpperCase() === num);
    if (inRegistry) return { notAffiliated: true };

    return null;
  }

  function verifyAgent(establishmentId) {
    const est = (window.HospitalsRegistry?.getHospitalById?.(establishmentId)) || { establishmentId };
    const num = document.getElementById('ha-agent-num').value.trim();
    const msg = document.getElementById('ha-agent-msg');
    if (!num) { App.toast('Numéro professionnel requis.', 'error'); return; }

    const agent = findAgent(est, num);
    if (!agent) {
      msg.innerHTML = `<div class="auth-register-info" style="border-color:var(--danger)">❌ Numéro non reconnu pour cet établissement. Demandez à l'administration de vous affilier.</div>`;
      return;
    }
    if (agent.notAffiliated) {
      msg.innerHTML = `<div class="auth-register-info" style="border-color:var(--accent)">⚠️ Vous êtes vérifié, mais pas encore affilié à cet établissement. L'administration doit valider votre affiliation.</div>`;
      return;
    }

    // Rôle VÉRIFIÉ → entrée avec le niveau d'accès correspondant.
    enter(establishmentId, agent.role, { name: agent.name, professionalNumber: agent.professionalNumber });
  }

  function enter(establishmentId, role, agentInfo = {}) {
    const est = (window.HospitalsRegistry?.getHospitalById?.(establishmentId)) || { establishmentId };
    const session = {
      establishmentId,
      establishmentName: est.name || '',
      officialId: est.officialId || '',
      role,
      agentName: agentInfo.name || '',
      professionalNumber: agentInfo.professionalNumber || '',
      loggedAt: new Date().toISOString(),
    };
    saveSession(session);

    // L'établissement actif conditionne tous les listeners/filtres.
    try { window.HospitalsRegistry?.setCurrentHospital?.(establishmentId); } catch (_) {}

    // Ouvre le shell desktop plein écran.
    document.getElementById('auth-screen').style.display = 'none';
    if (window.HospitalDesktopUI?.openForSession) {
      HospitalDesktopUI.openForSession(session);
    } else {
      HospitalDesktopUI?.open?.();
    }
  }

  /* ── INSCRIPTION D'UN ÉTABLISSEMENT ────────────────── */
  async function register() {
    try {
      const name = document.getElementById('ha-reg-name').value.trim();
      const mat  = document.getElementById('ha-reg-mat').value.trim();
      const city = document.getElementById('ha-reg-city').value.trim();
      const pw   = document.getElementById('ha-reg-pw').value;
      const pw2  = document.getElementById('ha-reg-pw2').value;

      if (!name || !mat) { App.toast('Nom et matricule obligatoires.', 'error'); return; }
      if (pw.length < 6) { App.toast('Mot de passe : 6 caractères minimum.', 'error'); return; }
      if (pw !== pw2)    { App.toast('Les mots de passe ne correspondent pas.', 'error'); return; }

      const existing = await findByOfficialId(mat);
      if (existing) { App.toast('Un établissement existe déjà avec ce matricule.', 'error'); return; }

      const passwordHash = await hashPassword(pw);

      // 1) Compte Firebase Auth de l'établissement (identité serveur).
      let authUid = '';
      if (typeof firebaseAuth !== 'undefined' && firebaseAuth) {
        try {
          const cred = await firebaseAuth.createUserWithEmailAndPassword(
            establishmentEmail(mat), pw);
          authUid = cred?.user?.uid || '';
          // Document users/{uid} : rôle 'hospital', statut 'pending'
          // (validé par l'admin comme les autres inscriptions).
          if (authUid && typeof firebaseDB !== 'undefined' && firebaseDB) {
            await firebaseDB.collection('users').doc(authUid).set({
              uid: authUid,
              role: 'hospital',
              status: 'pending',
              name: name,
              officialId: mat.toUpperCase(),
              establishmentName: name,
            }, { merge: true });
          }
        } catch (authErr) {
          if (authErr?.code === 'auth/email-already-in-use') {
            App.toast('Un établissement existe déjà avec ce matricule.', 'error'); return;
          }
          console.warn('[HospitalAuth] Création compte établissement :', authErr?.code || authErr?.message);
          App.toast('Création du compte impossible : ' + (authErr?.message || authErr), 'error');
          return;
        }
      }

      // 2) Document établissement (registre métier).
      const est = window.HospitalsRegistry?.addHospital?.({
        name,
        officialId: mat.toUpperCase(),
        city,
        passwordHash,
        authUid,
        status: 'pending', // validation par l'admin MedConnect
        registeredFrom: 'desktop',
      });
      if (!est) { App.toast('Création impossible.', 'error'); return; }

      App.toast('✅ Établissement créé. En attente de validation par l\'administration.');
      showTab('login');
      const m = document.getElementById('ha-login-mat'); if (m) m.value = mat;
    } catch (e) {
      console.error('[HospitalAuth] register :', e);
      App.toast(e.message || 'Inscription impossible.', 'error');
    }
  }

  function logout() {
    clearSession();
    if (typeof firebaseAuth !== 'undefined' && firebaseAuth?.signOut) {
      try { firebaseAuth.signOut(); } catch (_) {}
    }
    renderScreen();
  }

  return { renderScreen, showTab, login, register, enter, verifyAgent, logout, getSession, hashPassword };
})();

window.HospitalAuth = HospitalAuth;
