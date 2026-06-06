/* =====================================================
   MedConnect 2.0 — Pharmacie
   N° lot · Date expiration · Alertes · Réseau
   ===================================================== */
const PharmacyPortal = (() => {
  const t   = k => I18n.t(k);
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let cart  = [];

  function render(section) {
    const main = document.getElementById('main-content');
    switch (section) {
      case 'dashboard': renderDashboard(main); break;
      case 'pos':       renderPOS(main);       break;
      case 'inventory': renderInventory(main); break;
      case 'sales':     renderSales(main);     break;
      case 'map':       MapModule.render(main); break;
      default:          renderDashboard(main);
    }
  }

  const today = () => new Date().toISOString().slice(0,10);
  const soon  = () => new Date(Date.now()+30*86400000).toISOString().slice(0,10);

  /* ── DASHBOARD ──────────────────────────────────── */
  function renderDashboard(main) {
    const s     = DB.getStats();
    const cur   = t('currency');
    const meds  = DB.getMedicines();
    const low   = meds.filter(m=>parseInt(m.stock)<10);
    const exp   = meds.filter(m=>m.expiry && m.expiry < today());
    const expSn = meds.filter(m=>m.expiry && m.expiry >= today() && m.expiry <= soon());
    const inbox = DB.getMessages().filter(m=>m.to_role==='pharmacist' && !m.read);

    main.innerHTML = `
      <div class="page-header">
        <h2>📊 ${t('nav_dashboard')}</h2>
        <button class="btn btn-primary btn-sm" onclick="App.navigateTo('pos')">🛒 ${t('nav_pos')}</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card" style="border-top:3px solid #A855F7">
          <div class="stat-icon">💰</div><div class="stat-value">${s.totalSales.toFixed(2)}</div>
          <div class="stat-label">${t('stat_sales')} (${cur})</div>
          <div class="stat-sub">${s.todaySales.toFixed(2)} ${t('stat_today')}</div>
        </div>
        <div class="stat-card" style="border-top:3px solid var(--accent)">
          <div class="stat-icon">📦</div><div class="stat-value">${meds.length}</div>
          <div class="stat-label">${t('nav_inventory')}</div>
          <div class="stat-sub">${low.length} bas stock · ${exp.length} expirés</div>
        </div>
        <div class="stat-card" style="border-top:3px solid var(--danger)">
          <div class="stat-icon">⚠️</div><div class="stat-value">${exp.length + expSn.length}</div>
          <div class="stat-label">Alertes expiration</div>
          <div class="stat-sub">${exp.length} expirés · ${expSn.length} bientôt</div>
        </div>
        <div class="stat-card" style="border-top:3px solid var(--primary)">
          <div class="stat-icon">📨</div><div class="stat-value">${inbox.length}</div>
          <div class="stat-label">Ordonnances reçues</div>
          <div class="stat-sub"><button class="btn btn-ghost btn-xs" onclick="App.navigateTo('inbox')">Voir →</button></div>
        </div>
      </div>
      ${exp.length ? `<div class="alert-box">🔴 Médicaments EXPIRÉS : ${exp.map(m=>esc(m.name)).join(', ')}</div>` : ''}
      ${expSn.length ? `<div class="alert-box" style="background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.3);color:var(--accent)">⚠️ Expirent dans 30 jours : ${expSn.map(m=>esc(m.name)+' ('+m.expiry+')').join(', ')}</div>` : ''}
      ${low.length ? `<div class="alert-box">📦 Stock bas : ${low.map(m=>esc(m.name)).join(', ')}</div>` : ''}
      <div class="page-header" style="margin-top:1rem">
        <h3>Inventaire récent</h3>
        <button class="btn btn-ghost btn-sm" onclick="App.navigateTo('inventory')">Tout voir →</button>
      </div>
      ${inventoryTable(meds.slice(0,6))}`;
  }

  /* ── POS ────────────────────────────────────────── */
  function renderPOS(main) {
    cart = [];
    const cur  = t('currency');
    main.innerHTML = `
      <div class="page-header"><h2>🛒 ${t('nav_pos')}</h2></div>
      <div class="pos-layout">
        <div class="pos-products">
          <div class="search-bar">
            <input type="search" id="med-srch" placeholder="${t('search_placeholder')}"
                   oninput="PharmacyPortal.filterMeds(this.value)">
          </div>
          <div id="meds-grid" class="meds-grid">${medCards(DB.getMedicines(), cur)}</div>
        </div>
        <div class="pos-cart">
          <h3>🧾 ${t('receipt')}</h3>
          <div class="form-group">
            <label>${t('search_by_id')}</label>
            <input type="text" id="sale-pid" placeholder="MC-2026-XX-XXXXXXXX"
                   oninput="PharmacyPortal.lookupPatient(this.value)">
            <small id="pid-found" style="color:var(--secondary)"></small>
          </div>
          <div id="cart-body" class="cart-items"><p class="cart-empty">${t('msg_cart_empty')}</p></div>
          <div class="cart-total"><strong>${t('total')} : <span id="cart-sum">0.00</span> ${cur}</strong></div>
          <button class="btn btn-primary btn-full" onclick="PharmacyPortal.checkout()">✅ ${t('sell')}</button>
        </div>
      </div>`;
  }

  function medCards(meds, cur) {
    if (!meds.length) return `<p class="card empty-state">${t('no_data')}</p>`;
    return meds.map(m => {
      const expired = m.expiry && m.expiry < today();
      const expSoon = m.expiry && m.expiry >= today() && m.expiry <= soon();
      return `
        <div class="med-card ${parseInt(m.stock)<=0||expired?'out-of-stock':''}"
             onclick="PharmacyPortal.addToCart('${m.mid}')">
          <div class="med-name">💊 ${esc(m.name)}</div>
          <div class="med-price">${m.price} ${cur}</div>
          <div class="med-stock ${parseInt(m.stock)<10?'low':''}">📦 ${m.stock}</div>
          ${expired ? `<div style="color:var(--danger);font-size:.7rem">🔴 EXPIRÉ</div>` : ''}
          ${expSoon ? `<div style="color:var(--accent);font-size:.7rem">⚠️ exp. ${m.expiry}</div>` : ''}
          ${m.lot ? `<div style="color:var(--text-dim);font-size:.7rem">Lot: ${m.lot}</div>` : ''}
        </div>`;
    }).join('');
  }

  function filterMeds(q) {
    const cur  = t('currency');
    const meds = DB.getMedicines().filter(m => m.name.toLowerCase().includes(q.toLowerCase()));
    document.getElementById('meds-grid').innerHTML = medCards(meds, cur);
  }

  function addToCart(mid) {
    const med = DB.getMedicines().find(m => m.mid === mid);
    if (!med) return;
    if (med.expiry && med.expiry < today()) { App.toast('🔴 Médicament expiré', 'error'); return; }
    if (parseInt(med.stock) <= 0) { App.toast(t('msg_low_stock'), 'error'); return; }
    const ex = cart.find(i => i.mid === mid);
    ex ? ex.qty++ : cart.push({ mid, name:med.name, price:parseFloat(med.price), qty:1 });
    refreshCart();
  }

  function removeFromCart(mid) { cart = cart.filter(i => i.mid !== mid); refreshCart(); }
  function updateQty(mid, v)   { const i=cart.find(x=>x.mid===mid); if(i) i.qty=Math.max(1,parseInt(v)||1); refreshCart(); }

  function refreshCart() {
    const cur   = t('currency');
    const body  = document.getElementById('cart-body');
    const sumEl = document.getElementById('cart-sum');
    if (!body) return;
    if (!cart.length) { body.innerHTML=`<p class="cart-empty">${t('msg_cart_empty')}</p>`; if(sumEl) sumEl.textContent='0.00'; return; }
    const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
    body.innerHTML = cart.map(i=>`
      <div class="cart-item">
        <span>${esc(i.name)}</span>
        <input type="number" min="1" value="${i.qty}" class="cart-qty" onchange="PharmacyPortal.updateQty('${i.mid}',this.value)">
        <span>${(i.price*i.qty).toFixed(2)} ${cur}</span>
        <button class="btn btn-ghost btn-xs" onclick="PharmacyPortal.removeFromCart('${i.mid}')">✕</button>
      </div>`).join('');
    if (sumEl) sumEl.textContent = total.toFixed(2);
  }

  function lookupPatient(q) {
    const el = document.getElementById('pid-found'); if (!el) return;
    if (q.length < 5) { el.textContent=''; return; }
    const p = DB.getPatientById(q) || DB.searchPatients(q)[0];
    el.textContent = p ? `✅ ${t('patient_found')} : ${p.firstname} ${p.lastname}` : '';
  }

  function checkout() {
    if (!cart.length) { App.toast(t('msg_cart_empty'), 'error'); return; }
    const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
    const pid   = document.getElementById('sale-pid')?.value?.trim() || null;
    const sale  = DB.addSale([...cart], total, pid);
    App.toast(`✅ ${t('sell')} — ${total.toFixed(2)} ${t('currency')}`);
    printReceipt(sale);
    cart = [];
    App.navigateTo('pos');
  }

  function printReceipt(sale) {
    const cur = t('currency');
    const p   = sale.patient_id ? DB.getPatientById(sale.patient_id) : null;
    const w   = window.open('', '_blank', 'width=380,height=550');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reçu</title>
      <style>body{font-family:monospace;max-width:320px;margin:auto;padding:16px}h2{text-align:center;color:#0EA5E9}hr{border:1px dashed #ccc}.total{font-weight:bold;font-size:1.1em;text-align:right}</style></head><body>
      <h2>🏥 MedConnect</h2><p style="text-align:center">${new Date().toLocaleString()}</p>
      ${p?`<p>Patient : <strong>${p.firstname} ${p.lastname}</strong><br><small>${p.id}</small></p>`:''}
      <hr>${sale.items.map(i=>`<p>${esc(i.name)} ×${i.qty} = ${(i.price*i.qty).toFixed(2)} ${cur}</p>`).join('')}
      <hr><p class="total">${t('total')} : ${parseFloat(sale.total).toFixed(2)} ${cur}</p>
      <p style="text-align:center;margin-top:1rem">Merci / Thank you 🙏</p></body></html>`);
    w.print();
  }

  /* ── INVENTORY ──────────────────────────────────── */
  function renderInventory(main) {
    main.innerHTML = `
      <div class="page-header">
        <h2>📦 ${t('nav_inventory')}</h2>
        <button class="btn btn-primary btn-sm" onclick="PharmacyPortal.openAddMed()">+ ${t('add_medicine')}</button>
      </div>
      <div id="inv-wrap">${inventoryTable(DB.getMedicines())}</div>`;
  }

  function inventoryTable(meds) {
    const cur = t('currency');
    if (!meds.length) return `<div class="card empty-state"><p>${t('no_data')}</p></div>`;
    return `<div class="table-wrapper"><table class="data-table">
      <thead><tr>
        <th>${t('med_name')}</th><th>${t('med_price')} (${cur})</th><th>${t('med_stock')}</th>
        <th>N° Lot</th><th>Expiration</th><th>${t('actions')}</th>
      </tr></thead>
      <tbody>
        ${meds.map(m=>{
          const exp   = m.expiry && m.expiry < today();
          const expSn = m.expiry && m.expiry >= today() && m.expiry <= soon();
          return `<tr class="${exp?'expired-row':expSn?'expiring-row':parseInt(m.stock)<10?'low-stock-row':''}">
            <td>💊 ${esc(m.name)}${exp?` <span style="color:var(--danger);font-size:.75rem">EXPIRÉ</span>`:expSn?` <span style="color:var(--accent);font-size:.75rem">⚠️</span>`:''}
              ${m.category?`<br><small style="color:var(--text-muted)">${esc(m.category)}</small>`:''}
            </td>
            <td>${m.price}</td>
            <td>${parseInt(m.stock)<10?'⚠️':''} ${m.stock}</td>
            <td>${esc(m.lot)||'—'}</td>
            <td style="${exp?'color:var(--danger)':expSn?'color:var(--accent)':''}">${m.expiry||'—'}</td>
            <td>
              <button class="btn btn-ghost btn-xs" onclick="PharmacyPortal.openEditMed('${m.mid}')">${t('btn_edit')}</button>
              <button class="btn btn-ghost btn-xs" onclick="PharmacyPortal.deleteMed('${m.mid}')">${t('btn_delete')}</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  function openAddMed() {
    App.openModal(`➕ ${t('add_medicine')}`, `
      <form onsubmit="PharmacyPortal.saveMed(event)">
        <div class="form-grid">
          <div class="form-group"><label>${t('med_name')} *</label><input type="text" id="m-name" required></div>
          <div class="form-group"><label>${t('med_price')} *</label><input type="number" id="m-price" step="0.01" min="0" required></div>
          <div class="form-group"><label>${t('med_stock')} *</label><input type="number" id="m-stock" min="0" required></div>
          <div class="form-group"><label>Catégorie</label><input type="text" id="m-cat"></div>
          <div class="form-group"><label>Fournisseur</label><input type="text" id="m-supplier"></div>
          <div class="form-group"><label>N° de lot</label><input type="text" id="m-lot" placeholder="LOT-2026-001"></div>
          <div class="form-group"><label>Date d'expiration</label><input type="date" id="m-expiry"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">${t('btn_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('btn_save')}</button>
        </div>
      </form>`);
  }

  function saveMed(e) {
    e.preventDefault();
    DB.addMedicine({
      name:     document.getElementById('m-name').value.trim(),
      price:    document.getElementById('m-price').value,
      stock:    document.getElementById('m-stock').value,
      category: document.getElementById('m-cat').value,
      supplier: document.getElementById('m-supplier').value,
      lot:      document.getElementById('m-lot').value,
      expiry:   document.getElementById('m-expiry').value,
    });
    App.closeModal(); App.toast(t('msg_saved')); App.navigateTo('inventory');
  }

  function openEditMed(mid) {
    const m = DB.getMedicines().find(x=>x.mid===mid); if (!m) return;
    App.openModal(`✏️ ${t('btn_edit')}`, `
      <form onsubmit="PharmacyPortal.saveEditMed(event,'${mid}')">
        <div class="form-grid">
          <div class="form-group"><label>${t('med_name')} *</label><input type="text" id="em-name" value="${esc(m.name)}" required></div>
          <div class="form-group"><label>${t('med_price')} *</label><input type="number" id="em-price" step="0.01" value="${m.price}" required></div>
          <div class="form-group"><label>${t('med_stock')} *</label><input type="number" id="em-stock" value="${m.stock}" required></div>
          <div class="form-group"><label>Catégorie</label><input type="text" id="em-cat" value="${esc(m.category||'')}"></div>
          <div class="form-group"><label>Fournisseur</label><input type="text" id="em-supplier" value="${esc(m.supplier||'')}"></div>
          <div class="form-group"><label>N° de lot</label><input type="text" id="em-lot" value="${esc(m.lot||'')}"></div>
          <div class="form-group"><label>Date d'expiration</label><input type="date" id="em-expiry" value="${m.expiry||''}"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">${t('btn_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('btn_save')}</button>
        </div>
      </form>`);
  }

  function saveEditMed(e, mid) {
    e.preventDefault();
    DB.updateMedicine(mid, {
      name:     document.getElementById('em-name').value.trim(),
      price:    document.getElementById('em-price').value,
      stock:    document.getElementById('em-stock').value,
      category: document.getElementById('em-cat').value,
      supplier: document.getElementById('em-supplier').value,
      lot:      document.getElementById('em-lot').value,
      expiry:   document.getElementById('em-expiry').value,
    });
    App.closeModal(); App.toast(t('msg_saved')); App.navigateTo('inventory');
  }

  function deleteMed(mid) {
    if (!confirm(t('msg_confirm_delete'))) return;
    DB.deleteMedicine(mid); App.toast(t('msg_deleted')); App.navigateTo('inventory');
  }

  /* ── SALES ──────────────────────────────────────── */
  function renderSales(main) {
    const cur  = t('currency');
    const list = DB.getSales().reverse();
    main.innerHTML = `
      <div class="page-header"><h2>📈 ${t('nav_sales_history')}</h2></div>
      ${!list.length ? `<div class="card empty-state"><p>${t('no_data')}</p></div>` : ''}
      <div class="records-list">
        ${list.map(s => {
          const p = s.patient_id ? DB.getPatientById(s.patient_id) : null;
          return `<div class="record-card">
            <div class="record-header">
              <span class="record-date">📅 ${s.date} ${s.time}</span>
              ${p?`<span class="id-tag">${p.id}</span>`:''}
              <span class="sale-total">💰 ${parseFloat(s.total).toFixed(2)} ${cur}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem">
              ${s.items.map(i=>`<span class="sale-chip">💊 ${esc(i.name)} ×${i.qty}</span>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  return {
    render, filterMeds, addToCart, removeFromCart, updateQty, checkout, lookupPatient,
    openAddMed, saveMed, openEditMed, saveEditMed, deleteMed,
  };
})();

const PharmacyModule = PharmacyPortal;

window.PharmacyPortal = PharmacyPortal;
window.PharmacyModule = PharmacyModule;
