/* =====================================================
   MedConnect 2.0 — Auth Module (Production)
   ===================================================== */
const Auth = (() => {

  const ICONS  = { patient:'🩺', doctor:'👨‍⚕️', pharmacist:'💊', nurse:'🩹', lab:'🧪', reception:'🛎️', admin:'⚙️' };
  const LABELS = { patient:'Patient', doctor:'Médecin', pharmacist:'Pharmacien', nurse:'Infirmier(e)', lab:'Laboratoire', reception:'Réception', admin:'Administrateur' };
  const ADMIN  = { uid:'admin_root', role:'admin', name:'Administrateur' };
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ── SESSION ──────────────────────────────────────── */
  function getUser()  { try { return JSON.parse(sessionStorage.getItem('mc_user')||'null'); } catch { return null; } }
  function isLogged() { return !!getUser(); }
  function _save(u)   { sessionStorage.setItem('mc_user', JSON.stringify(u)); }

  function logout() {
    sessionStorage.clear();
    if (window.HospitalsRegistry) HospitalsRegistry.clearCurrentHospital?.();
    showLogin();
  }

  /* ── ÉCRAN LOGIN ──────────────────────────────────── */
  function showLogin() {
    ['landing','app-layout'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const scr = document.getElementById('auth-screen');
    if (!scr) return;
    scr.style.display = 'flex';
    scr.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo" id="auth-logo-clicks">🏥</div>
        <h1 class="auth-title">MedConnect</h1>
        <p class="auth-sub">Plateforme Médicale Sécurisée v2.0</p>
        <div class="auth-tabs">
          <button id="tbtn-login" class="auth-tab active" onclick="Auth._tab('login')">🔐 Connexion</button>
          <button id="tbtn-register" class="auth-tab" onclick="Auth._tab('register')">📝 Inscription</button>
        </div>
        <div id="tab-login">${_htmlLogin()}</div>
        <div id="tab-register" style="display:none">${_htmlRegister()}</div>
        <div id="auth-lang" style="margin-top:1rem;display:flex;justify-content:center"></div>
        <p style="font-size:.68rem;color:var(--text-dim);text-align:center;margin-top:.5rem">
          📞 +243 856 373 707 · MedConnect v2.0 © 2026
        </p>
      </div>`;

    const lc = document.getElementById('auth-lang');
    if (lc) lc.innerHTML = I18n.renderSelector();

    let clicks = 0, t;
    document.getElementById('auth-logo-clicks')?.addEventListener('click', () => {
      if (++clicks >= 5) { clicks = 0; clearTimeout(t); _adminModal(); }
      clearTimeout(t); t = setTimeout(() => clicks = 0, 2000);
    });
  }

  function _htmlLogin() { return `
    <div class="role-selector" id="login-roles">
      ${['patient','doctor','pharmacist','nurse'].map(r=>`
        <button class="role-btn" data-role="${r}" onclick="Auth._loginRole('${r}')">
          <span>${ICONS[r]}</span><span>${LABELS[r]}</span>
        </button>`).join('')}
    </div>
    <div id="login-form"></div>
    <div id="auth-err" class="auth-error" style="display:none"></div>`; }

  function _htmlRegister() { return `
    <div class="auth-register-info">
      🩺 <strong>Patient ?</strong> Votre médecin crée votre fiche.
      Connectez-vous avec votre numéro <code style="color:var(--primary)">MC-XXXX-CC-XXXXXXXX</code>.
    </div>
    <p style="font-size:.8rem;color:var(--text-muted);margin:.75rem 0 .5rem">Choisissez votre rôle :</p>
    <div class="role-selector" id="register-roles">
      ${['doctor','pharmacist','nurse','lab','reception'].map(r=>`
        <button class="role-btn" data-role="${r}" onclick="Auth._registerRole('${r}')">
          <span>${ICONS[r]}</span><span>${LABELS[r]}</span>
        </button>`).join('')}
    </div>
    <div id="register-form" style="margin-top:.75rem"></div>
    <div id="reg-err" class="auth-error" style="display:none"></div>`; }

  function _tab(tab) {
    const isL = tab === 'login';
    document.getElementById('tab-login').style.display    = isL ? '' : 'none';
    document.getElementById('tab-register').style.display = isL ? 'none' : '';
    document.getElementById('tbtn-login').classList.toggle('active', isL);
    document.getElementById('tbtn-register').classList.toggle('active', !isL);
    ['auth-err','reg-err'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  /* ── FORMULAIRES CONNEXION ────────────────────────── */
  function _loginRole(role) {
    document.querySelectorAll('#login-roles .role-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.role === role));
    document.getElementById('auth-err').style.display = 'none';

    const forms = {
      patient: `
        <div class="auth-register-info" style="margin-top:.75rem">
          🔁 <strong>Compte existant :</strong> connectez-vous à votre dossier déjà sauvegardé. Le premier accès est séparé pour éviter les doublons.
        </div>
        <div class="form-group" style="margin-top:.75rem">
          <label class="inp-lbl">Numéro de fiche unique *</label>
          <input type="text" id="lp-id" class="inp" maxlength="20"
            placeholder="MC-2026-CD-XXXXXXXX"
            style="letter-spacing:1px;text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label class="inp-lbl">PIN (4-6 chiffres) *</label>
          <input type="password" id="lp-pin" class="inp" maxlength="6" placeholder="••••" inputmode="numeric">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Code d'accès hôpital (uniquement pour le premier accès)</label>
          <input type="text" id="lp-access-code" class="inp" maxlength="6" placeholder="Donné par l'hôpital à la création de votre fiche"
            style="letter-spacing:2px;text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
        </div>
        <button class="btn-p" onclick="Auth._doPatient()">🔐 Se connecter à mon dossier existant</button>
        <button class="btn btn-ghost" style="width:100%;margin-top:.6rem" onclick="Auth._createPatientPin()">🆕 Premier accès : créer mon PIN</button>`,

      doctor: `
        <div class="form-group" style="margin-top:.75rem">
          <label class="inp-lbl">N° Ordre Médical *</label>
          <input type="text" id="ld-num" class="inp" placeholder="Votre numéro officiel" style="text-transform:uppercase;font-family:monospace" oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Mot de passe *</label>
          <input type="password" id="ld-pass" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._doDoctor()">🔐 Se connecter</button>`,

      pharmacist: `
        <div class="form-group" style="margin-top:.75rem">
          <label class="inp-lbl">N° Matricule / RCCM *</label>
          <input type="text" id="lph-num" class="inp" placeholder="Votre numéro officiel" style="text-transform:uppercase;font-family:monospace" oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Mot de passe *</label>
          <input type="password" id="lph-pass" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._doPharmacist()">🔐 Se connecter</button>`,

      nurse: `
        <div class="form-group" style="margin-top:.75rem">
          <label class="inp-lbl">N° Matricule Infirmier *</label>
          <input type="text" id="ln-num" class="inp" placeholder="Votre numéro officiel" style="text-transform:uppercase;font-family:monospace" oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Mot de passe *</label>
          <input type="password" id="ln-pass" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._doNurse()">🔐 Se connecter</button>`,
    };
    document.getElementById('login-form').innerHTML = forms[role] || '';
  }

  /* ── FORMULAIRES INSCRIPTION ──────────────────────── */
  function _registerRole(role) {
    document.querySelectorAll('#register-roles .role-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.role === role));
    document.getElementById('reg-err').style.display = 'none';

    const infos = {
      doctor:     `👨‍⚕️ Votre <strong>N° d'Ordre Médical</strong> doit être enregistré par l'administrateur. Entrez-le ci-dessous.`,
      pharmacist: `💊 Votre <strong>N° Matricule RCCM</strong> doit être enregistré par l'administrateur.`,
      nurse:      `🩹 Votre <strong>N° Matricule infirmier</strong> doit être enregistré par l'administrateur.`,
      lab:        `🧪 Votre <strong>N° Matricule de laboratoire</strong> doit être enregistré par l'administrateur.`,
      reception:  `🛎️ Votre <strong>N° Matricule d'agent d'accueil</strong> doit être enregistré par l'administrateur.`,
    };
    const labels = { doctor:'N° Ordre Médical *', pharmacist:'N° Matricule / RCCM *', nurse:'N° Matricule Infirmier *', lab:'N° Matricule Laboratoire *', reception:'N° Matricule Réception *' };
    const ids = { doctor:'rd-num', pharmacist:'rph-num', nurse:'rn-num', lab:'rl-num', reception:'rc-num' };
    const actions = { doctor:`Auth._regDoctor()`, pharmacist:`Auth._regPharmacist()`, nurse:`Auth._regNurse()`, lab:`Auth._regLab()`, reception:`Auth._regReception()` };

    document.getElementById('register-form').innerHTML = `
      <div class="auth-register-info">${infos[role]}</div>
      <div class="form-group">
        <label class="inp-lbl">${labels[role]}</label>
        <input type="text" id="${ids[role]}" class="inp" placeholder="Votre numéro officiel (tout format accepté)" style="text-transform:uppercase;font-family:monospace" oninput="this.value=this.value.toUpperCase()">
      </div>
      <div class="form-group">
        <label class="inp-lbl">Adresse email *</label>
        <input type="email" id="${ids[role]}-email" class="inp" placeholder="votre@email.com" required>
      </div>
      <div class="form-group">
        <label class="inp-lbl">Choisir un mot de passe * (min. 6 caractères)</label>
        <input type="password" id="${ids[role]}-pass" class="inp" placeholder="••••••" minlength="6">
      </div>
      <div class="form-group">
        <label class="inp-lbl">Confirmer le mot de passe *</label>
        <input type="password" id="${ids[role]}-pass2" class="inp" placeholder="••••••">
      </div>
      <button class="btn-p" onclick="${actions[role]}">✅ Envoyer la demande</button>

      <div class="auth-orientation-box">
        <p>🌍 <strong>Votre numéro n'est pas encore dans notre registre ?</strong></p>
        <p>Envoyez votre numéro officiel + une photo de votre carte professionnelle à :</p>
        <p>📞 WhatsApp : <strong>+243 856 373 707</strong></p>
        <p>✉️ Email : <strong>hallo.mediavision.tech@gmail.com</strong></p>
        <p style="color:var(--text-dim);font-size:.72rem;margin-top:.4rem">Délai de traitement : 24 à 48h ouvrables</p>
      </div>`;
  }

  /* ── OUTILS RESTAURATION ─────────────────────────── */
  function _hasFirebaseAuth() { return typeof firebaseAuth !== 'undefined' && !!firebaseAuth; }
  function _hasFirebaseDB() { return typeof firebaseDB !== 'undefined' && !!firebaseDB; }
  const _professionalField = role => role === 'doctor' ? 'order_num' : 'matricule';

  /* ── PARTIE B — PIN patient via Firebase Authentication ──
     Le patient ne saisit jamais d'email (aucun champ dans l'UI) : on
     dérive un email synthétique déterministe de son numéro de fiche
     public, uniquement pour réutiliser _createFirebaseUser/
     _signInFirebaseForAccount — exactement le même mécanisme déjà en
     place pour médecin/infirmier/pharmacien (email + mot de passe
     gérés par Firebase Auth, jamais stockés en clair dans
     mc_accounts). Firebase Auth exige un mot de passe d'au moins 6
     caractères ; un PIN plus court est complété par des zéros — ça ne
     renforce pas l'entropie du PIN lui-même, seulement une contrainte
     technique de l'API, à ne jamais présenter comme un renforcement
     de sécurité. */
  function _syntheticPatientEmail(patientId) {
    return `patient-${String(patientId).toLowerCase().replace(/[^a-z0-9]/g, '')}@patients.medconnect.internal`;
  }
  function _toFirebasePassword(pin) {
    return pin.length >= 6 ? pin : pin.padEnd(6, '0');
  }

  /* IMPORTANT : contrairement à _createFirebaseUser/_signInFirebaseForAccount
     (utilisées pour médecin/infirmier/pharmacien, dont le uid EST déjà
     l'uid Firebase généré à l'inscription), le compte patient garde un
     uid stable 'PAT_'+id — clé de document mc_accounts et référence
     utilisée partout dans l'app. Ces deux fonctions dédiées ne
     touchent donc JAMAIS account.uid, uniquement account.authUid. */
  async function _createPatientFirebaseAuth(email, pass, account) {
    if (!email || !_hasFirebaseAuth()) return account;
    try {
      const credential = await firebaseAuth.createUserWithEmailAndPassword(email, pass);
      return { ...account, authUid: credential?.user?.uid || null };
    } catch (err) {
      if (err?.code === 'auth/email-already-in-use') {
        // Le compte Firebase Auth existe déjà (migration réussie sur un
        // autre appareil, ou double-tentative sur celui-ci) : on se
        // connecte simplement pour récupérer l'authUid, sans le recréer.
        const signIn = await _signInPatientFirebaseAuth(email, pass);
        return signIn.ok ? { ...account, authUid: signIn.authUid } : account;
      }
      console.warn('[MedConnect] Création Firebase Auth patient impossible, poursuite en mode dégradé :', err);
      return account;
    }
  }

  async function _signInPatientFirebaseAuth(email, pass) {
    if (!_hasFirebaseAuth()) return { ok: false, authUid: null };
    try {
      const credential = await firebaseAuth.signInWithEmailAndPassword(email, pass);
      return { ok: true, authUid: credential?.user?.uid || null };
    } catch (e) {
      console.warn('[MedConnect] Connexion Firebase Auth patient impossible :', e);
      return { ok: false, authUid: null };
    }
  }

  /* ── Vérifie que le compte Firebase Auth a bien role:'admin'
     dans Firestore (users/{uid}). Sans ce document, isAdmin()
     refusera TOUTE écriture admin côté serveur — même connecté.
     Ce document ne peut PAS être créé en self-service (sécurité
     volontaire : 'admin' est exclu de publicUserRole côté règles).
     Il doit être ajouté manuellement, une seule fois, par le
     propriétaire du projet, dans Firebase Console > Firestore >
     users > {uid} > role: "admin", status: "approved". ──────── */
  async function _verifyAdminCloudRole(uid) {
    if (!uid || !_hasFirebaseDB()) return false;
    try {
      const doc = await firebaseDB.collection('users').doc(uid).get();
      return doc.exists && doc.data()?.role === 'admin';
    } catch (e) { console.warn('[MedConnect] Vérification rôle admin cloud :', e); return false; }
  }

  async function _syncBeforeAuth(label) {
    try { await DB.syncFromFirebase?.(); }
    catch (e) { console.warn(`[MedConnect] Sync avant ${label} impossible :`, e); }
  }

  /* ── Recherche cloud-first ciblée ────────────────────
     Décision explicite : plutôt que de dépendre uniquement de
     DB.syncFromFirebase() (télécharge des collections entières,
     lent, et peut échouer partiellement sans que rien ne le
     signale), on interroge directement le document précis
     recherché. Un ancien compte ne doit JAMAIS retomber sur un
     écran d'inscription — on cherche activement avant de conclure
     qu'il n'existe pas. Utilisé pour les 4 rôles : patient,
     médecin, pharmacien, infirmier.
  ──────────────────────────────────────────────────────── */
  async function _fetchAccountByDocId(docId) {
    if (!docId || !_hasFirebaseDB()) return null;
    try {
      const doc = await firebaseDB.collection('mc_accounts').doc(docId).get();
      return doc.exists ? doc.data() : null;
    } catch (e) { console.warn('[MedConnect] Recherche compte cloud (mc_accounts) impossible :', e); return null; }
  }

  async function _fetchAccountByField(collection, field, value) {
    if (!collection || !field || !value || !_hasFirebaseDB()) return null;
    try {
      const snap = await firebaseDB.collection(collection).where(field, '==', value).limit(1).get();
      return snap.empty ? null : snap.docs[0].data();
    } catch (e) { console.warn(`[MedConnect] Recherche compte cloud (${collection}) impossible :`, e); return null; }
  }

  function _mergeAccountLocally(account) {
    if (!account?.uid) return account;
    const accounts = DB.getAccounts();
    const idx = accounts.findIndex(a => a.uid === account.uid);
    if (idx === -1) accounts.push(account); else accounts[idx] = { ...accounts[idx], ...account };
    DB.saveAccounts(accounts);
    return account;
  }

  function _findPatientAccount(id) {
    return DB.getAccounts().find(a => a.role === 'patient' && String(a.patient_id || a.username || '').toUpperCase() === id) || null;
  }

  function _findProfessionalAccount(role, num) {
    const field = _professionalField(role);
    const n = String(num || '').toUpperCase();
    return DB.getAccounts().find(a =>
      a.role === role && String(a[field] || a.username || '').toUpperCase() === n
    ) || null;
  }

  function _upsertAccount(account) {
    if (!account?.uid) return account;
    const accounts = DB.getAccounts();
    const field = _professionalField(account.role);
    const idx = accounts.findIndex(a =>
      a.uid === account.uid ||
      (account.role === 'patient' && a.role === 'patient' && String(a.patient_id || a.username || '').toUpperCase() === String(account.patient_id || account.username || '').toUpperCase()) ||
      (a.role === account.role && String(a[field] || a.username || '').toUpperCase() === String(account[field] || account.username || '').toUpperCase())
    );
    if (idx === -1) accounts.push(account);
    else accounts[idx] = { ...accounts[idx], ...account };
    DB.saveAccounts(accounts);
    return account;
  }

  /* PARTIE M (sync) — la restauration n'est plus une option séparée :
     on cherche le compte cloud par numéro professionnel SEUL, puis on
     utilise l'email retrouvé (s'il existe) pour la session Firebase
     Auth en arrière-plan. L'utilisateur ne voit jamais de champ email. */
  /* ── PARTIE 1 : recherche Firestore-first ────────────
     Ordre imposé : collection de rôle (doctors/nurses/pharmacies)
     → users → mc_accounts. Ne décide rien, ne vérifie rien : se
     contente de trouver et normaliser le document. */
  async function resolveProfessionalAccountFromFirestore(role, professionalNumber) {
    if (!_hasFirebaseDB()) return null;
    const field   = _professionalField(role);
    const roleCol = { doctor:'doctors', nurse:'nurses', pharmacist:'pharmacies' }[role];
    const num     = String(professionalNumber || '').toUpperCase();
    let data = null, foundId = null;

    try {
      if (roleCol) {
        const snap = await firebaseDB.collection(roleCol).where(field, '==', num).limit(1).get();
        if (!snap.empty) { data = snap.docs[0].data(); foundId = snap.docs[0].id; }
      }
      if (!data) {
        const snap = await firebaseDB.collection('users').where('role', '==', role).where(field, '==', num).limit(1).get();
        if (!snap.empty) { data = snap.docs[0].data(); foundId = snap.docs[0].id; }
      }
      if (!data) {
        const snap = await firebaseDB.collection('mc_accounts').where('role', '==', role).where(field, '==', num).limit(1).get();
        if (!snap.empty) { data = snap.docs[0].data(); foundId = snap.docs[0].id; }
      }
    } catch (e) {
      console.warn('[MedConnect] resolveProfessionalAccountFromFirestore :', e);
    }
    if (!data) return null;

    const account = {
      ...data,
      uid:      data.uid || foundId,
      role:     data.role || role,
      username: data.username || data[field] || num,
      email:    data.email || '',
      status:   data.status || 'pending',
    };
    account[field] = account[field] || num;
    return account;
  }

  /* ── PARTIE 3 : écran détaillé "Demande refusée" ─────
     Même écran, que le rejet vienne d'un ancien compte, d'un
     nouveau compte, ou d'une tentative de réinscription. */
  function showRejectedAccountScreen(role, professionalNumber, account) {
    const scr = document.getElementById('auth-screen');
    if (!scr) return;
    scr.style.display = 'flex';
    scr.innerHTML = `
      <div class="auth-card" style="text-align:center;padding:2rem 1.5rem">
        <div style="font-size:3rem;color:var(--danger);margin-bottom:.5rem">❌</div>
        <h2 style="margin-bottom:.4rem">Demande refusée</h2>
        <p style="color:var(--text-muted);margin-bottom:1rem">
          ${esc(LABELS[role] || role)} · N° ${esc(professionalNumber || account?.username || '—')}
        </p>
        <p style="margin-bottom:1.25rem">
          Votre demande a été refusée. Contactez l'administration pour comprendre la raison
          ou fournir des informations complémentaires.
        </p>
        <a class="btn-p" style="display:inline-block;text-decoration:none;margin-bottom:.75rem"
           href="https://wa.me/243856373707" target="_blank" rel="noopener">📞 Contacter sur WhatsApp</a>
        <br>
        <button class="btn btn-ghost" onclick="Auth.showLogin()">← Retour à la connexion</button>
      </div>`;
  }

  /* ── PARTIE 2 : décision AVANT toute tentative Firebase Auth ──
     Ne renvoie true QUE si le compte est approved/active. Dans
     tous les autres cas, affiche le message/écran adapté et
     renvoie false — Firebase Auth n'est alors jamais sollicité. */
  function handleAccountStatusBeforeAuth(account, role, professionalNumber) {
    if (!account) {
      _err('auth-err', 'Compte introuvable ou non encore validé.');
      return false;
    }
    const status = String(account.status || '').toLowerCase();
    if (status === 'rejected') { showRejectedAccountScreen(role, professionalNumber, account); return false; }
    if (status === 'pending') { _err('auth-err', 'Votre demande est en attente de validation.'); return false; }
    if (status === 'suspended') { _err('auth-err', 'Compte suspendu. Contactez l\'administrateur.'); return false; }
    if (!['approved','active'].includes(status)) {
      _err('auth-err', 'Compte introuvable ou non encore validé.');
      return false;
    }
    return true;
  }

  /* ── _restoreProfessional : conservée pour compatibilité,
     ne fait plus double-emploi — délègue entièrement aux 3
     fonctions ci-dessus. Retourne un compte normalisé ou null,
     sans afficher elle-même de message contradictoire. */
  async function _restoreProfessional(role, num, pass) {
    const account = await resolveProfessionalAccountFromFirestore(role, num);
    if (!handleAccountStatusBeforeAuth(account, role, num)) return null;

    if (account.email && _hasFirebaseAuth()) {
      try {
        const credential = await firebaseAuth.signInWithEmailAndPassword(account.email, pass);
        if (credential?.user?.uid) account.authUid = credential.user.uid;
      } catch (e) {
        console.warn('[MedConnect] Vérification mot de passe Firebase Auth impossible :', e);
        _err('auth-err', 'Mot de passe incorrect.');
        return null;
      }
    } else if (account.password && account.password !== pass) {
      _err('auth-err', 'Mot de passe incorrect.');
      return null;
    }
    return _upsertAccount(account);
  }

  async function _signInFirebaseForAccount(account, pass, errorId = 'auth-err') {
    if (!account?.email) return true;
    if (!_hasFirebaseAuth()) {
      _err(errorId, '❌ Firebase Auth indisponible. Réessayez avec une connexion internet.');
      return false;
    }
    try {
      const credential = await firebaseAuth.signInWithEmailAndPassword(account.email, pass);
      if (credential?.user?.uid && account.uid !== credential.user.uid) {
        account.uid = credential.user.uid;
        account.authUid = credential.user.uid;
      }
      return true;
    } catch (e) {
      console.warn('[MedConnect] Connexion Firebase impossible :', e);
      _err(errorId, '❌ Connexion Firebase impossible. Vérifiez votre email/mot de passe.');
      return false;
    }
  }

  /* ── ACTIONS CONNEXION ────────────────────────────── */
  async function _doPatient() {
    const id  = (document.getElementById('lp-id')?.value  || '').trim().toUpperCase();
    const pin = (document.getElementById('lp-pin')?.value || '').trim();
    if (!id || !pin) { _err('auth-err', 'Veuillez remplir tous les champs.'); return; }
    if (!id.startsWith('MC-')) { _err('auth-err', '❌ Format invalide. Ex : MC-2026-CD-A3B7X9Q2'); return; }
    if (pin.length < 4) { _err('auth-err', '❌ PIN trop court — minimum 4 chiffres.'); return; }
    await _syncBeforeAuth('connexion patient');

    let patient = DB.getPatientById(id);
    if (!patient) {
      const cloudPatient = _hasFirebaseDB() ? await (async () => {
        try { const doc = await firebaseDB.collection('mc_patients').doc(id).get(); return doc.exists ? doc.data() : null; }
        catch (e) { console.warn('[MedConnect] Recherche fiche patient cloud impossible :', e); return null; }
      })() : null;
      if (cloudPatient) {
        const patients = DB.getPatients();
        if (!patients.find(p => p.id === id)) { patients.push(cloudPatient); DB.savePatients(patients); }
        patient = cloudPatient;
      }
    }
    if (!patient) { _err('auth-err', '❌ Numéro de fiche introuvable. Contactez votre médecin.'); return; }

    let existing = _findPatientAccount(id) || _mergeAccountLocally(await _fetchAccountByDocId(`PAT_${id}`));
    if (!existing) {
      _err('auth-err', '⚠️ Aucun compte trouvé pour cette fiche, ni localement ni dans le cloud.<br>Si c’est votre tout premier accès, utilisez “Premier accès : créer mon PIN”.');
      return;
    }

    // PARTIE B — plus de comparaison en clair. Compte déjà migré vers
    // Firebase Auth (email synthétique posé à la création ou lors
    // d'une migration précédente) : vérification via Firebase Auth
    // (_signInPatientFirebaseAuth, qui ne touche jamais uid — voir sa
    // définition — contrairement à _signInFirebaseForAccount conçue
    // pour des comptes dont uid EST déjà l'uid Firebase).
    if (existing.email && _hasFirebaseAuth()) {
      const { ok } = await _signInPatientFirebaseAuth(existing.email, _toFirebasePassword(pin));
      if (!ok) { _err('auth-err', '❌ PIN incorrect.'); return; }
    } else if (!existing.email && existing.password !== undefined) {
      // Compte hérité (créé avant ce chantier), PIN encore en clair.
      // Vérification UNE dernière fois avec l'ancien champ, puis
      // migration immédiate vers Firebase Auth : le champ password
      // n'est supprimé QUE si le compte Firebase Auth a bien été créé
      // (jamais de suppression qui laisserait le compte inaccessible).
      if (existing.password !== pin) { _err('auth-err', '❌ PIN incorrect.'); return; }
      const email = _syntheticPatientEmail(id);
      const migrated = await _createPatientFirebaseAuth(email, _toFirebasePassword(pin), { ...existing, email });
      if (migrated.authUid) {
        delete migrated.password;
        existing = migrated;
        // Remplacement (pas fusion) : _upsertAccount fait
        // {...ancien, ...nouveau}, ce qui NE supprime PAS password
        // (l'ancien objet le porte encore et le spread ne peut pas
        // "effacer" une clé absente du second objet). Il faut donc
        // remplacer l'entrée telle quelle dans le tableau de comptes.
        const accounts = DB.getAccounts();
        const idx = accounts.findIndex(a => a.uid === existing.uid);
        if (idx === -1) accounts.push(existing); else accounts[idx] = existing;
        DB.saveAccounts(accounts);
      }
      // Sinon (Firebase Auth injoignable maintenant) : le PIN vient
      // d'être vérifié avec succès, la connexion continue normalement ;
      // la migration réessaiera à la prochaine connexion réussie en ligne.
    } else {
      _err('auth-err', '❌ Connexion Firebase impossible. Réessayez avec une connexion internet.');
      return;
    }

    localStorage.setItem('mc_my_patient_id', id);
    _save(existing); _launch(existing);
  }

  async function _createPatientPin() {
    const id  = (document.getElementById('lp-id')?.value  || '').trim().toUpperCase();
    const pin = (document.getElementById('lp-pin')?.value || '').trim();
    const accessCode = (document.getElementById('lp-access-code')?.value || '').trim().toUpperCase();
    if (!id || !pin) { _err('auth-err', 'Veuillez remplir le numéro de fiche et le PIN.'); return; }
    if (!id.startsWith('MC-')) { _err('auth-err', '❌ Format invalide. Ex : MC-2026-CD-A3B7X9Q2'); return; }
    if (pin.length < 6) { _err('auth-err', '❌ PIN trop court — minimum 6 chiffres.'); return; }
    if (!accessCode) { _err('auth-err', "❌ Code d'accès requis — donné par l'hôpital à la création de votre fiche. Contactez votre médecin si vous ne l'avez pas."); return; }
    await _syncBeforeAuth('premier accès patient');
    const patient = DB.getPatientById(id);
    if (!patient) { _err('auth-err', '❌ Numéro de fiche introuvable. Contactez votre médecin.'); return; }
    const accounts = DB.getAccounts();
    const existing = _findPatientAccount(id);
    if (existing) {
      _err('auth-err', '⚠️ Un compte existe déjà pour cette fiche. Utilisez “Se connecter à mon dossier existant”.');
      return;
    }
    // PARTIE B — jamais de PIN en clair (ni de hash) dans mc_accounts,
    // collection en lecture publique : Firebase Auth gère le PIN comme
    // mot de passe côté serveur, exactement comme pour les
    // professionnels (voir _createFirebaseUser). mc_accounts ne reçoit
    // que l'email synthétique et l'authUid Firebase.
    // firstAccessCode : vérifié côté serveur (firestore.rules) contre
    // mc_patients/{id}.firstAccessCode — ferme la préemption de compte
    // par un tiers connaissant seulement le numéro de fiche (voir
    // rapport de sécurité). Reste ensuite tel quel sur ce document
    // (mc_accounts est public) : sans conséquence, la création est de
    // toute façon bloquée pour cette fiche une fois le compte créé
    // (!exists sur mc_accounts), donc le code redevient inutilisable.
    const email = _syntheticPatientEmail(id);
    const baseAcc = { uid:`PAT_${id}`, username:id, role:'patient', status:'approved', name:`${patient.firstname} ${patient.lastname}`, patient_id:id, email, firstAccessCode: accessCode, created_at:new Date().toISOString() };
    const acc = await _createPatientFirebaseAuth(email, _toFirebasePassword(pin), baseAcc);
    if (!acc.authUid) {
      // Correctif (revue de sécurité) : sans authUid, ce compte n'a
      // aucun secret nulle part (ni Firebase Auth réel, ni password/pin
      // local — PARTIE B) : le sauvegarder quand même le rendrait
      // inaccessible dès la prochaine tentative de connexion. On refuse
      // la création plutôt que de produire un compte fantôme.
      _err('auth-err', '❌ Création du compte impossible sans connexion internet. Réessayez plus tard.');
      return;
    }
    accounts.push(acc); DB.saveAccounts(accounts);
    // Confirmation cloud réelle (même principe qu'à l'inscription
    // professionnelle, voir _reg) : un code d'accès incorrect est
    // rejeté par la règle mc_accounts.create — indiscernable côté
    // client d'une simple coupure réseau, d'où le message couvrant les
    // deux cas plutôt que d'affirmer un diagnostic qu'on ne peut pas
    // établir ici.
    const criticalOk = DB.pushAndReport ? await DB.pushAndReport([['mc_accounts', acc.uid, acc]]) : false;
    if (!criticalOk) {
      _err('auth-err', "❌ Création refusée — vérifiez le code d'accès (donné par l'hôpital) et votre connexion internet.");
      return;
    }
    localStorage.setItem('mc_my_patient_id', id);
    _save(acc); _launch(acc);
    App.toast(`✅ Bienvenue ${patient.firstname} ! PIN créé.`);
  }

  async function _doProfessional(role, numId, passId, launcher = _launch) {
    const num  = (document.getElementById(numId)?.value  || '').trim().toUpperCase();
    const pass = (document.getElementById(passId)?.value || '').trim();
    if (!num || !pass) { _err('auth-err', 'Veuillez remplir tous les champs obligatoires.'); return; }

    // Firestore d'abord (source principale). localStorage n'intervient
    // qu'en repli si Firestore est indisponible (hors-ligne, etc.).
    let account = await resolveProfessionalAccountFromFirestore(role, num);
    let fromCache = false;
    if (!account) {
      account = _findProfessionalAccount(role, num);
      fromCache = !!account;
    }
    if (!account) { _err('auth-err', 'Compte introuvable ou non encore validé.'); return; }

    // Statut vérifié AVANT toute tentative Firebase Auth — un compte
    // pending/rejected/suspended ne doit jamais déclencher de message
    // technique Firebase.
    if (!handleAccountStatusBeforeAuth(account, role, num)) return;

    if (account.email && _hasFirebaseAuth()) {
      const ok = await _signInFirebaseForAccount(account, pass);
      if (!ok) return;
    } else if (account.password && account.password !== pass) {
      _err('auth-err', 'Mot de passe incorrect.');
      return;
    }

    if (!fromCache) _upsertAccount(account);
    _save(account); launcher(account);
  }

  function _doDoctor()     { return _doProfessional('doctor', 'ld-num', 'ld-pass', _launchDoctor); }
  function _doPharmacist() { return _doProfessional('pharmacist', 'lph-num', 'lph-pass', _launch); }
  function _doNurse()      { return _doProfessional('nurse', 'ln-num', 'ln-pass', _launch); }

  /* ── ACTIONS INSCRIPTION ──────────────────────────── */
  async function _createFirebaseUser(email, pass, account) {
    if (!email || typeof firebaseAuth === 'undefined' || !firebaseAuth) return account;
    try {
      const credential = await firebaseAuth.createUserWithEmailAndPassword(email, pass);
      const uid = credential?.user?.uid || account.uid;
      return { ...account, uid, authUid: uid };
    } catch (err) {
      if (err?.code === 'auth/email-already-in-use') {
        // Ne bloque jamais l'inscription : cas fréquent (email familial
        // partagé). Le compte reste identifié par son numéro
        // professionnel — la connexion se fait toujours par numéro
        // + mot de passe, jamais par email.
        console.warn('[MedConnect] Email déjà utilisé côté Firebase Auth — poursuite avec identifiant local.', err);
        return account;
      }
      console.warn('[MedConnect] Création Firebase Auth impossible, poursuite en mode dégradé :', err);
      return account;
    }
  }

  async function _reg(num, pass, pass2, role, extraField) {
    if (!num || !pass) { _err('reg-err', 'Veuillez remplir tous les champs.'); return false; }
    if (pass !== pass2) { _err('reg-err', '❌ Les mots de passe ne correspondent pas.'); return false; }
    if (pass.length < 6) { _err('reg-err', '❌ Mot de passe trop court (min. 6 caractères).'); return false; }
    await _syncBeforeAuth('inscription');

    const email = extraField?.email || '';
    if (Object.prototype.hasOwnProperty.call(extraField || {}, 'email') && !email) { _err('reg-err', '❌ Adresse email obligatoire.'); return false; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _err('reg-err', '❌ Adresse email invalide.'); return false; }

    const existing = _findProfessionalAccount(role, num) || DB.getUsers().find(u =>
      u.role === role && String(u.order_num || u.matricule || u.username || '').toUpperCase() === num
    );
    if (existing) {
      const status = String(existing.status || '').toLowerCase();
      if (status === 'pending') {
        _err('reg-err', '⏳ Une demande existe déjà avec ce numéro et attend la validation de l\'administrateur.');
      } else if (status === 'approved' || status === 'active') {
        _err('reg-err', '✅ Ce compte existe déjà et il est validé. Utilisez l\'onglet Connexion avec votre numéro et votre mot de passe.');
      } else if (status === 'rejected') {
        showRejectedAccountScreen(role, num, existing);
        return false;
      } else if (status === 'suspended') {
        _err('reg-err', '🚫 Ce compte existe déjà mais il est suspendu. Contactez l\'administrateur.');
      } else {
        _err('reg-err', '⚠️ Un compte existe déjà avec ce numéro. Utilisez l\'onglet Connexion.');
      }
      return false;
    }

    // Laboratoire / réception : aucun registre officiel équivalent à
    // celui des médecins/pharmaciens/infirmiers n'existe pour ces deux
    // rôles. Ne JAMAIS les faire passer par ACL.isNurseVerified() (leurs
    // numéros ne s'y trouvent jamais, ce qui bloquait systématiquement
    // l'inscription) : la demande est acceptée et reste 'pending'
    // jusqu'à validation manuelle par l'administrateur, comme pour une
    // demande dont le registre ne trouve pas de correspondance ailleurs.
    let verified, info;
    if (role === 'doctor') {
      verified = ACL.isDoctorVerified(num);
      info = ACL.getVerifiedDoctors().find(d => d.order_num === num);
    } else if (role === 'pharmacist') {
      verified = ACL.isPharmacistVerified(num);
      info = ACL.getVerifiedPharmacists().find(p => p.matricule === num);
    } else if (role === 'nurse') {
      verified = ACL.isNurseVerified(num);
      info = ACL.getVerifiedNurses().find(n => n.matricule === num);
    } else if (role === 'lab' || role === 'reception') {
      verified = true;
      info = null;
    } else {
      verified = false;
      info = null;
    }
    if (!verified) {
      _err('reg-err', `❌ Numéro non reconnu dans le registre.\nContactez l'administrateur : +243 856 373 707\nou hallo.mediavision.tech@gmail.com`);
      return false;
    }
    const acc = { uid:`${role.slice(0,3).toUpperCase()}_${num}_${Date.now()}`, username:num, role, name:info?.name || `${LABELS[role]} (${num})`, email, status:'pending', created_at:new Date().toISOString(), ...extraField };
    if (info?.specialty) acc.specialty = info.specialty;
    if (info?.country)   acc.country   = info.country;
    if (info?.pharmacy)  acc.pharmacy  = info.pharmacy;
    if (info?.hospital)  acc.hospital  = info.hospital;

    const finalAccount = await _createFirebaseUser(email, pass, acc);
    if (!finalAccount) return false;

    // Écriture locale immédiate (cache, hors-ligne) — comme avant.
    const accounts = DB.getAccounts();
    accounts.push(finalAccount);
    DB.saveAccounts(accounts);
    const regRequest = DB.createRegistrationRequest?.(finalAccount);
    const roleCol = { doctor:'doctors', pharmacist:'pharmacies', nurse:'nurses' }[role];

    // Confirmation cloud réelle (Étape 5) : on n'affiche "Demande
    // envoyée" que si les écritures critiques ont bien atteint
    // Firestore — mc_accounts, registration_requests, users, et la
    // collection de rôle publique (doctors/nurses/pharmacies).
    const criticalWrites = [
      ['mc_accounts', finalAccount.uid, finalAccount],
    ];
    if (regRequest) criticalWrites.push(['registration_requests', regRequest.requestId, regRequest]);

    const secondaryWrites = [['users', finalAccount.uid, finalAccount]];
    if (roleCol) secondaryWrites.push([roleCol, finalAccount.uid, finalAccount]);

    const criticalOk = DB.pushAndReport ? await DB.pushAndReport(criticalWrites) : false;
    if (!criticalOk) {
      _err('reg-err', 'Demande enregistrée localement, mais synchronisation cloud non confirmée. Vérifiez la connexion puis réessayez.');
      return 'local-only';
    }
    // Écritures secondaires (users, collection de rôle) : peuvent échouer
    // sans session Firebase Auth réelle (email déjà pris, hors-ligne...).
    // La demande est déjà visible côté admin via mc_accounts/
    // registration_requests — on ne bloque plus l'utilisateur pour ça.
    if (DB.pushAndReport) await DB.pushAndReport(secondaryWrites);
    return true;
  }

  async function _regDoctor() {
    const num   = (document.getElementById('rd-num')?.value || '').trim().toUpperCase();
    const email = (document.getElementById('rd-num-email')?.value || '').trim();
    const pass  = (document.getElementById('rd-num-pass')?.value || '').trim();
    const pass2 = (document.getElementById('rd-num-pass2')?.value || '').trim();
    const result = await _reg(num, pass, pass2, 'doctor', { order_num:num, email });
    if (result !== true) return;
    _showPending();
  }

  async function _regPharmacist() {
    const num   = (document.getElementById('rph-num')?.value || '').trim().toUpperCase();
    const email = (document.getElementById('rph-num-email')?.value || '').trim();
    const pass  = (document.getElementById('rph-num-pass')?.value || '').trim();
    const pass2 = (document.getElementById('rph-num-pass2')?.value || '').trim();
    const result = await _reg(num, pass, pass2, 'pharmacist', { matricule:num, email });
    if (result !== true) return;
    _showPending();
  }

  async function _regNurse() {
    const num   = (document.getElementById('rn-num')?.value || '').trim().toUpperCase();
    const email = (document.getElementById('rn-num-email')?.value || '').trim();
    const pass  = (document.getElementById('rn-num-pass')?.value || '').trim();
    const pass2 = (document.getElementById('rn-num-pass2')?.value || '').trim();
    const result = await _reg(num, pass, pass2, 'nurse', { matricule:num, email });
    if (result !== true) return;
    _showPending();
  }

  async function _regLab() {
    const num   = (document.getElementById('rl-num')?.value || '').trim().toUpperCase();
    const email = (document.getElementById('rl-num-email')?.value || '').trim();
    const pass  = (document.getElementById('rl-num-pass')?.value || '').trim();
    const pass2 = (document.getElementById('rl-num-pass2')?.value || '').trim();
    const result = await _reg(num, pass, pass2, 'lab', { matricule:num, email });
    if (result !== true) return;
    _showPending();
  }

  async function _regReception() {
    const num   = (document.getElementById('rc-num')?.value || '').trim().toUpperCase();
    const email = (document.getElementById('rc-num-email')?.value || '').trim();
    const pass  = (document.getElementById('rc-num-pass')?.value || '').trim();
    const pass2 = (document.getElementById('rc-num-pass2')?.value || '').trim();
    const result = await _reg(num, pass, pass2, 'reception', { matricule:num, email });
    if (result !== true) return;
    _showPending();
  }

  function _showPending() {
    document.getElementById('register-form').innerHTML = `
      <div style="text-align:center;padding:1.5rem 1rem">
        <div style="font-size:2.5rem;margin-bottom:.75rem">📤</div>
        <h3 style="color:var(--secondary);margin-bottom:.5rem">Demande envoyée !</h3>
        <p style="font-size:.85rem;color:var(--text-muted);line-height:1.6">
          Votre demande est en cours de validation par l'administrateur.
          Vous recevrez une notification dès l'approbation de votre compte.
          <br><br>Votre demande a été reçue. Veuillez patienter pendant la vérification de vos informations.
        </p>
        <p style="font-size:.8rem;color:var(--text-muted);margin-top:.75rem">📞 +243 856 373 707</p>
        <button class="btn-p" style="margin-top:1rem" onclick="Auth._tab('login')">← Retour à la connexion</button>
      </div>`;
    document.getElementById('reg-err').style.display = 'none';
  }

  /* ── ADMIN MODAL (5 clics logo) ───────────────────── */
  function _adminModal() {
    App.openModal('⚙️ Accès Administrateur', `
      <div class="auth-register-info">Connexion réservée aux comptes administrateur enregistrés dans Firestore.</div>
      <form onsubmit="Auth._doAdmin(event)">
        <div class="form-group"><label class="inp-lbl">Email administrateur</label><input type="email" id="adm-u" class="inp" autocomplete="email" required></div>
        <div class="form-group"><label class="inp-lbl">Mot de passe</label><input type="password" id="adm-p" class="inp" autocomplete="current-password" required></div>
        <div id="adm-err" class="auth-error" style="display:none"></div>
        <div class="form-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Se connecter</button></div>
      </form>`);
  }

  /* ── ADMIN : accès cloud uniquement ──────────────────
     Décision explicite (sécurité) : plus de filet de secours
     local ni de configuration locale d'admin. L'accès admin
     exige un email Firebase Auth valide ET un document
     users/{uid}.role == "admin" dans Firestore, vérifié à chaque
     connexion via _verifyAdminCloudRole(). Le document users/{uid}
     doit être créé manuellement dans Firebase Console (aucune
     auto-promotion possible en self-service).
  ──────────────────────────────────────────────────────── */
  async function _setupAdmin(e) {
    e.preventDefault?.();
    App.closeModal?.();
    _adminModal();
  }

  async function _doAdmin(e) {
    e.preventDefault();
    const email = (document.getElementById('adm-u')?.value || '').trim();
    const pass  = (document.getElementById('adm-p')?.value || '').trim();
    const el    = document.getElementById('adm-err');
    const showAdminError = msg => { if (el) { el.textContent = msg; el.style.display = 'block'; } };

    if (!email || !pass) { showAdminError('Veuillez remplir l\'email et le mot de passe administrateur.'); return; }
    if (!_hasFirebaseAuth() || !_hasFirebaseDB()) { showAdminError('❌ Firebase indisponible. Vérifiez la connexion internet puis réessayez.'); return; }

    try {
      // Nettoie une éventuelle session Firebase résiduelle (ex. un agent
      // hôpital connecté juste avant sur le même navigateur) pour éviter
      // que les règles Firestore voient la mauvaise identité.
      if (firebaseAuth.currentUser) { try { await firebaseAuth.signOut(); } catch (_) {} }

      const credential = await firebaseAuth.signInWithEmailAndPassword(email, pass);
      const uid = credential?.user?.uid;
      if (!uid) throw new Error('admin_uid_missing');

      const doc = await firebaseDB.collection('users').doc(uid).get();
      if (!doc.exists) { showAdminError('❌ Profil administrateur introuvable dans Firestore.'); return; }

      const profile = doc.data() || {};
      const status  = String(profile.status || '').toLowerCase();
      if (profile.role !== 'admin') { showAdminError('❌ Ce compte n\'a pas le rôle administrateur.'); return; }
      if (!['active','approved'].includes(status)) { showAdminError('🚫 Compte administrateur non actif.'); return; }

      const session = {
        ...profile, uid, authUid: uid, email, role: 'admin',
        name: profile.name || profile.displayName || 'Administrateur',
        cloudSynced: true,
      };
      App.closeModal(); _save(session);
      document.getElementById('auth-screen').style.display = 'none';
      App.afterLogin(getUser());
      App.toast('✅ Administrateur connecté — synchronisé avec Firestore.');
    } catch (error) {
      console.warn('[MedConnect] Connexion administrateur cloud impossible :', error);
      showAdminError('❌ Connexion administrateur impossible. Vérifiez email, mot de passe et droits Firestore.');
    }
  }

  function _launch(acc) {
    const scr = document.getElementById('auth-screen');
    if (scr) scr.style.display = 'none';
    App.afterLogin(acc);
  }

  function _launchDoctor(acc) {
    if (window.HospitalsRegistry) {
      const hosps = HospitalsRegistry.getDoctorHospitals(acc.uid);
      if (hosps.length > 0 && !HospitalsRegistry.getCurrentHospital()) sessionStorage.setItem('mc_current_hospital', hosps[0].hid);
    }
    _launch(acc);
  }

  function _err(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = String(msg || '').replace(/\n/g, '<br>');
    el.style.display = msg ? 'block' : 'none';
  }

  function getRoleIcon(r)  { return ICONS[r]  || '👤'; }
  function getRoleLabel(r) { return LABELS[r] || r; }

  /* Authentifie un professionnel SANS démarrer le shell mobile.
     Utilisé par la connexion agent desktop : retourne le compte
     (avec uid Firebase réel) ou null. Gère aussi lab/reception,
     qui n'ont pas de registre dédié : on résout alors via users/
     mc_accounts par matricule + rôle. */
  async function loginProfessionalSilently(role, num, pass) {
    try {
      // doctor/nurse/pharmacist : chemin existant (registres + auth).
      if (['doctor', 'nurse', 'pharmacist'].includes(role)) {
        return await _restoreProfessional(role, num, pass);
      }
      // lab/reception : résolution directe par users/mc_accounts.
      if (!_hasFirebaseDB()) return null;
      const N = String(num || '').toUpperCase();
      let data = null;
      for (const col of ['users', 'mc_accounts']) {
        for (const field of ['matricule', 'order_num', 'username']) {
          const snap = await firebaseDB.collection(col)
            .where('role', '==', role).where(field, '==', N).limit(1).get();
          if (!snap.empty) { data = { id: snap.docs[0].id, ...snap.docs[0].data() }; break; }
        }
        if (data) break;
      }
      if (!data) return null;
      if (data.email && _hasFirebaseAuth()) {
        const cred = await firebaseAuth.signInWithEmailAndPassword(data.email, pass);
        data.uid = cred?.user?.uid || data.uid;
        data.authUid = data.uid;
      } else if (data.password && data.password !== pass) {
        return null;
      }
      return _upsertAccount(data);
    } catch (e) {
      console.warn('[MedConnect] loginProfessionalSilently :', e?.code || e?.message);
      return null;
    }
  }

  return {
    getUser, isLogged, logout, showLogin, loginProfessionalSilently,
    _tab, _loginRole, _registerRole,
    _doPatient, _createPatientPin, _doDoctor, _doPharmacist, _doNurse,
    _regDoctor, _regPharmacist, _regNurse, _regLab, _regReception,
    _setupAdmin, _doAdmin,
    getRoleIcon, getRoleLabel,
  };
})();

window.Auth = Auth;
