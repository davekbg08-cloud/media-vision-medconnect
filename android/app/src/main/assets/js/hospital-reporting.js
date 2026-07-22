/* =====================================================
   MedConnect 2.0 — HospitalReportingModule (chantier E)
   Reporting d'établissement, 100 % CÔTÉ CLIENT.

   Objectif : donner à l'administration (admin / admin_hospital) une
   vue d'ensemble chiffrée de l'activité de SON établissement, calculée
   à partir des données déjà lues par l'application — AUCUNE nouvelle
   collection Firestore, aucun serveur. Réutilise CloudDB.listByHospital
   (déjà borné par établissement côté requête ET côté règles) comme le
   tableau de bord existant.

   Accès : réservé à admin / admin_hospital (voir HospitalPermissions.
   ROUTES.reporting) ; garde revérifiée au rendu (requireRoute).

   Export : CSV (téléchargement local) et impression/PDF (fenêtre
   navigateur), sans aucune dépendance externe.
   ===================================================== */
const HospitalReportingModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Fenêtre de lecture large (le reporting agrège, il ne pagine pas).
  const FETCH_LIMIT = 1000;

  function isToday(iso) {
    if (!iso) return false;
    try { return String(iso).slice(0, 10) === new Date().toISOString().slice(0, 10); }
    catch (_) { return false; }
  }
  function count(list, pred) { return (list || []).filter(pred).length; }

  /* Agrège les indicateurs de l'établissement. Chaque lecture est
     défensive : une collection absente/refusée dégrade à 0, jamais une
     erreur bloquante (le reporting reste affiché, honnête sur ce qu'il a). */
  async function computeStats(hospitalId) {
    const safe = (col) => CloudDB.listByHospital(col, hospitalId, { limit: FETCH_LIMIT }).catch(() => []);
    const [beds, admissions, labRequests, consultations, emergencies] = await Promise.all([
      safe('beds'), safe('admissions'), safe('labRequests'),
      safe('mc_consultations'), safe('emergencyCases'),
    ]);

    const bedsTotal = beds.length;
    const bedsOccupied = count(beds, b => b.status === 'occupied' || b.status === 'admitted');
    const bedsMaintenance = count(beds, b => b.status === 'maintenance');
    const bedsFree = bedsTotal - bedsOccupied - bedsMaintenance;
    const occupancyPct = bedsTotal ? Math.round((bedsOccupied / bedsTotal) * 100) : 0;

    const admWaiting = count(admissions, a => a.status === 'waiting');
    const admPre = count(admissions, a => a.status === 'pre_admission');
    const admActive = count(admissions, a => a.status === 'admitted' || a.status === 'hospitalized');
    const admDischarged = count(admissions, a => a.status === 'discharged' || a.status === 'done');
    const admToday = count(admissions, a => isToday(a.arrivedAt || a.createdAt || a.created_at));

    const labTotal = labRequests.length;
    const labPending = count(labRequests, o => o.status !== 'completed');

    const consultTotal = consultations.length;
    const consultToday = count(consultations, c => isToday(c.date || c.createdAt || c.created_at));

    const emgActive = count(emergencies, e => e.status === 'waiting' || e.status === 'in_care');

    return {
      beds: { total: bedsTotal, occupied: bedsOccupied, free: Math.max(0, bedsFree), maintenance: bedsMaintenance, occupancyPct },
      admissions: { waiting: admWaiting, preAdmission: admPre, active: admActive, discharged: admDischarged, today: admToday, total: admissions.length },
      lab: { total: labTotal, pending: labPending, completed: labTotal - labPending },
      consultations: { total: consultTotal, today: consultToday },
      emergencies: { active: emgActive, total: emergencies.length },
    };
  }

  // Aplati en lignes [Indicateur, Valeur] — sert au tableau, au CSV et à l'impression.
  function toRows(s) {
    return [
      ['Lits — total', s.beds.total],
      ['Lits — occupés', s.beds.occupied],
      ['Lits — libres', s.beds.free],
      ['Lits — maintenance', s.beds.maintenance],
      ["Taux d'occupation (%)", s.beds.occupancyPct],
      ['Admissions — en attente', s.admissions.waiting],
      ['Admissions — pré-admission', s.admissions.preAdmission],
      ['Admissions — hospitalisés', s.admissions.active],
      ['Admissions — sorties', s.admissions.discharged],
      ["Arrivées aujourd'hui", s.admissions.today],
      ['Analyses labo — total', s.lab.total],
      ['Analyses labo — en attente', s.lab.pending],
      ['Analyses labo — terminées', s.lab.completed],
      ['Consultations — total', s.consultations.total],
      ["Consultations aujourd'hui", s.consultations.today],
      ['Urgences — en cours', s.emergencies.active],
    ];
  }

  let _lastStats = null;
  let _lastHospitalName = '';

  async function render(container) {
    // Défense en profondeur : la route est déjà filtrée au menu, on
    // revérifie l'autorisation au rendu (jamais un simple masquage).
    HospitalPermissions.requireRoute('reporting');

    container.innerHTML = `<div class="card empty-state"><p>⏳ Calcul des indicateurs…</p></div>`;
    let hospital = {};
    try { hospital = await CloudDB.getActiveHospital(); } catch (_) {}
    const hospitalId = hospital.establishmentId || hospital.id;
    _lastHospitalName = hospital.name || 'Établissement';

    let s;
    try { s = await computeStats(hospitalId); }
    catch (e) {
      container.innerHTML = `<div class="card empty-state"><p>${esc(e.message || 'Impossible de calculer les indicateurs.')}</p></div>`;
      return;
    }
    _lastStats = s;

    const card = (value, label, tone) =>
      `<div class="hospital-stat-card"><h3${tone ? ` style="color:var(--${tone})"` : ''}>${esc(value)}</h3><p>${label}</p></div>`;

    container.innerHTML = `
      <div class="hospital-page-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
        <div><h1>📊 Reporting — ${esc(_lastHospitalName)}</h1>
        <p>Vue d'ensemble de l'activité · calculée sur cet appareil</p></div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button type="button" class="btn btn-primary btn-sm" onclick="HospitalReportingModule.exportCsv()">⬇️ Exporter (CSV)</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="HospitalReportingModule.printReport()">🖨️ Imprimer / PDF</button>
        </div>
      </div>

      <div class="hospital-stats-grid">
        ${card(s.beds.occupancyPct + ' %', "🛏️ Taux d'occupation", s.beds.occupancyPct >= 90 ? 'danger' : (s.beds.occupancyPct >= 75 ? 'accent' : 'secondary'))}
        ${card(s.beds.occupied + ' / ' + s.beds.total, '🛏️ Lits occupés')}
        ${card(s.admissions.active, '👥 Hospitalisés')}
        ${card(s.admissions.waiting + s.admissions.preAdmission, '⏳ En attente / pré-admission')}
        ${card(s.emergencies.active, '🚑 Urgences en cours', s.emergencies.active > 0 ? 'danger' : '')}
        ${card(s.lab.pending, '🧪 Analyses en attente')}
        ${card(s.consultations.today, "🩺 Consultations aujourd'hui")}
        ${card(s.admissions.today, "🚪 Arrivées aujourd'hui")}
      </div>

      <div class="card">
        <h3>Détail des indicateurs</h3>
        <div class="table-wrapper" style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr>
              <th style="text-align:left;padding:.5rem;border-bottom:1px solid var(--border)">Indicateur</th>
              <th style="text-align:right;padding:.5rem;border-bottom:1px solid var(--border)">Valeur</th>
            </tr></thead>
            <tbody>
              ${toRows(s).map(([k, v]) => `<tr>
                <td style="padding:.45rem .5rem;border-bottom:1px solid var(--border)">${esc(k)}</td>
                <td style="padding:.45rem .5rem;border-bottom:1px solid var(--border);text-align:right;font-variant-numeric:tabular-nums">${esc(v)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:.6rem;font-size:.8rem">Indicateurs calculés localement à partir des données de l'établissement (lits, admissions, laboratoire, consultations, urgences). Les pharmacies, isolées, ne sont pas incluses.</p>
      </div>
    `;
  }

  /* Export CSV — construit le fichier en mémoire et déclenche un
     téléchargement local (aucun envoi réseau). Point-virgule comme
     séparateur (tableurs FR), BOM UTF-8 pour les accents. */
  function exportCsv() {
    if (!_lastStats) { window.App?.toast?.('Ouvrez d\'abord le reporting.', 'error'); return; }
    const date = new Date().toISOString().slice(0, 10);
    const header = 'Indicateur;Valeur\n';
    const body = toRows(_lastStats).map(([k, v]) => `"${String(k).replace(/"/g, '""')}";${v}`).join('\n');
    const csv = '﻿' + `Reporting;${_lastHospitalName}\nDate;${date}\n\n` + header + body + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporting_${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.App?.toast?.('✅ Export CSV téléchargé.');
  }

  /* Impression / PDF — ouvre une fenêtre avec une mise en page sobre et
     déclenche l'impression (l'utilisateur choisit « Enregistrer en PDF »).
     Aucune donnée nominative : uniquement des agrégats. */
  function printReport() {
    if (!_lastStats) { window.App?.toast?.('Ouvrez d\'abord le reporting.', 'error'); return; }
    const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const rows = toRows(_lastStats).map(([k, v]) =>
      `<tr><td>${esc(k)}</td><td style="text-align:right">${esc(v)}</td></tr>`).join('');
    const w = window.open('', '_blank', 'width=800,height=600');
    if (!w) { window.App?.toast?.('Fenêtre d\'impression bloquée par le navigateur.', 'error'); return; }
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <title>Reporting ${esc(_lastHospitalName)} — ${esc(date)}</title>
      <style>
        body{font-family:'Segoe UI',Arial,sans-serif;padding:2rem;color:#1e293b}
        h1{color:#0EA5E9;font-size:1.4rem;margin:0 0 .25rem}
        .sub{color:#64748b;font-size:.85rem;margin-bottom:1.5rem}
        table{width:100%;border-collapse:collapse;font-size:.9rem}
        th,td{padding:.5rem .6rem;border-bottom:1px solid #e2e8f0}
        th{text-align:left;color:#64748b;text-transform:uppercase;font-size:.7rem;letter-spacing:.05em}
        .foot{margin-top:2rem;font-size:.7rem;color:#94a3b8}
        @media print{body{padding:1cm}}
      </style></head><body>
      <h1>📊 Reporting — ${esc(_lastHospitalName)}</h1>
      <div class="sub">Vue d'ensemble de l'activité · ${esc(date)}</div>
      <table><thead><tr><th>Indicateur</th><th style="text-align:right">Valeur</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="foot">MedConnect — indicateurs agrégés (aucune donnée patient nominative). Généré le ${esc(date)}.</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
      </body></html>`);
    w.document.close();
  }

  return { render, computeStats, toRows, exportCsv, printReport };
})();

window.HospitalReportingModule = HospitalReportingModule;
