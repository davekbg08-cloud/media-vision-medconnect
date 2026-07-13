/* =====================================================
   MedConnect — Professional Registration Submit Flow
   Objectif : un seul bouton = créer Auth + envoyer demande admin
   ===================================================== */
(function () {
  if (!window.Auth) return;

  const ROLE_META = {
    doctor: {
      icon: '👨‍⚕️',
      label: 'Médecin',
      numberLabel: 'N° Ordre Médical *',
      numberField: 'order_num',
      collection: 'doctors',
      info: "Soumettez votre N° d'Ordre Médical. L’administrateur vérifiera votre demande avant activation.",
      idPrefix: 'rd-num',
    },
    pharmacist: {
      icon: '💊',
      label: 'Pharmacien',
      numberLabel: 'N° Matricule / RCCM *',
      numberField: 'matricule',
      collection: 'pharmacies',
      info: 'Soumettez votre N° Matricule / RCCM. L’administrateur vérifiera votre demande avant activation.',
      idPrefix: 'rph-num',
    },
    nurse: {
      icon: '🩹',
      label: 'Infirmier(e)',
      numberLabel: 'N° Matricule Infirmier *',
      numberField: 'matricule',
      collection: 'nurses',
      info: 'Soumettez votre N° Matricule infirmier. L’administrateur vérifiera votre demande avant activation.',
      idPrefix: 'rn-num',
    },
  };

  const esc = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const now = () => new Date().toISOString();

  function hasFirebaseAuth() {
    return typeof firebaseAuth !== 'undefined' && !!firebaseAuth;
  }

  function hasFirestore() {
    return typeof firebaseDB !== 'undefined' && !!firebaseDB;
  }

  function showError(message) {
    const el = document.getElementById('reg-err');
    if (!el) return;
    el.innerHTML = String(message || '').replace(/\n/g, '<br>');
    el.style.display = message ? 'block' : 'none';
  }

  function setSubmitting(isSubmitting) {
    const btn = document.getElementById('submit-registration-btn');
    if (!btn) return;
    btn.disabled = !!isSubmitting;
    btn.innerHTML = isSubmitting ? '⏳ Envoi de la demande...' : '✅ Soumettre la demande d’inscription';
  }

  function roleRegistryInfo(role, number) {
    try {
      if (!window.ACL) return { verified: false, data: null };
      const n = String(number || '').toUpperCase();
      if (role === 'doctor') {
        const data = ACL.getVerifiedDoctors?.().find(d => String(d.order_num || '').toUpperCase() === n) || null;
        return { verified: !!data, data };
      }
      if (role === 'pharmacist') {
        const data = ACL.getVerifiedPharmacists?.().find(p => String(p.matricule || '').toUpperCase() === n) || null;
        return { verified: !!data, data };
      }
      if (role === 'nurse') {
        const data = ACL.getVerifiedNurses?.().find(x => String(x.matricule || '').toUpperCase() === n) || null;
        return { verified: !!data, data };
      }
    } catch (e) {
      console.warn('[MedConnect] Vérification registre ignorée :', e);
    }
    return { verified: false, data: null };
  }

  function professionalNumberOf(item, role) {
    const field = role === 'doctor' ? 'order_num' : 'matricule';
    return String(item?.professionalNumber || item?.[field] || item?.username || '').toUpperCase();
  }

  function findLocalDuplicate(role, number, email) {
    const n = String(number || '').toUpperCase();
    const e = String(email || '').toLowerCase();
    const accounts = DB?.getAccounts?.() || [];
    const users = DB?.getUsers?.() || [];
    const requests = DB?.getRegistrationRequests?.() || [];

    const account = [...accounts, ...users].find(item =>
      item.role === role &&
      (
        professionalNumberOf(item, role) === n ||
        (e && String(item.email || '').toLowerCase() === e)
      )
    );
    if (account) return account;

    return requests.find(req =>
      (req.role === role || req.requesterRole === role) &&
      (
        String(req.professionalNumber || '').toUpperCase() === n ||
        (e && String(req.email || '').toLowerCase() === e)
      )
    ) || null;
  }

  async function firestoreDocExists(collection, docId) {
    if (!hasFirestore() || !docId) return false;
    const snap = await firebaseDB.collection(collection).doc(String(docId)).get();
    return snap.exists;
  }

  async function writeRegistrationToFirestore({ uid, role, number, email, registry }) {
    const meta = ROLE_META[role];
    const requestId = `REG_${uid}_${Date.now()}`;
    const fullName = registry.data?.name || `${meta.label} (${number})`;
    const createdAt = now();

    const account = {
      uid,
      authUid: uid,
      username: number,
      role,
      name: fullName,
      fullName,
      email,
      status: 'pending',
      professionalNumber: number,
      registryVerified: registry.verified,
      created_at: createdAt,
      createdAt,
      updatedAt: createdAt,
    };

    account[meta.numberField] = number;
    if (registry.data?.specialty) account.specialty = registry.data.specialty;
    if (registry.data?.country) account.country = registry.data.country;
    if (registry.data?.pharmacy) account.pharmacy = registry.data.pharmacy;
    if (registry.data?.hospital) account.hospital = registry.data.hospital;

    const userProfile = { ...account };
    delete userProfile.password;
    delete userProfile.passwordHash;

    const request = {
      requestId,
      requesterUid: uid,
      fullName,
      requesterName: fullName,
      email,
      role,
      requesterRole: role,
      professionalNumber: number,
      status: 'pending',
      registryVerified: registry.verified,
      submittedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: '',
    };

    const batch = firebaseDB.batch();
    batch.set(firebaseDB.collection('users').doc(uid), userProfile, { merge: true });
    batch.set(firebaseDB.collection(meta.collection).doc(uid), userProfile, { merge: true });
    batch.set(firebaseDB.collection('mc_accounts').doc(uid), userProfile, { merge: true });
    batch.set(firebaseDB.collection('registration_requests').doc(requestId), request, { merge: true });
    await batch.commit();

    try {
      const accounts = DB.getAccounts?.() || [];
      const nextAccounts = accounts.filter(a => a.uid !== uid);
      nextAccounts.push(userProfile);
      DB.saveAccounts?.(nextAccounts);

      const requests = DB.getRegistrationRequests?.() || [];
      const nextRequests = requests.filter(r => r.requestId !== requestId);
      nextRequests.push(request);
      DB.saveRegistrationRequests?.(nextRequests);
    } catch (e) {
      console.warn('[MedConnect] Cache inscription non mis à jour :', e);
    }

    return { account: userProfile, request };
  }

  function renderStatusScreen(status, role, details = {}) {
    const form = document.getElementById('register-form');
    if (!form) return;

    const meta = ROLE_META[role] || { label: 'Utilisateur', icon: '👤' };
    const name = details.fullName || details.name || details.requesterName || `${meta.label}${details.professionalNumber ? ` (${details.professionalNumber})` : ''}`;
    const statusText = String(status || '').toLowerCase();

    const configs = {
      pending: {
        icon: '⏳',
        title: 'Demande en attente de validation',
        color: 'var(--accent)',
        body: 'Votre demande est déjà enregistrée. Elle sera examinée par l’administrateur. Vous ne devez pas la renvoyer plusieurs fois.',
        mainButton: '<button class="btn-p" disabled style="opacity:.7;cursor:not-allowed">⏳ Demande en attente</button>',
        secondButton: '<button class="btn btn-ghost" style="width:100%;margin-top:.65rem" onclick="Auth._tab(\'login\')">🔐 Aller à la connexion</button>',
      },
      approved: {
        icon: '✅',
        title: 'Compte validé',
        color: 'var(--secondary)',
        body: 'Votre compte est validé. Vous pouvez maintenant vous connecter avec votre numéro professionnel, votre email et votre mot de passe.',
        mainButton: '<button class="btn-p" onclick="Auth._tab(\'login\')">🔐 Se connecter</button>',
        secondButton: '',
      },
      active: {
        icon: '✅',
        title: 'Compte actif',
        color: 'var(--secondary)',
        body: 'Votre compte est actif. Vous pouvez vous connecter.',
        mainButton: '<button class="btn-p" onclick="Auth._tab(\'login\')">🔐 Se connecter</button>',
        secondButton: '',
      },
      rejected: {
        icon: '❌',
        title: 'Demande refusée',
        color: 'var(--danger)',
        body: 'Votre demande a été refusée. Contactez l’administration pour comprendre la raison ou fournir des informations complémentaires.',
        mainButton: '<button class="btn-p" onclick="Auth._tab(\'login\')">← Retour à la connexion</button>',
        secondButton: '',
      },
      suspended: {
        icon: '🚫',
        title: 'Compte suspendu',
        color: 'var(--danger)',
        body: 'Votre compte est suspendu. Contactez l’administration.',
        mainButton: '<button class="btn-p" onclick="Auth._tab(\'login\')">← Retour à la connexion</button>',
        secondButton: '',
      },
    };

    const cfg = configs[statusText] || configs.pending;

    form.innerHTML = `
      <div style="text-align:center;padding:1.5rem 1rem">
        <div style="font-size:2.7rem;margin-bottom:.75rem">${cfg.icon}</div>
        <h3 style="color:${cfg.color};margin-bottom:.5rem">${cfg.title}</h3>
        <p style="font-size:.85rem;color:var(--text-muted);line-height:1.6">
          <strong>${esc(name)}</strong><br>
          ${cfg.body}
        </p>
        <p style="font-size:.8rem;color:var(--text-muted);margin-top:.75rem">📞 +243 856 373 707</p>
        <div style="margin-top:1rem">${cfg.mainButton}${cfg.secondButton}</div>
      </div>`;
    showError('');
  }

  function showPendingConfirmation(account = {}) {
    renderStatusScreen('pending', account.role || 'nurse', account);
  }

  async function submitRegistration(role) {
    const meta = ROLE_META[role];
    if (!meta) return;

    const number = (document.getElementById(meta.idPrefix)?.value || '').trim().toUpperCase();
    const email = (document.getElementById(`${meta.idPrefix}-email`)?.value || '').trim().toLowerCase();
    const pass = (document.getElementById(`${meta.idPrefix}-pass`)?.value || '').trim();
    const pass2 = (document.getElementById(`${meta.idPrefix}-pass2`)?.value || '').trim();

    showError('');

    if (!number || !email || !pass || !pass2) {
      showError('Veuillez remplir tous les champs obligatoires.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('❌ Adresse email invalide.');
      return;
    }
    if (pass.length < 6) {
      showError('❌ Mot de passe trop court : minimum 6 caractères.');
      return;
    }
    if (pass !== pass2) {
      showError('❌ Les mots de passe ne correspondent pas.');
      return;
    }
    if (!hasFirebaseAuth() || !hasFirestore()) {
      showError('❌ Firebase indisponible. Vérifiez la connexion internet puis réessayez.');
      return;
    }

    const duplicate = findLocalDuplicate(role, number, email);
    if (duplicate?.status) {
      renderStatusScreen(duplicate.status, role, {
        ...duplicate,
        professionalNumber: duplicate.professionalNumber || number,
        email: duplicate.email || email,
      });
      return;
    }

    setSubmitting(true);
    // Déclaré hors du try suivant (pas seulement à l'intérieur) pour
    // rester visible dans le catch englobant ci-dessous — correctif
    // de nettoyage du compte Firebase Auth orphelin.
    let credential;

    try {
      try {
        credential = await firebaseAuth.createUserWithEmailAndPassword(email, pass);
      } catch (err) {
        if (err?.code === 'auth/email-already-in-use') {
          const possibleExisting = findLocalDuplicate(role, number, email);
          if (possibleExisting?.status) {
            renderStatusScreen(possibleExisting.status, role, possibleExisting);
          } else {
            showError('❌ Cette adresse email est déjà utilisée. Utilisez l’onglet Connexion pour restaurer le compte existant.');
          }
          return;
        }
        throw err;
      }

      const uid = credential?.user?.uid;
      if (!uid) throw new Error('uid_missing');

      if (await firestoreDocExists('users', uid)) {
        renderStatusScreen('approved', role, { professionalNumber: number, email });
        return;
      }

      const registry = roleRegistryInfo(role, number);
      const result = await writeRegistrationToFirestore({ uid, role, number, email, registry });
      await firebaseAuth.signOut().catch(() => {});
      sessionStorage.removeItem('mc_user');
      showPendingConfirmation(result.account);
      App?.toast?.('✅ Votre demande a été envoyée. Elle sera examinée par l’administrateur.');
    } catch (err) {
      console.error('[MedConnect] Envoi demande inscription impossible :', err);
      // Correctif (audit) : sans ce nettoyage, un échec après la
      // création réussie du compte Firebase Auth (writeRegistrationToFirestore
      // — pas de file de réessai ici, contrairement à Auth._reg) laissait
      // l'identité orpheline indéfiniment. Toute nouvelle tentative avec
      // le même email tombait ensuite sur auth/email-already-in-use alors
      // qu'aucune demande n'existait réellement côté serveur — le
      // candidat restait verrouillé sans recours.
      if (credential?.user) {
        try { await credential.user.delete(); }
        catch (e) { console.warn('[MedConnect] Nettoyage compte Firebase après échec inscription :', e); }
      }
      showError(`❌ Impossible d’envoyer la demande : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setSubmitting(false);
    }
  }

  // Conserve l'implémentation d'origine (auth.js) pour les rôles que ce
  // patch ne gère pas dans ROLE_META (lab, reception…). Sans ça, cliquer
  // sur Laboratoire/Réception ne faisait RIEN (return silencieux) car
  // le patch écrasait _registerRole pour tous les rôles.
  const _originalRegisterRole = Auth._registerRole;

  Auth._registerRole = function patchedRegisterRole(role) {
    const meta = ROLE_META[role];
    if (!meta) {
      // Rôle non géré ici (lab, reception…) → comportement d'origine.
      return typeof _originalRegisterRole === 'function'
        ? _originalRegisterRole.call(Auth, role)
        : undefined;
    }

    document.querySelectorAll('#register-roles .role-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.role === role));
    showError('');

    const form = document.getElementById('register-form');
    if (!form) return;

    form.innerHTML = `
      <div class="auth-register-info">${meta.icon} ${meta.info}</div>
      <div class="form-group">
        <label class="inp-lbl">${meta.numberLabel}</label>
        <input type="text" id="${meta.idPrefix}" class="inp" placeholder="Votre numéro officiel" style="text-transform:uppercase;font-family:monospace" oninput="this.value=this.value.toUpperCase()">
      </div>
      <div class="form-group">
        <label class="inp-lbl">Adresse email *</label>
        <input type="email" id="${meta.idPrefix}-email" class="inp" placeholder="votre@email.com" required>
      </div>
      <div class="form-group">
        <label class="inp-lbl">Choisir un mot de passe * (min. 6 caractères)</label>
        <input type="password" id="${meta.idPrefix}-pass" class="inp" placeholder="••••••" minlength="6">
      </div>
      <div class="form-group">
        <label class="inp-lbl">Confirmer le mot de passe *</label>
        <input type="password" id="${meta.idPrefix}-pass2" class="inp" placeholder="••••••">
      </div>
      <button id="submit-registration-btn" class="btn-p" onclick="Auth._submitRegistration('${role}')">
        ✅ Soumettre la demande d’inscription
      </button>

      <div class="auth-orientation-box">
        <p>🌍 <strong>Votre numéro n'est pas encore dans notre registre ?</strong></p>
        <p>Soumettez quand même votre demande. L’administrateur vérifiera vos informations avant activation.</p>
        <p>Pour accélérer la validation, envoyez votre numéro officiel + une photo de votre carte professionnelle à :</p>
        <p>📞 WhatsApp : <strong>+243 856 373 707</strong></p>
        <p>✉️ Email : <strong>hallo.mediavision.tech@gmail.com</strong></p>
        <p style="color:var(--text-dim);font-size:.72rem;margin-top:.4rem">Délai indicatif : 24 à 48h ouvrables</p>
      </div>`;
  };

  Auth._submitRegistration = submitRegistration;
})();
