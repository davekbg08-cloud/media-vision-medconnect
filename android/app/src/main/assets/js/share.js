// ========== MedConnect — Sharing & Interaction Module ==========
// Permet le partage d'ordonnances et d'infos entre Docteur ↔ Patient ↔ Pharmacien

window.ShareModule = (() => {

  // ===== Generate unique prescription code =====
  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'RX-';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ===== Doctor: Create shared prescription =====
  async function createPrescription(patientId, consultationData) {
    const patient = await MedDB.dbGet('patients', patientId);
    if (!patient) return null;

    const prescription = {
      code: generateCode(),
      patientId: patientId,
      patientNom: `${patient.prenom} ${patient.nom}`,
      patientTel: patient.telephone || '',
      docteur: consultationData.docteur,
      date: consultationData.date,
      diagnostic: consultationData.diagnostic,
      traitement: consultationData.traitement,
      notes: consultationData.notes || '',
      statut: 'active', // active, dispensée, expirée
      dispensedAt: null,
      dispensedBy: null,
    };

    // Store in consultations with code
    consultationData.prescriptionCode = prescription.code;

    // Store prescription in a dedicated area in localStorage (lightweight sharing)
    const prescriptions = JSON.parse(localStorage.getItem('medconnect_prescriptions') || '[]');
    prescriptions.push(prescription);
    localStorage.setItem('medconnect_prescriptions', JSON.stringify(prescriptions));

    return prescription;
  }

  // ===== Get all prescriptions =====
  function getAllPrescriptions() {
    return JSON.parse(localStorage.getItem('medconnect_prescriptions') || '[]');
  }

  // ===== Look up prescription by code =====
  function findByCode(code) {
    const all = getAllPrescriptions();
    return all.find(p => p.code === code.toUpperCase().trim());
  }

  // ===== Patient: Get my prescriptions =====
  function getPatientPrescriptions(patientId) {
    return getAllPrescriptions().filter(p => p.patientId === patientId);
  }

  // ===== Pharmacist: Dispense prescription =====
  function dispensePrescription(code, pharmacyName) {
    const all = getAllPrescriptions();
    const idx = all.findIndex(p => p.code === code);
    if (idx === -1) return null;

    all[idx].statut = 'dispensée';
    all[idx].dispensedAt = new Date().toISOString();
    all[idx].dispensedBy = pharmacyName || 'Pharmacie';
    localStorage.setItem('medconnect_prescriptions', JSON.stringify(all));
    return all[idx];
  }

  // ===== Print / Export prescription as PDF =====
  function printPrescription(prescription) {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Ordonnance ${prescription.code}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 2rem; color: #1e293b; line-height: 1.6; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0EA5E9; padding-bottom: 1rem; margin-bottom: 1.5rem; }
          .logo { font-size: 1.5rem; font-weight: 700; color: #0EA5E9; }
          .logo small { display: block; font-size: 0.75rem; color: #64748b; font-weight: 400; }
          .rx-code { text-align: right; }
          .rx-code .code { font-size: 1.3rem; font-weight: 700; color: #0EA5E9; letter-spacing: 2px; font-family: monospace; }
          .rx-code .date { font-size: 0.85rem; color: #64748b; }
          .section { margin-bottom: 1.5rem; }
          .section-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 0.4rem; font-weight: 600; }
          .patient-info { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 2rem; background: #f8fafc; padding: 1rem; border-radius: 8px; border: 1px solid #e2e8f0; }
          .patient-info .label { font-size: 0.75rem; color: #94a3b8; }
          .patient-info .value { font-weight: 600; }
          .prescription-box { background: #f0f9ff; border: 2px solid #0EA5E9; border-radius: 8px; padding: 1.5rem; }
          .prescription-box h3 { color: #0EA5E9; margin-bottom: 0.75rem; font-size: 1rem; }
          .prescription-box .treatment { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
          .diagnostic { background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
          .notes { font-style: italic; color: #64748b; font-size: 0.9rem; margin-top: 0.5rem; }
          .footer { margin-top: 3rem; display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
          .signature { text-align: center; }
          .signature .line { width: 200px; border-bottom: 1px solid #1e293b; margin-bottom: 0.3rem; height: 40px; }
          .stamp { font-size: 0.7rem; color: #94a3b8; text-align: center; margin-top: 2rem; }
          .status { display: inline-block; padding: 0.2rem 0.8rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
          .status.active { background: #dcfce7; color: #16a34a; }
          .status.dispensed { background: #dbeafe; color: #2563eb; }
          @media print { body { padding: 1cm; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">🏥 MedConnect<small>Plateforme Médicale Universelle</small></div>
          <div style="display:flex;align-items:center;gap:1.5rem;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${prescription.code}" alt="QR Code" style="border:1px solid #e2e8f0;padding:2px;border-radius:4px;width:90px;height:90px;"/>
            <div class="rx-code">
              <div class="code">${prescription.code}</div>
              <div class="date">${new Date(prescription.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
              <span class="status ${prescription.statut === 'active' ? 'active' : 'dispensed'}">${prescription.statut === 'active' ? '✅ Active' : '💊 Dispensée'}</span>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Informations du Patient</div>
          <div class="patient-info">
            <div><span class="label">Nom complet</span><div class="value">${prescription.patientNom}</div></div>
            <div><span class="label">Téléphone</span><div class="value">${prescription.patientTel || '—'}</div></div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Diagnostic</div>
          <div class="diagnostic">⚕️ ${prescription.diagnostic}</div>
        </div>

        <div class="section">
          <div class="prescription-box">
            <h3>💊 Prescription</h3>
            <div class="treatment">${prescription.traitement}</div>
            ${prescription.notes ? `<div class="notes">📌 ${prescription.notes}</div>` : ''}
          </div>
        </div>

        ${prescription.dispensedAt ? `
          <div class="section">
            <div class="section-title">Dispensation</div>
            <div class="patient-info">
              <div><span class="label">Dispensé par</span><div class="value">${prescription.dispensedBy}</div></div>
              <div><span class="label">Date</span><div class="value">${new Date(prescription.dispensedAt).toLocaleString('fr-FR')}</div></div>
            </div>
          </div>
        ` : ''}

        <div class="footer">
          <div class="signature">
            <div class="line"></div>
            <div>${prescription.docteur}</div>
          </div>
          <div style="font-size:0.8rem;color:#64748b;">
            Code: <strong>${prescription.code}</strong><br>
            Communiquez ce code au pharmacien
          </div>
        </div>

        <div class="stamp">
          MedConnect — Plateforme Médicale Gratuite — Ce document est généré électroniquement
        </div>

        <div class="no-print" style="text-align:center;margin-top:2rem;">
          <button onclick="window.print()" style="padding:0.75rem 2rem;background:#0EA5E9;color:white;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:600;">🖨️ Imprimer / Enregistrer en PDF</button>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  // ===== UI: Pharmacist prescription lookup =====
  function getPharmacistLookupHTML() {
    return `
      <div class="glass section-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:1rem;">🔍 Rechercher une Ordonnance</h3>
        <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:1rem;">Entrez le code d'ordonnance ou utilisez la caméra pour numériser le code QR de l'ordonnance.</p>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <input class="form-control" id="rx-lookup-code" placeholder="Ex: RX-A3K5M7P9" style="flex:1;min-width:200px;font-family:monospace;font-size:1.1rem;letter-spacing:2px;text-transform:uppercase;">
          <button class="btn btn-primary" onclick="ShareModule.lookupPrescription()">🔍 Chercher</button>
          <button class="btn btn-success" onclick="ShareModule.startQRScanner()">📷 Scanner QR</button>
        </div>
        <div id="rx-lookup-result" style="margin-top:1rem;"></div>
      </div>
    `;
  }

  function lookupPrescription() {
    const code = document.getElementById('rx-lookup-code')?.value;
    const resultDiv = document.getElementById('rx-lookup-result');
    if (!code || !resultDiv) return;

    const rx = findByCode(code);
    if (!rx) {
      resultDiv.innerHTML = `<div style="padding:1rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm);color:var(--danger);">❌ Aucune ordonnance trouvée avec le code <strong>${code.toUpperCase()}</strong></div>`;
      return;
    }

    const isActive = rx.statut === 'active';
    resultDiv.innerHTML = `
      <div style="padding:1.25rem;background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.2);border-radius:var(--radius-md);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h4 style="font-size:1rem;">📋 Ordonnance ${rx.code}</h4>
          <span class="badge ${isActive ? 'badge-green' : 'badge-blue'}">${rx.statut}</span>
        </div>
        <div class="info-grid" style="margin-bottom:1rem;">
          <div class="info-item"><label>Patient</label><p>${rx.patientNom}</p></div>
          <div class="info-item"><label>Téléphone</label><p>${rx.patientTel || '—'}</p></div>
          <div class="info-item"><label>Docteur</label><p>${rx.docteur}</p></div>
          <div class="info-item"><label>Date</label><p>${new Date(rx.date).toLocaleDateString('fr-FR')}</p></div>
        </div>
        <div style="background:var(--bg-input);padding:1rem;border-radius:var(--radius-sm);border-left:3px solid var(--primary);margin-bottom:1rem;">
          <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.25rem;">Diagnostic</p>
          <p style="font-weight:500;">${rx.diagnostic}</p>
          <p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.75rem;margin-bottom:0.25rem;">Traitement prescrit</p>
          <p style="font-weight:600;color:var(--primary);">${rx.traitement}</p>
          ${rx.notes ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem;font-style:italic;">📌 ${rx.notes}</p>` : ''}
        </div>
        ${rx.dispensedAt ? `
          <div style="background:rgba(16,185,129,0.1);padding:0.75rem;border-radius:var(--radius-sm);font-size:0.85rem;">
            ✅ Dispensée le ${new Date(rx.dispensedAt).toLocaleString('fr-FR')} par <strong>${rx.dispensedBy}</strong>
          </div>
        ` : `
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
            <button class="btn btn-success" onclick="ShareModule.dispenseFromLookup('${rx.code}')">✅ Marquer dispensée</button>
            <button class="btn btn-primary" onclick="PharmacyModule.loadPrescriptionIntoCart('${rx.code}')">🛒 Charger dans le panier</button>
            <button class="btn btn-ghost" onclick="ShareModule.printPrescription(ShareModule.findByCode('${rx.code}'))">🖨️ Imprimer</button>
          </div>
        `}
      </div>
    `;
  }

  function dispenseFromLookup(code) {
    const rx = dispensePrescription(code, 'Pharmacie MedConnect');
    if (rx) {
      App.showToast(`Ordonnance ${code} dispensée avec succès`, 'success');
      lookupPrescription(); // Refresh display
    }
  }

  // ===== UI: Patient shared prescriptions view =====
  function getPatientSharedHTML(patientId) {
    const prescriptions = getPatientPrescriptions(patientId);
    if (!prescriptions.length) {
      return `<div class="empty-state"><div class="empty-icon">📤</div><h3>Aucune ordonnance partagée</h3><p>Les ordonnances créées par votre docteur apparaîtront ici avec un code à partager au pharmacien.</p></div>`;
    }

    return prescriptions.sort((a, b) => b.date.localeCompare(a.date)).map(rx => `
      <div class="glass section-card" style="margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <div>
            <h3 style="font-size:1rem;">📝 Ordonnance du ${new Date(rx.date).toLocaleDateString('fr-FR')}</h3>
            <span class="badge badge-blue">${rx.docteur}</span>
          </div>
          <div style="text-align:right;">
            <div style="font-family:monospace;font-size:1.2rem;font-weight:700;color:var(--primary);letter-spacing:2px;">${rx.code}</div>
            <span class="badge ${rx.statut === 'active' ? 'badge-green' : 'badge-purple'}">${rx.statut}</span>
          </div>
        </div>
        <div style="background:var(--bg-input);padding:1rem;border-radius:var(--radius-sm);border-left:3px solid var(--primary);margin-bottom:0.75rem;">
          <p style="font-weight:600;">💊 ${rx.traitement}</p>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.3rem;">Diagnostic: ${rx.diagnostic}</p>
        </div>
        ${rx.dispensedAt ? `<p style="font-size:0.8rem;color:var(--secondary);">✅ Dispensée le ${new Date(rx.dispensedAt).toLocaleString('fr-FR')} par ${rx.dispensedBy}</p>` : `<p style="font-size:0.8rem;color:var(--warning);">⏳ En attente — Communiquez le code <strong>${rx.code}</strong> à votre pharmacien</p>`}
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap;">
          <button class="btn btn-sm btn-ghost" onclick="ShareModule.printPrescription(ShareModule.findByCode('${rx.code}'))">🖨️ Imprimer</button>
          <button class="btn btn-sm btn-primary" onclick="ShareModule.copyCode('${rx.code}')">📋 Copier le code</button>
          <button class="btn btn-sm btn-success" onclick="ShareModule.toggleQRCodeDisplay('${rx.code}', this)">📱 Afficher QR Code</button>
        </div>
        <div id="qr-container-${rx.code}" class="qr-code-inline-container" style="display:none;margin-top:1rem;text-align:center;padding:1rem;background:rgba(255,255,255,0.03);border:1px dashed var(--border);border-radius:var(--radius-md);">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${rx.code}" alt="QR Code" style="border:4px solid white;border-radius:var(--radius-sm);box-shadow:var(--shadow-md);margin-bottom:0.5rem;width:150px;height:150px;"/>
          <p style="font-size:0.75rem;color:var(--text-secondary);">Faites scanner ce code QR par votre pharmacien pour charger vos médicaments.</p>
        </div>
      </div>
    `).join('');
  }

  function toggleQRCodeDisplay(code, btn) {
    const container = document.getElementById(`qr-container-${code}`);
    if (!container) return;
    const isHidden = container.style.display === 'none';
    container.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? '🙈 Masquer QR Code' : '📱 Afficher QR Code';
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code).then(() => {
      App.showToast(`Code ${code} copié !`, 'success');
    }).catch(() => {
      const el = document.createElement('textarea');
      el.value = code;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      App.showToast(`Code ${code} copié !`, 'success');
    });
  }

  let html5QrcodeScanner = null;

  function startQRScanner() {
    const resultDiv = document.getElementById('rx-lookup-result');
    if (!resultDiv) return;

    resultDiv.innerHTML = `
      <div class="qr-scanner-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:1.5rem;text-align:center;margin-top:1rem;animation:fadeIn 0.3s ease;">
        <h4 style="margin-bottom:0.75rem;display:flex;align-items:center;justify-content:center;gap:0.5rem;">
          <span class="pulse-dot" style="width:10px;height:10px;background:var(--success);border-radius:50%;display:inline-block;"></span>
          📷 Scanner l'Ordonnance en Direct
        </h4>
        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:1rem;">Placez le code QR de l'ordonnance devant votre caméra.</p>
        
        <div style="position:relative;width:100%;max-width:320px;margin:0 auto;border-radius:var(--radius-md);overflow:hidden;border:2px solid var(--primary);box-shadow:var(--shadow-glow);background:#000;">
          <div id="qr-reader" style="width:100%;height:240px;background:#000;"></div>
          <div class="scanner-laser-line" style="position:absolute;top:0;left:0;width:100%;height:3px;background:var(--primary);box-shadow:0 0 10px var(--primary);animation:laserMove 2s linear infinite;z-index:5;pointer-events:none;"></div>
        </div>
        
        <div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:center;">
          <button class="btn btn-ghost btn-sm" onclick="ShareModule.stopQRScanner()">❌ Annuler le scan</button>
        </div>
      </div>
    `;

    if (!window.Html5Qrcode) {
      const script = document.createElement('script');
      script.src = "https://unpkg.com/html5-qrcode";
      script.onload = () => initScanner();
      document.head.appendChild(script);
    } else {
      initScanner();
    }
  }

  function initScanner() {
    try {
      html5QrcodeScanner = new Html5Qrcode("qr-reader");
      const config = { fps: 10, qrbox: { width: 180, height: 180 } };

      html5QrcodeScanner.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          const input = document.getElementById('rx-lookup-code');
          if (input) input.value = decodedText;
          stopQRScanner();
          lookupPrescription();
          App.showToast(`Code QR détecté avec succès : ${decodedText}`, 'success');
        },
        (errorMessage) => {
          // Silent noise fallback
        }
      ).catch(() => {
        showScannerError();
      });
    } catch (e) {
      showScannerError();
    }
  }

  function showScannerError() {
    const resultDiv = document.getElementById('rx-lookup-result');
    if (!resultDiv) return;
    resultDiv.innerHTML = `
      <div style="padding:1.5rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-md);color:var(--danger);text-align:center;margin-top:1rem;animation:fadeIn 0.3s ease;">
        <span style="font-size:2rem;display:block;margin-bottom:0.5rem;">📷</span>
        <h4>Accès Caméra Non Disponible</h4>
        <p style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.25rem;margin-bottom:1rem;">L'accès à la caméra a été refusé ou votre appareil n'est pas équipé de caméra. Entrez le code de l'ordonnance manuellement.</p>
        <button class="btn btn-ghost btn-sm" onclick="ShareModule.stopQRScanner()">Fermer</button>
      </div>
    `;
  }

  async function stopQRScanner() {
    const resultDiv = document.getElementById('rx-lookup-result');
    if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
      try {
        await html5QrcodeScanner.stop();
      } catch (err) {
      }
    }
    html5QrcodeScanner = null;
    if (resultDiv) resultDiv.innerHTML = '';
  }

  async function sharePatient(patientId) {
    const patient = window.DB?.getPatientById?.(patientId);
    if (!patient) return;
    const name = `${patient.firstname || patient.prenom || ''} ${patient.lastname || patient.nom || ''}`.trim();
    const text = `MedConnect — ${name}\nID patient : ${patient.id}\nGroupe sanguin : ${patient.blood_type || patient.groupeSanguin || '—'}\nAllergies : ${patient.allergies || '—'}`;
    if (navigator.share) {
      await navigator.share({ title: 'Fiche patient MedConnect', text }).catch(() => {});
      return;
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text).catch(() => {});
      window.App?.toast?.('📋 Fiche patient copiée');
    }
  }

  return { createPrescription, getAllPrescriptions, findByCode, getPatientPrescriptions, dispensePrescription, printPrescription, getPharmacistLookupHTML, lookupPrescription, dispenseFromLookup, getPatientSharedHTML, sharePatient, copyCode, generateCode, toggleQRCodeDisplay, startQRScanner, stopQRScanner };
})();
