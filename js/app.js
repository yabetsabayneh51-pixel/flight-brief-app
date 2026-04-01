(async function() {
  'use strict';

  console.log('[App] Starting Flight Brief...');
  await db.open();
  loadSettings();
  await renderAll();
  setupEventListeners();
  registerServiceWorker();

  if (navigator.onLine && syncEngine.apiUrl) {
    setTimeout(() => syncEngine.fullSync(), 1000);
  }

  function loadSettings() {
    const apiUrl = localStorage.getItem('fb_api_url') || '';
    const syncInterval = localStorage.getItem('fb_sync_interval') || '15';
    document.getElementById('setting-api-url').value = apiUrl;
    document.getElementById('setting-sync-interval').value = syncInterval;
    syncEngine.apiUrl = apiUrl;
    syncEngine.startAutoSync(parseInt(syncInterval));
  }

  async function renderAll() {
    await Promise.all([renderBriefs(), renderAirports(), renderHotels(), renderCities()]);
  }

  async function renderBriefs(filter = '') {
    const container = document.getElementById('briefs-list');
    const emptyState = document.getElementById('empty-briefs');
    const briefs = await db.getAllBriefs();
    const filtered = filter
      ? briefs.filter(b => {
          const searchStr = [b.Flight_Number, b.Origin, b.Destination, b.City, b.HotelName, b.RouteKey].join(' ').toLowerCase();
          return searchStr.includes(filter.toLowerCase());
        })
      : briefs;
    if (filtered.length === 0) { container.innerHTML = ''; emptyState.classList.remove('hidden'); return; }
    emptyState.classList.add('hidden');
    container.innerHTML = filtered.map(brief => {
      const id = brief['Briefs ID'] || '';
      const flight = brief.Flight_Number || '\u2014';
      const origin = brief.Origin || '???';
      const dest = brief.Destination || '???';
      const date = brief.Date || '\u2014';
      const type = brief.FlightType || '';
      const gate = brief.Gate || '';
      const rwy = brief.ArrRunway || '';
      const dirty = brief.dirty ? ' <span title="Unsynced changes">\u25cf</span>' : '';
      const badgeClass = type.toLowerCase().includes('inter') ? 'international' : 'domestic';
      return '<div class="card" data-id="' + escapeHtml(id) + '">' +
        '<div class="card-header"><span class="card-title">' + escapeHtml(flight) + dirty + '</span>' +
        (type ? '<span class="card-badge ' + badgeClass + '">' + escapeHtml(type) + '</span>' : '') + '</div>' +
        '<div class="card-route">' + escapeHtml(origin) + ' \u2192 ' + escapeHtml(dest) + '</div>' +
        '<div class="card-meta"><span>\ud83d\udcc5 ' + escapeHtml(date) + '</span>' +
        (gate ? '<span>\ud83d\udeaa Gate ' + escapeHtml(gate) + '</span>' : '') +
        (rwy ? '<span>\ud83d\udeec RWY ' + escapeHtml(rwy) + '</span>' : '') + '</div></div>';
    }).join('');
  }

  async function renderAirports(filter = '') {
    const container = document.getElementById('airports-list');
    let airports = await db.getAllAirports();
    if (filter) { airports = airports.filter(a => { const s = [a.ICAO, a.AirportName].join(' ').toLowerCase(); return s.includes(filter.toLowerCase()); }); }
    container.innerHTML = airports.map(a =>
      '<div class="ref-card"><h3>' + escapeHtml(a.ICAO || '\u2014') + '</h3><p><strong>' + escapeHtml(a.AirportName || '') + '</strong></p>' +
      (a.DepProceduresTemplate ? '<div class="ref-field"><span class="ref-label">Departure Procedures</span><p>' + escapeHtml(a.DepProceduresTemplate) + '</p></div>' : '') +
      (a.ArrProceduresTemplate ? '<div class="ref-field"><span class="ref-label">Arrival Procedures</span><p>' + escapeHtml(a.ArrProceduresTemplate) + '</p></div>' : '') +
      (a.GeneralNotes ? '<div class="ref-field"><span class="ref-label">Notes</span><p>' + escapeHtml(a.GeneralNotes) + '</p></div>' : '') + '</div>'
    ).join('') || '<div class="empty-state"><p>No airports loaded. Sync from Google Sheets.</p></div>';
  }

  async function renderHotels(filter = '') {
    const container = document.getElementById('hotels-list');
    let hotels = await db.getAllHotels();
    if (filter) { hotels = hotels.filter(h => { const s = [h.HotelName, h.City, h.Location].join(' ').toLowerCase(); return s.includes(filter.toLowerCase()); }); }
    container.innerHTML = hotels.map(h =>
      '<div class="ref-card"><h3>' + escapeHtml(h.HotelName || '\u2014') + '</h3><p>' + escapeHtml(h.City || '') + (h.Location ? ' \u00b7 ' + escapeHtml(h.Location) : '') + '</p>' +
      (h.Amenities ? '<div class="ref-field"><span class="ref-label">Amenities</span><p>' + escapeHtml(h.Amenities) + '</p></div>' : '') +
      (h.Notes ? '<div class="ref-field"><span class="ref-label">Notes</span><p>' + escapeHtml(h.Notes) + '</p></div>' : '') + '</div>'
    ).join('') || '<div class="empty-state"><p>No hotels loaded. Sync from Google Sheets.</p></div>';
  }

  async function renderCities(filter = '') {
    const container = document.getElementById('cities-list');
    let cities = await db.getAllCities();
    if (filter) { cities = cities.filter(c => { const s = [c.City, c.Country].join(' ').toLowerCase(); return s.includes(filter.toLowerCase()); }); }
    container.innerHTML = cities.map(c =>
      '<div class="ref-card"><h3>' + escapeHtml(c.City || '\u2014') + '</h3><p>' + escapeHtml(c.Country || '') + (c.Timezone ? ' \u00b7 ' + escapeHtml(c.Timezone) : '') + '</p>' +
      (c.ThingsToDo ? '<div class="ref-field"><span class="ref-label">Things To Do</span><p>' + escapeHtml(c.ThingsToDo) + '</p></div>' : '') +
      (c.ShoppingAreas ? '<div class="ref-field"><span class="ref-label">Shopping</span><p>' + escapeHtml(c.ShoppingAreas) + '</p></div>' : '') + '</div>'
    ).join('') || '<div class="empty-state"><p>No cities loaded. Sync from Google Sheets.</p></div>';
  }

  function setupEventListeners() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('view-' + tab.dataset.tab).classList.add('active');
      });
    });

    document.getElementById('search-briefs').addEventListener('input', debounce((e) => renderBriefs(e.target.value), 300));
    document.getElementById('search-airports').addEventListener('input', debounce((e) => renderAirports(e.target.value), 300));
    document.getElementById('search-hotels').addEventListener('input', debounce((e) => renderHotels(e.target.value), 300));
    document.getElementById('search-cities').addEventListener('input', debounce((e) => renderCities(e.target.value), 300));

    document.getElementById('briefs-list').addEventListener('click', async (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const id = card.dataset.id;
      const brief = await db.getBrief(id);
      if (brief) openBriefModal(brief);
    });

    document.getElementById('btn-add').addEventListener('click', () => openBriefModal(null));
    document.getElementById('btn-close-modal').addEventListener('click', closeBriefModal);
    document.getElementById('btn-close-settings').addEventListener('click', () => document.getElementById('modal-settings').classList.add('hidden'));

    document.getElementById('modal-brief').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeBriefModal(); });
    document.getElementById('modal-settings').addEventListener('click', (e) => { if (e.target === e.currentTarget) document.getElementById('modal-settings').classList.add('hidden'); });

    document.getElementById('brief-form').addEventListener('submit', async (e) => { e.preventDefault(); await saveBriefFromForm(); });

    document.getElementById('btn-delete-brief').addEventListener('click', async () => {
      const id = document.getElementById('f-id').value;
      if (id && confirm('Delete this brief? This cannot be undone.')) { await db.deleteBrief(id); closeBriefModal(); await renderBriefs(); toast('Brief deleted', 'warning'); }
    });

    document.getElementById('btn-sync').addEventListener('click', async () => {
      const result = await syncEngine.fullSync();
      if (result.success) { await renderAll(); toast('Synced \u2713 (' + result.pushed + ' pushed)', 'success'); }
      else if (result.reason === 'no_api_url') { toast('Set your Apps Script URL in Settings first', 'warning'); }
      else { toast('Sync failed \u2014 check your connection', 'error'); }
    });

    document.getElementById('btn-open-settings').addEventListener('click', () => document.getElementById('modal-settings').classList.remove('hidden'));
    document.getElementById('setting-api-url').addEventListener('change', (e) => { syncEngine.apiUrl = e.target.value.trim(); toast('API URL saved', 'success'); });
    document.getElementById('setting-sync-interval').addEventListener('change', (e) => {
      const minutes = parseInt(e.target.value); localStorage.setItem('fb_sync_interval', minutes);
      syncEngine.startAutoSync(minutes); toast('Auto-sync: ' + (minutes ? 'every ' + minutes + ' min' : 'disabled'), 'success');
    });

    document.getElementById('btn-clear-data').addEventListener('click', async () => { if (confirm('This will delete ALL local data. Are you sure?')) { await db.clearAll(); await renderAll(); toast('All local data cleared', 'warning'); } });

    document.getElementById('btn-export').addEventListener('click', async () => {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'flight-brief-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
      URL.revokeObjectURL(url); toast('Data exported', 'success');
    });

    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const text = await file.text(); const data = JSON.parse(text); await db.importAll(data); await renderAll(); toast('Data imported successfully', 'success'); }
      catch (err) { toast('Import failed: invalid file', 'error'); }
      e.target.value = '';
    });

    document.getElementById('f-origin').addEventListener('change', async (e) => {
      const icao = e.target.value.trim().toUpperCase(); if (icao.length !== 4) return;
      const airport = await db.getAirport(icao);
      if (airport) { const depProc = document.getElementById('f-dep-proc'); if (!depProc.value && airport.DepProceduresTemplate) depProc.value = airport.DepProceduresTemplate; toast('Loaded ' + (airport.AirportName || icao), 'success'); }
    });

    document.getElementById('f-dest').addEventListener('change', async (e) => {
      const icao = e.target.value.trim().toUpperCase(); if (icao.length !== 4) return;
      const airport = await db.getAirport(icao);
      if (airport) toast('Loaded ' + (airport.AirportName || icao), 'success');
    });

    window.addEventListener('online', () => { updateSyncStatus('online'); toast('Back online \u2014 syncing...', 'success'); syncEngine.fullSync().then(() => renderAll()); });
    window.addEventListener('offline', () => { updateSyncStatus('offline'); toast('You are offline \u2014 data saved locally', 'warning'); });

    updateSyncStatus(navigator.onLine ? 'online' : 'offline');
    syncEngine.onSyncStart = () => updateSyncStatus('syncing');
    syncEngine.onSyncEnd = () => updateSyncStatus('online');
    syncEngine.onSyncError = () => updateSyncStatus('offline');
  }

  function openBriefModal(brief) {
    const modal = document.getElementById('modal-brief');
    const title = document.getElementById('modal-title');
    const deleteBtn = document.getElementById('btn-delete-brief');
    if (brief) { title.textContent = 'Edit Brief'; deleteBtn.classList.remove('hidden'); populateForm(brief); }
    else { title.textContent = 'New Brief'; deleteBtn.classList.add('hidden'); clearForm(); document.getElementById('f-date').value = new Date().toISOString().slice(0, 10); }
    modal.classList.remove('hidden');
  }

  function closeBriefModal() { document.getElementById('modal-brief').classList.add('hidden'); }

  function populateForm(brief) {
    const fieldMap = [['f-id','Briefs ID'],['f-flight','Flight_Number'],['f-date','Date'],['f-origin','Origin'],['f-dest','Destination'],['f-route','RouteKey'],['f-sectors','Sectors'],['f-type','FlightType'],['f-dep-proc','DepProcedures'],['f-dep-freq','DepFrequency'],['f-dep-notes','DepNotes'],['f-enroute','EnrouteNotes'],['f-arr-rwy','ArrRunway'],['f-taxi','TaxiRoute'],['f-exp-taxi','ExpectedTaxi'],['f-gate','Gate'],['f-arr-freq','ArrFrequency'],['f-apt-notes','AirportNotes'],['f-transport','TransportTimeToHotel'],['f-hotel','HotelName'],['f-hotel-loc','HotelLocation'],['f-hotel-amen','HotelAmenities'],['f-hotel-notes','HotelNotes'],['f-city','City'],['f-country','CityCountry'],['f-tz','Timezone'],['f-todo','ThingsToDo'],['f-shopping','ShoppingAreas']];
    for (const [inputId, propName] of fieldMap) { const el = document.getElementById(inputId); if (el) el.value = brief[propName] || ''; }
  }

  function clearForm() { document.getElementById('brief-form').reset(); document.getElementById('f-id').value = ''; }

  async function saveBriefFromForm() {
    const brief = {};
    const fieldMap = [['f-id','Briefs ID'],['f-flight','Flight_Number'],['f-date','Date'],['f-origin','Origin'],['f-dest','Destination'],['f-route','RouteKey'],['f-sectors','Sectors'],['f-type','FlightType'],['f-dep-proc','DepProcedures'],['f-dep-freq','DepFrequency'],['f-dep-notes','DepNotes'],['f-enroute','EnrouteNotes'],['f-arr-rwy','ArrRunway'],['f-taxi','TaxiRoute'],['f-exp-taxi','ExpectedTaxi'],['f-gate','Gate'],['f-arr-freq','ArrFrequency'],['f-apt-notes','AirportNotes'],['f-transport','TransportTimeToHotel'],['f-hotel','HotelName'],['f-hotel-loc','HotelLocation'],['f-hotel-amen','HotelAmenities'],['f-hotel-notes','HotelNotes'],['f-city','City'],['f-country','CityCountry'],['f-tz','Timezone'],['f-todo','ThingsToDo'],['f-shopping','ShoppingAreas']];
    for (const [inputId, propName] of fieldMap) { const el = document.getElementById(inputId); if (el) brief[propName] = el.value.trim(); }
    await db.saveBrief(brief); closeBriefModal(); await renderBriefs(); toast('Brief saved \u2713', 'success');
    if (navigator.onLine && syncEngine.apiUrl) { syncEngine.fullSync().then(() => renderBriefs()); }
  }

  function updateSyncStatus(status) {
    const dot = document.getElementById('sync-status');
    dot.className = 'sync-dot ' + status;
    dot.title = { online: 'Synced', syncing: 'Syncing...', offline: 'Offline', stale: 'Unsynced changes' }[status] || '';
  }

  function toast(message, type = '') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = message; container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; el.style.transition = '0.3s ease'; setTimeout(() => el.remove(), 300); }, 3000);
  }

  function escapeHtml(str) { if (!str) return ''; const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
  function debounce(fn, ms) { let timer; return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); }; }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('[App] Service Worker registered:', reg.scope))
        .catch(err => console.warn('[App] SW registration failed:', err));
    }
  }
})();
