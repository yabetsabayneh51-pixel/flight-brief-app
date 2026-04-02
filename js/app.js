/*
 * Flight Brief — Main Application Logic
 * 
 * This is the "glue" layer that connects:
 *  - The DOM (HTML) ↔ IndexedDB (db.js)
 *  - The UI events ↔ Sync Engine (sync.js)
 * 
 * Module pattern: everything runs inside an IIFE to avoid global pollution.
 * In a framework-based app, this would be split into components.
 */

(async function() {
  'use strict';

  // ==========================================
  // INITIALIZATION
  // ==========================================

  /**
   * App startup sequence:
   *  1. Open IndexedDB (must happen first — everything depends on it)
   *  2. Load settings from localStorage
   *  3. Render the initial UI
   *  4. Set up event listeners
   *  5. Register the service worker (for offline caching)
   *  6. Attempt initial sync if online
   */

  console.log('[App] Starting Flight Brief...');

  // Step 1: Open database
  await db.open();

  // Step 2: Load saved settings
  loadSettings();

  // Step 3: Render initial view
  await renderAll();

  // Step 4: Wire up all event listeners
  setupEventListeners();

  // Step 5: Register service worker for offline support
  registerServiceWorker();

  // Step 6: Try initial sync
  if (navigator.onLine && syncEngine.apiUrl) {
    // Delay slightly so the UI renders first
    setTimeout(() => syncEngine.fullSync(), 1000);
  }

  // ==========================================
  // SETTINGS
  // ==========================================

  /** Load settings from localStorage into the UI and sync engine */
  function loadSettings() {
    const apiUrl = localStorage.getItem('fb_api_url') || '';
    const syncInterval = localStorage.getItem('fb_sync_interval') || '15';

    document.getElementById('setting-api-url').value = apiUrl;
    document.getElementById('setting-sync-interval').value = syncInterval;

    syncEngine.apiUrl = apiUrl;
    syncEngine.startAutoSync(parseInt(syncInterval));
  }

  // ==========================================
  // RENDERING
  // ==========================================

  /** Render all data views from IndexedDB */
  async function renderAll() {
    await Promise.all([
      renderBriefs(),
      renderAirports(),
      renderHotels(),
      renderCities()
    ]);
  }

  /**
   * Render the briefs list.
   * Fetches all briefs from IndexedDB and creates card elements.
   */
  async function renderBriefs(filter = '') {
    const container = document.getElementById('briefs-list');
    const emptyState = document.getElementById('empty-briefs');
    const briefs = await db.getAllBriefs();

    // Apply search filter (case-insensitive, matches multiple fields)
    const filtered = filter
      ? briefs.filter(b => {
          const searchStr = [
            b.Flight_Number, b.Origin, b.Destination, 
            b.City, b.HotelName, b.RouteKey
          ].join(' ').toLowerCase();
          return searchStr.includes(filter.toLowerCase());
        })
      : briefs;

    // Show/hide empty state
    if (filtered.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    // Build cards using template literals (safe because we control the data)
    container.innerHTML = filtered.map(brief => {
      const id = brief['Briefs ID'] || '';
      const flight = brief.Flight_Number || '—';
      const origin = brief.Origin || '???';
      const dest = brief.Destination || '???';
      const date = brief.Date || '—';
      const type = brief.FlightType || '';
      const gate = brief.Gate || '';
      const rwy = brief.ArrRunway || '';
      const dirty = brief.dirty ? ' <span title="Unsynced changes">●</span>' : '';

      // Badge class: domestic=blue, international=purple
      const badgeClass = type.toLowerCase().includes('inter') ? 'international' : 'domestic';

      return `
        <div class="card" data-id="${escapeHtml(id)}">
          <div class="card-header">
            <span class="card-title">${escapeHtml(flight)}${dirty}</span>
            ${type ? `<span class="card-badge ${badgeClass}">${escapeHtml(type)}</span>` : ''}
          </div>
          <div class="card-route">${escapeHtml(origin)} → ${escapeHtml(dest)}</div>
          <div class="card-meta">
            <span>📅 ${escapeHtml(date)}</span>
            ${gate ? `<span>🚪 Gate ${escapeHtml(gate)}</span>` : ''}
            ${rwy ? `<span>🛬 RWY ${escapeHtml(rwy)}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  /** Render airports reference list */
  async function renderAirports(filter = '') {
    const container = document.getElementById('airports-list');
    let airports = await db.getAllAirports();

    if (filter) {
      airports = airports.filter(a => {
        const s = [a.ICAO, a.AirportName].join(' ').toLowerCase();
        return s.includes(filter.toLowerCase());
      });
    }

    container.innerHTML = airports.map(a => `
      <div class="ref-card">
        <h3>${escapeHtml(a.ICAO || '—')}</h3>
        <p><strong>${escapeHtml(a.AirportName || '')}</strong></p>
        ${a.DepProceduresTemplate ? `
          <div class="ref-field">
            <span class="ref-label">Departure Procedures</span>
            <p>${escapeHtml(a.DepProceduresTemplate)}</p>
          </div>` : ''}
        ${a.ArrProceduresTemplate ? `
          <div class="ref-field">
            <span class="ref-label">Arrival Procedures</span>
            <p>${escapeHtml(a.ArrProceduresTemplate)}</p>
          </div>` : ''}
        ${a.GeneralNotes ? `
          <div class="ref-field">
            <span class="ref-label">Notes</span>
            <p>${escapeHtml(a.GeneralNotes)}</p>
          </div>` : ''}
      </div>
    `).join('') || '<div class="empty-state"><p>No airports loaded. Sync from Google Sheets.</p></div>';
  }

  /** Render hotels reference list */
  async function renderHotels(filter = '') {
    const container = document.getElementById('hotels-list');
    let hotels = await db.getAllHotels();

    if (filter) {
      hotels = hotels.filter(h => {
        const s = [h.HotelName, h.City, h.Location].join(' ').toLowerCase();
        return s.includes(filter.toLowerCase());
      });
    }

    container.innerHTML = hotels.map(h => `
      <div class="ref-card">
        <h3>${escapeHtml(h.HotelName || '—')}</h3>
        <p>${escapeHtml(h.City || '')}${h.Location ? ' · ' + escapeHtml(h.Location) : ''}</p>
        ${h.Amenities ? `
          <div class="ref-field">
            <span class="ref-label">Amenities</span>
            <p>${escapeHtml(h.Amenities)}</p>
          </div>` : ''}
        ${h.Notes ? `
          <div class="ref-field">
            <span class="ref-label">Notes</span>
            <p>${escapeHtml(h.Notes)}</p>
          </div>` : ''}
      </div>
    `).join('') || '<div class="empty-state"><p>No hotels loaded. Sync from Google Sheets.</p></div>';
  }

  /** Render cities reference list */
  async function renderCities(filter = '') {
    const container = document.getElementById('cities-list');
    let cities = await db.getAllCities();

    if (filter) {
      cities = cities.filter(c => {
        const s = [c.City, c.Country].join(' ').toLowerCase();
        return s.includes(filter.toLowerCase());
      });
    }

    container.innerHTML = cities.map(c => `
      <div class="ref-card">
        <h3>${escapeHtml(c.City || '—')}</h3>
        <p>${escapeHtml(c.Country || '')}${c.Timezone ? ' · ' + escapeHtml(c.Timezone) : ''}</p>
        ${c.ThingsToDo ? `
          <div class="ref-field">
            <span class="ref-label">Things To Do</span>
            <p>${escapeHtml(c.ThingsToDo)}</p>
          </div>` : ''}
        ${c.ShoppingAreas ? `
          <div class="ref-field">
            <span class="ref-label">Shopping</span>
            <p>${escapeHtml(c.ShoppingAreas)}</p>
          </div>` : ''}
      </div>
    `).join('') || '<div class="empty-state"><p>No cities loaded. Sync from Google Sheets.</p></div>';
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================

  function setupEventListeners() {
    // --- Tab switching ---
    // Each tab button has data-tab="briefs|airports|hotels|cities"
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active from all tabs and views
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        
        // Activate clicked tab and corresponding view
        tab.classList.add('active');
        const viewId = 'view-' + tab.dataset.tab;
        document.getElementById(viewId).classList.add('active');
      });
    });

    // --- Search inputs ---
    // Debounced search: waits 300ms after last keystroke before filtering
    // Prevents hammering IndexedDB on every keypress
    document.getElementById('search-briefs').addEventListener('input', 
      debounce((e) => renderBriefs(e.target.value), 300));
    document.getElementById('search-airports').addEventListener('input',
      debounce((e) => renderAirports(e.target.value), 300));
    document.getElementById('search-hotels').addEventListener('input',
      debounce((e) => renderHotels(e.target.value), 300));
    document.getElementById('search-cities').addEventListener('input',
      debounce((e) => renderCities(e.target.value), 300));

    // --- Brief card click → open edit modal ---
    document.getElementById('briefs-list').addEventListener('click', async (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const id = card.dataset.id;
      const brief = await db.getBrief(id);
      if (brief) openBriefModal(brief);
    });

    // --- New Brief button ---
    document.getElementById('btn-add').addEventListener('click', () => {
      openBriefModal(null);  // null = new brief (empty form)
    });

    // --- Close modal buttons ---
    document.getElementById('btn-close-modal').addEventListener('click', closeBriefModal);
    document.getElementById('btn-close-settings').addEventListener('click', () => {
      document.getElementById('modal-settings').classList.add('hidden');
    });

    // Click outside modal to close
    document.getElementById('modal-brief').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeBriefModal();
    });
    document.getElementById('modal-settings').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('modal-settings').classList.add('hidden');
      }
    });

    // --- Brief form submission ---
    document.getElementById('brief-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveBriefFromForm();
    });

    // --- Delete brief button ---
    document.getElementById('btn-delete-brief').addEventListener('click', async () => {
      const id = document.getElementById('f-id').value;
      if (id && confirm('Delete this brief? This cannot be undone.')) {
        await db.deleteBrief(id);
        closeBriefModal();
        await renderBriefs();
        toast('Brief deleted', 'warning');
      }
    });

    // --- Sync button ---
    document.getElementById('btn-sync').addEventListener('click', async () => {
      const result = await syncEngine.fullSync();
      if (result.success) {
        await renderAll();
        toast(`Synced ✓ (${result.pushed} pushed)`, 'success');
      } else if (result.reason === 'no_api_url') {
        toast('Set your Apps Script URL in Settings first', 'warning');
      } else {
        toast('Sync failed — check your connection', 'error');
      }
    });

    // --- Settings button ---
    document.getElementById('btn-open-settings').addEventListener('click', () => {
      document.getElementById('modal-settings').classList.remove('hidden');
    });

    // --- Settings: API URL ---
    document.getElementById('setting-api-url').addEventListener('change', (e) => {
      syncEngine.apiUrl = e.target.value.trim();
      toast('API URL saved', 'success');
    });

    // --- Settings: Sync interval ---
    document.getElementById('setting-sync-interval').addEventListener('change', (e) => {
      const minutes = parseInt(e.target.value);
      localStorage.setItem('fb_sync_interval', minutes);
      syncEngine.startAutoSync(minutes);
      toast(`Auto-sync: ${minutes ? 'every ' + minutes + ' min' : 'disabled'}`, 'success');
    });

    // --- Settings: Clear data ---
    document.getElementById('btn-clear-data').addEventListener('click', async () => {
      if (confirm('This will delete ALL local data. Are you sure?')) {
        await db.clearAll();
        await renderAll();
        toast('All local data cleared', 'warning');
      }
    });

    // --- Settings: Export ---
    document.getElementById('btn-export').addEventListener('click', async () => {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flight-brief-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Data exported', 'success');
    });

    // --- Settings: Import ---
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await db.importAll(data);
        await renderAll();
        toast('Data imported successfully', 'success');
      } catch (err) {
        toast('Import failed: invalid file', 'error');
      }
      e.target.value = '';  // Reset file input
    });

    // --- Auto-fill airport fields when origin/dest changes ---
    // This looks up the ICAO code in the local DB and pre-fills departure
    // and arrival procedures if a template exists
    document.getElementById('f-origin').addEventListener('change', async (e) => {
      const icao = e.target.value.trim().toUpperCase();
      if (icao.length !== 4) return;
      const airport = await db.getAirport(icao);
      if (airport) {
        // Only fill if the field is currently empty (don't overwrite user edits)
        const depProc = document.getElementById('f-dep-proc');
        if (!depProc.value && airport.DepProceduresTemplate) {
          depProc.value = airport.DepProceduresTemplate;
        }
        toast(`Loaded ${airport.AirportName || icao}`, 'success');
      }
    });

    document.getElementById('f-dest').addEventListener('change', async (e) => {
      const icao = e.target.value.trim().toUpperCase();
      if (icao.length !== 4) return;
      const airport = await db.getAirport(icao);
      if (airport) {
        // Auto-fill arrival runway and taxi if template exists
        // (You can customize this based on what's in your Airports sheet)
        toast(`Loaded ${airport.AirportName || icao}`, 'success');
      }
    });

    // --- Online/Offline detection ---
    // Update the sync status dot when network state changes
    window.addEventListener('online', () => {
      updateSyncStatus('online');
      toast('Back online — syncing...', 'success');
      syncEngine.fullSync().then(() => renderAll());
    });
    window.addEventListener('offline', () => {
      updateSyncStatus('offline');
      toast('You are offline — data saved locally', 'warning');
    });

    // Set initial online status
    updateSyncStatus(navigator.onLine ? 'online' : 'offline');

    // --- Sync engine callbacks ---
    syncEngine.onSyncStart = () => updateSyncStatus('syncing');
    syncEngine.onSyncEnd = () => updateSyncStatus('online');
    syncEngine.onSyncError = () => updateSyncStatus('offline');
  }

  // ==========================================
  // BRIEF MODAL
  // ==========================================

  /**
   * Open the brief form modal.
   * If a brief is provided, populates the form for editing.
   * If null, shows an empty form for creating a new brief.
   */
  function openBriefModal(brief) {
    const modal = document.getElementById('modal-brief');
    const title = document.getElementById('modal-title');
    const deleteBtn = document.getElementById('btn-delete-brief');

    if (brief) {
      title.textContent = 'Edit Brief';
      deleteBtn.classList.remove('hidden');
      populateForm(brief);
    } else {
      title.textContent = 'New Brief';
      deleteBtn.classList.add('hidden');
      clearForm();
      // Default date to today
      document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);
    }

    modal.classList.remove('hidden');
  }

  function closeBriefModal() {
    document.getElementById('modal-brief').classList.add('hidden');
  }

  /**
   * Populate the form fields from a brief object.
   * Maps each column name from the Google Sheet to its form input.
   */
  function populateForm(brief) {
    // Field mapping: [form input ID, brief property name]
    const fieldMap = [
      ['f-id', 'Briefs ID'],
      ['f-flight', 'Flight_Number'],
      ['f-date', 'Date'],
      ['f-origin', 'Origin'],
      ['f-dest', 'Destination'],
      ['f-route', 'RouteKey'],
      ['f-sectors', 'Sectors'],
      ['f-type', 'FlightType'],
      ['f-dep-proc', 'DepProcedures'],
      ['f-dep-freq', 'DepFrequency'],
      ['f-dep-notes', 'DepNotes'],
      ['f-enroute', 'EnrouteNotes'],
      ['f-arr-rwy', 'ArrRunway'],
      ['f-taxi', 'TaxiRoute'],
      ['f-exp-taxi', 'ExpectedTaxi'],
      ['f-gate', 'Gate'],
      ['f-arr-freq', 'ArrFrequency'],
      ['f-apt-notes', 'AirportNotes'],
      ['f-transport', 'TransportTimeToHotel'],
      ['f-hotel', 'HotelName'],
      ['f-hotel-loc', 'HotelLocation'],
      ['f-hotel-amen', 'HotelAmenities'],
      ['f-hotel-notes', 'HotelNotes'],
      ['f-city', 'City'],
      ['f-country', 'CityCountry'],
      ['f-tz', 'Timezone'],
      ['f-todo', 'ThingsToDo'],
      ['f-shopping', 'ShoppingAreas'],
    ];

    for (const [inputId, propName] of fieldMap) {
      const el = document.getElementById(inputId);
      if (el) el.value = brief[propName] || '';
    }
  }

  /** Clear all form fields */
  function clearForm() {
    document.getElementById('brief-form').reset();
    document.getElementById('f-id').value = '';
  }

  /**
   * Read form fields and save to IndexedDB.
   * Maps form input IDs back to Google Sheet column names.
   */
  async function saveBriefFromForm() {
    const brief = {};
    const fieldMap = [
      ['f-id', 'Briefs ID'],
      ['f-flight', 'Flight_Number'],
      ['f-date', 'Date'],
      ['f-origin', 'Origin'],
      ['f-dest', 'Destination'],
      ['f-route', 'RouteKey'],
      ['f-sectors', 'Sectors'],
      ['f-type', 'FlightType'],
      ['f-dep-proc', 'DepProcedures'],
      ['f-dep-freq', 'DepFrequency'],
      ['f-dep-notes', 'DepNotes'],
      ['f-enroute', 'EnrouteNotes'],
      ['f-arr-rwy', 'ArrRunway'],
      ['f-taxi', 'TaxiRoute'],
      ['f-exp-taxi', 'ExpectedTaxi'],
      ['f-gate', 'Gate'],
      ['f-arr-freq', 'ArrFrequency'],
      ['f-apt-notes', 'AirportNotes'],
      ['f-transport', 'TransportTimeToHotel'],
      ['f-hotel', 'HotelName'],
      ['f-hotel-loc', 'HotelLocation'],
      ['f-hotel-amen', 'HotelAmenities'],
      ['f-hotel-notes', 'HotelNotes'],
      ['f-city', 'City'],
      ['f-country', 'CityCountry'],
      ['f-tz', 'Timezone'],
      ['f-todo', 'ThingsToDo'],
      ['f-shopping', 'ShoppingAreas'],
    ];

    for (const [inputId, propName] of fieldMap) {
      const el = document.getElementById(inputId);
      if (el) brief[propName] = el.value.trim();
    }

    // Save to IndexedDB (generates ID if new)
    await db.saveBrief(brief);
    closeBriefModal();
    await renderBriefs();
    toast('Brief saved ✓', 'success');

    // Try to sync immediately if online
    if (navigator.onLine && syncEngine.apiUrl) {
      syncEngine.fullSync().then(() => renderBriefs());
    }
  }

  // ==========================================
  // UI UTILITIES
  // ==========================================

  /**
   * Update the sync status dot color.
   * @param {'online'|'syncing'|'offline'|'stale'} status
   */
  function updateSyncStatus(status) {
    const dot = document.getElementById('sync-status');
    dot.className = 'sync-dot ' + status;
    const titles = {
      online: 'Synced',
      syncing: 'Syncing...',
      offline: 'Offline',
      stale: 'Unsynced changes'
    };
    dot.title = titles[status] || '';
  }

  /**
   * Show a toast notification.
   * Auto-dismisses after 3 seconds.
   * 
   * @param {string} message - The notification text
   * @param {'success'|'error'|'warning'} type - Visual style
   */
  function toast(message, type = '') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(100%)';
      el.style.transition = '0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  /**
   * Escape HTML to prevent XSS.
   * IMPORTANT: even though we control the data, always escape for safety.
   * 
   * @param {string} str - Raw string
   * @returns {string} - HTML-safe string
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Debounce utility: delays function execution until after `ms` milliseconds
   * of inactivity. Used for search inputs to avoid excessive DB queries.
   * 
   * @param {Function} fn - Function to debounce
   * @param {number} ms - Delay in milliseconds
   * @returns {Function} - Debounced function
   */
  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ==========================================
  // SERVICE WORKER REGISTRATION
  // ==========================================

  /**
   * Register the service worker for offline caching.
   * 
   * The service worker (sw.js) intercepts network requests and:
   *  - Serves cached files when offline
   *  - Caches new files as they're fetched
   *  - Makes the app work completely offline after the first visit
   */
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('[App] Service Worker registered:', reg.scope))
        .catch(err => console.warn('[App] SW registration failed:', err));
    }
  }

})();
