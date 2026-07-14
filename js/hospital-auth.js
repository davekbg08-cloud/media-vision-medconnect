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

   Sécurité : le mot de passe hôpital est vérifié via un vrai compte
   Firebase Auth (signInWithEmailAndPassword), jamais via une valeur
   stockée dans le document établissement — ce document est lisible
   par tout utilisateur connecté (allow read: if signedIn()), donc
   inadapté à y garder un secret, même haché. (Ancien mécanisme :
   hash SHA-256 non salé en clair dans ce document — corrigé, voir
   migrateLegacyEstablishmentAuth pour les établissements hérités.)
   Firestore reste la source de vérité ; localStorage n'est qu'un
   cache de session.

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
  // Anti double-appui : la connexion enchaîne recherche cloud +
  // signIn Firebase awaités — un second clic relançait tout en parallèle.
  let _loggingIn = false;
  async function login() {
    if (_loggingIn) return;
    _loggingIn = true;
    try {
      const mat = document.getElementById('ha-login-mat').value.trim();
      const pw  = document.getElementById('ha-login-pw').value;
      if (!mat || !pw) { App.toast('Matricule et mot de passe requis.', 'error'); return; }

      // Correctif sécurité (audit) : l'ancien mécanisme comparait un
      // hash SHA-256 NON SALÉ stocké dans le document établissement —
      // lisible par TOUT utilisateur connecté (allow read: if
      // signedIn() sur hospitals/establissements). Cassable hors ligne
      // par table arc-en-ciel. L'établissement a pourtant déjà un vrai
      // compte Firebase Auth créé à l'inscription (register()) : on
      // l'utilise désormais ici, comme pour le PIN patient. La session
      // Firebase Auth ouverte ici est de toute façon remplacée
      // immédiatement par celle de l'agent (verifyAgent →
      // loginProfessionalSilently, signInWithEmailAndPassword propre à
      // l'agent) — la remarque historique sur "pas de session
      // établissement ici" ne s'applique donc plus.
      const email = establishmentEmail(mat);
      let signedInViaAuth = false;
      if (typeof firebaseAuth !== 'undefined' && firebaseAuth) {
        try {
          await firebaseAuth.signInWithEmailAndPassword(email, pw);
          signedInViaAuth = true;
        } catch (authErr) {
          // Repli hérité (établissement créé avant ce correctif, encore
          // sur passwordHash) géré plus bas — pas d'erreur bloquante ici.
        }
      }

      const est = await findByOfficialId(mat);
      if (!est) { App.toast('Établissement introuvable pour ce matricule.', 'error'); return; }

      // L'établissement doit être VALIDÉ par l'administration MedConnect
      // avant toute connexion. Une inscription ne s'active pas d'elle-même.
      const estStatus = String(est.status || '').toLowerCase();
      if (!['active', 'approved'].includes(estStatus)) {
        App.toast('⏳ Cet établissement est en attente de validation par l\'administration MedConnect. Réessayez une fois validé.', 'error');
        return;
      }

      if (!signedInViaAuth) {
        // Établissement hérité : encore vérifié via l'ancien hash, PUIS
        // migré organiquement (jamais l'inverse — le hash n'est retiré
        // qu'une fois la migration confirmée).
        if (!est.passwordHash) {
          App.toast('Cet établissement n\'a pas encore de mot de passe défini. Contactez l\'administration.', 'error');
          return;
        }
        const hash = await hashPassword(pw);
        if (hash !== est.passwordHash) { App.toast('Mot de passe incorrect.', 'error'); return; }
        await migrateLegacyEstablishmentAuth(est, email, pw);
      }

      // Établissement déverrouillé → connexion personnelle de l'agent.
      renderRolePicker(est);
    } catch (e) {
      console.error('[HospitalAuth] login :', e);
      App.toast(e.message || 'Connexion impossible.', 'error');
    } finally { _loggingIn = false; }
  }

  /* Migration organique (même principe que le PIN patient) : crée le
     compte Firebase Auth manquant pour un établissement hérité, puis
     retire le hash en clair du document — non bloquant pour la
     connexion en cours (déjà réussie via l'ancien hash au-dessus). */
  async function migrateLegacyEstablishmentAuth(est, email, pw) {
    if (typeof firebaseAuth === 'undefined' || !firebaseAuth) return;
    try {
      const cred = await firebaseAuth.createUserWithEmailAndPassword(email, pw);
      const authUid = cred?.user?.uid || '';
      if (!authUid) return;
      await window.HospitalsRegistry?.migratePasswordHashToAuth?.(est.establishmentId || est.id, authUid);
    } catch (e) {
      console.warn('[HospitalAuth] Migration établissement :', e?.code || e?.message);
    }
  }

  /* ── CONNEXION PERSONNELLE DE L'AGENT ──────────────────
     Chaque agent se connecte avec SON PROPRE compte (numéro
     professionnel + mot de passe personnel). Cela crée une vraie
     session Firebase Auth À SON NOM : le serveur lit alors son
     rôle réel (users/{uid}.role) et distingue médecin, laborantin,
     etc. — le verrouillage de capacité devient effectif côté
     serveur, par personne. L'agent doit être affilié au staff de
     l'établissement. */
  function renderRolePicker(est) {
    const scr = document.getElementById('auth-screen');
    scr.innerHTML = `
      <div class="hospital-auth-wrap">
        <div class="hospital-auth-card">
          <div class="hospital-auth-brand">🏥 <strong>${esc(est.name || 'Établissement')}</strong><span>Matricule ${esc(est.officialId || '')}</span></div>
          <p style="margin:.5rem 0 1rem;opacity:.75">Connectez-vous avec votre compte professionnel personnel :</p>
          <div class="form-group">
            <label>Rôle</label>
            <select id="ha-agent-role">
              <option value="doctor">Médecin</option>
              <option value="nurse">Infirmier(e)</option>
              <option value="pharmacist">Pharmacie</option>
              <option value="lab">Laboratoire</option>
              <option value="reception">Réception</option>
            </select>
          </div>
          <div class="form-group">
            <label>Numéro d'ordre / matricule</label>
            <input id="ha-agent-num" placeholder="Votre numéro professionnel" autocomplete="off">
          </div>
          <div class="form-group">
            <label>Mot de passe personnel</label>
            <input id="ha-agent-pw" type="password" placeholder="••••••••">
          </div>
          <button class="btn btn-primary btn-full" onclick="HospitalAuth.verifyAgent('${esc(est.establishmentId || est.id)}')">Se connecter</button>
          <div id="ha-agent-msg" style="margin-top:.8rem"></div>
          <button class="btn btn-ghost btn-full" style="margin-top:1rem" onclick="HospitalAuth.renderScreen()">← Retour</button>
        </div>
      </div>`;
  }

  /* Vérifie l'affiliation de l'agent au staff de l'établissement
     (le rôle au sein de l'hôpital). L'AUTHENTIFICATION, elle, se
     fait par le vrai compte Firebase de l'agent dans verifyAgent. */
  function findStaffRole(est, uid, number, role) {
    const num = String(number || '').trim().toUpperCase();
    const staff = Array.isArray(est.staff) ? est.staff : [];
    // Priorité : correspondance par uid (identité authentifiée).
    let member = staff.find(s => s.uid === uid && (s.status === 'active' || s.status === 'approved'));
    // Repli : par numéro professionnel (agent affilié avant d'avoir un uid lié).
    if (!member) {
      member = staff.find(s =>
        String(s.professionalNumber || '').toUpperCase() === num &&
        (s.status === 'active' || s.status === 'approved'));
    }
    return member || null;
  }

  async function verifyAgent(establishmentId) {
    const est = (window.HospitalsRegistry?.getHospitalById?.(establishmentId)) || { establishmentId };
    const role = document.getElementById('ha-agent-role').value;
    const num  = document.getElementById('ha-agent-num').value.trim();
    const pw   = document.getElementById('ha-agent-pw').value;
    const msg  = document.getElementById('ha-agent-msg');
    if (!num || !pw) { App.toast('Numéro et mot de passe requis.', 'error'); return; }

    // 1) Authentification PERSONNELLE de l'agent (vraie session Firebase
    //    à son nom → le serveur lira SON rôle). On réutilise le login
    //    professionnel existant (Auth.loginProfessional) qui résout le
    //    compte par numéro + rôle et fait signInWithEmailAndPassword.
    let account = null;
    try {
      account = await window.Auth?.loginProfessionalSilently?.(role, num, pw);
    } catch (_) { account = null; }

    if (!account) {
      msg.innerHTML = `<div class="auth-register-info" style="border-color:var(--danger)">❌ Identifiants incorrects. Utilisez votre numéro professionnel et votre mot de passe personnel (le même que sur mobile).</div>`;
      return;
    }

    // 2) Vérifier l'affiliation au staff de l'établissement.
    const member = findStaffRole(est, account.uid, num, role);
    if (!member) {
      // L'agent est authentifié mais pas affilié : on CRÉE une demande
      // d'affiliation pour que l'administration puisse la valider.
      // (Auparavant on affichait juste un message sans rien créer —
      // l'admin ne recevait donc aucune demande.)
      let created = false;
      try {
        const existing = (window.HospitalsRegistry?.getAffiliations?.() || []).find(a =>
          a.requesterUid === account.uid && a.establishmentId === (est.establishmentId || establishmentId) &&
          a.status === 'pending');
        if (existing) {
          created = 'exists';
        } else {
          const req = window.HospitalsRegistry?.requestAffiliation?.(
            account.uid, account.name || `${role} ${num}`, est.establishmentId || establishmentId,
            { role, professionalNumber: num });
          created = !!req;
        }
      } catch (e) {
        console.warn('[HospitalAuth] Création demande affiliation :', e);
      }

      msg.innerHTML = created === 'exists'
        ? `<div class="auth-register-info" style="border-color:var(--accent)">⏳ Votre demande d'affiliation est déjà en attente de validation par l'administration.</div>`
        : created
          ? `<div class="auth-register-info" style="border-color:var(--secondary)">✅ Demande d'affiliation envoyée à l'administration. Vous pourrez vous connecter une fois validé.</div>`
          : `<div class="auth-register-info" style="border-color:var(--danger)">⚠️ Vous êtes authentifié, mais pas affilié, et la demande n'a pas pu être créée. Contactez l'administration.</div>`;

      if (firebaseAuth?.signOut) { try { await firebaseAuth.signOut(); } catch (_) {} }
      return;
    }

    // Rôle de session = rôle vérifié dans le staff (source de vérité
    // de l'affiliation), qui doit concorder avec le compte.
    enter(establishmentId, member.role || account.role || role, {
      name: account.name || member.name,
      professionalNumber: num,
      uid: account.uid,
    });
  }

  function enter(establishmentId, role, agentInfo = {}) {
    const est = (window.HospitalsRegistry?.getHospitalById?.(establishmentId)) || { establishmentId };
    const session = {
      establishmentId,
      establishmentName: est.name || '',
      officialId: est.officialId || '',
      role,
      agentName: agentInfo.name || '',
      agentUid: agentInfo.uid || '',
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
  // Anti double-appui : l'inscription crée un compte Firebase Auth puis
  // plusieurs documents — un second clic pendant ce temps déclenchait
  // une seconde création (auth/email-already-in-use trompeur).
  let _registering = false;
  async function register() {
    if (_registering) return;
    _registering = true;
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

      // 1) Compte Firebase Auth de l'établissement (identité serveur).
      let authUid = '';
      if (typeof firebaseAuth !== 'undefined' && firebaseAuth) {
        try {
          const cred = await firebaseAuth.createUserWithEmailAndPassword(
            establishmentEmail(mat), pw);
          authUid = cred?.user?.uid || '';
        } catch (authErr) {
          if (authErr?.code === 'auth/email-already-in-use') {
            App.toast('Un établissement existe déjà avec ce matricule.', 'error'); return;
          }
          console.warn('[HospitalAuth] Création compte établissement :', authErr?.code || authErr?.message);
          App.toast('Création du compte impossible : ' + (authErr?.message || authErr), 'error');
          return;
        }

        // Document users/{uid} : rôle 'hospital', statut 'pending'
        // (validé par l'admin comme les autres inscriptions). Correctif
        // (audit) : cette écriture partageait auparavant le try/catch
        // ci-dessus — un échec ici (règle rejetée, coupure réseau)
        // tombait dans le même catch SANS nettoyer le compte Firebase
        // Auth qui vient d'être créé, le laissant orphelin (email
        // squatté) : à la relance, auth/email-already-in-use affiche à
        // tort "Un établissement existe déjà" alors qu'aucun
        // établissement n'a jamais été créé — même famille de bug que
        // _createPatientPin/_reg, corrigée ici avec le même rollback.
        if (authUid && typeof firebaseDB !== 'undefined' && firebaseDB) {
          try {
            await firebaseDB.collection('users').doc(authUid).set({
              uid: authUid,
              role: 'hospital',
              status: 'pending',
              name: name,
              officialId: mat.toUpperCase(),
              establishmentName: name,
            }, { merge: true });
          } catch (usersErr) {
            console.warn('[HospitalAuth] Écriture users/ échouée, nettoyage du compte Firebase :', usersErr?.code || usersErr?.message);
            try { await firebaseAuth.currentUser?.delete(); }
            catch (e) { console.warn('[HospitalAuth] Nettoyage compte Firebase après échec users/ :', e); }
            App.toast('Création du compte impossible : ' + (usersErr?.message || usersErr), 'error');
            return;
          }
        }
      }

      // 2) Document établissement (registre métier). Correctif (audit) :
      // establishments/hospitals/mc_hospitals n'acceptaient l'écriture
      // que d'un admin — le compte non-admin qui vient de s'inscrire ne
      // pouvait donc JAMAIS faire aboutir cette écriture (échec
      // silencieux, jamais rejoué avec succès). La règle a été corrigée
      // (voir firestore.rules) ; on attend maintenant la confirmation
      // réelle avant d'annoncer un succès, et on nettoie le compte
      // Firebase Auth orphelin si le serveur refuse quand même (même
      // principe que le correctif patient, js/auth.js
      // _createPatientPin).
      const result = window.HospitalsRegistry?.addHospitalAndConfirm
        ? await window.HospitalsRegistry.addHospitalAndConfirm({
            name,
            officialId: mat.toUpperCase(),
            city,
            authUid,
            status: 'pending', // validation par l'admin MedConnect
            registeredFrom: 'desktop',
          })
        : null;
      if (!result?.hospital) { App.toast('Création impossible.', 'error'); return; }
      if (!result.confirmed) {
        if (authUid && typeof firebaseAuth !== 'undefined' && firebaseAuth?.currentUser) {
          try { await firebaseAuth.currentUser.delete(); }
          catch (e) { console.warn('[HospitalAuth] Nettoyage du compte Firebase après refus :', e); }
        }
        App.toast('❌ Création refusée — réessayez plus tard ou contactez le support.', 'error');
        return;
      }

      App.toast('✅ Établissement créé. En attente de validation par l\'administration.');
      showTab('login');
      const m = document.getElementById('ha-login-mat'); if (m) m.value = mat;
    } catch (e) {
      console.error('[HospitalAuth] register :', e);
      App.toast(e.message || 'Inscription impossible.', 'error');
    } finally { _registering = false; }
  }

  async function logout() {
    // Poste hospitalier PARTAGÉ : pousser la file d'écritures, fermer
    // la session Firebase, puis purger les caches médicaux pour que
    // l'agent suivant ne retrouve rien du précédent.
    try { await window.DB?.flushOutbox?.(); } catch (_) {}
    clearSession();
    if (typeof firebaseAuth !== 'undefined' && firebaseAuth?.signOut) {
      try { await firebaseAuth.signOut(); } catch (_) {}
    }
    try {
      const MEDICAL_KEYS = [
        'mc_patients', 'mc_consultations', 'mc_prescriptions',
        'mc_admissions', 'mc_appointments', 'mc_lab_results',
        'mc_vaccinations', 'mc_messages', 'mc_medicines', 'mc_sales',
        'mc_emergency_cases', 'mc_maternity_cases',
        'mc_cloud_outbox',
      ];
      MEDICAL_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    } catch (e) { console.warn('[HospitalAuth] purge cache :', e?.message || e); }
    renderScreen();
  }

  return { renderScreen, showTab, login, register, enter, verifyAgent, logout, getSession, hashPassword };
})();

window.HospitalAuth = HospitalAuth;
