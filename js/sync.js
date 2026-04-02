/*
 * Flight Brief — Sync Engine
 * 
 * Handles bidirectional sync between local IndexedDB and Google Sheets.
 * 
 * SYNC STRATEGY:
 * 
 *   PULL (Sheet → Device):
 *     1. Fetch all data from the Google Sheet via Apps Script
 *     2. Replace local reference data (airports, hotels, cities) — one-way
 *     3. Merge briefs: keep local edits (dirty=true), take server for rest
 * 
 *   PUSH (Device → Sheet):
 *     1. Query all local briefs with dirty=true
 *     2. Send them to Apps Script, which writes to the Sheet
 *     3. Mark them as clean (dirty=false) on success
 * 
 *   CONFLICT RESOLUTION:
 *     Simple last-write-wins with local-edit protection.
 *     If a brief is dirty locally, the server version is ignored during pull.
 *     On push, the local version overwrites the server.
 * 
 *   OFFLINE HANDLING:
 *     - All reads come from IndexedDB (always works)
 *     - Sync attempts fail silently when offline
 *     - A sync timer retries periodically
 *     - Manual sync button available for user-initiated sync
 * 
 * GOOGLE APPS SCRIPT SETUP:
 *   You need a deployed Google Apps Script that:
 *   1. Reads from your Google Sheet
 *   2. Accepts POST requests with brief data
 *   3. Is deployed as a Web App with "Anyone" access
 *   See the setup guide for the Apps Script code.
 */

class SyncEngine {
  constructor() {
    // Auto-sync interval handle (set/cleared by startAutoSync/stopAutoSync)
    this._intervalHandle = null;
    
    // Prevents overlapping sync calls
    this._syncing = false;
    
    // Callbacks for UI updates — app.js registers these
    this.onSyncStart = null;
    this.onSyncEnd = null;
    this.onSyncError = null;
  }

  /**
   * Get the Google Apps Script URL from settings.
   * Stored in localStorage for persistence across sessions.
   */
  get apiUrl() {
    return localStorage.getItem('fb_api_url') || '';
  }

  set apiUrl(url) {
    localStorage.setItem('fb_api_url', url);
  }

  // ==========================================
  // MAIN SYNC: bidirectional sync
  // ==========================================

  /**
   * Perform a full bidirectional sync.
   * 
   * Flow:
   *   1. PUSH local changes first (so local edits aren't overwritten)
   *   2. PULL server data (merging with local)
   *   3. Update UI with fresh data
   * 
   * @returns {Object} - { success: boolean, pushed: number, pulled: boolean }
   */
  async fullSync() {
    // Guard: don't run overlapping syncs
    if (this._syncing) {
      console.log('[Sync] Already syncing, skipping');
      return { success: false, reason: 'already_syncing' };
    }

    // Guard: no API URL configured
    if (!this.apiUrl) {
      console.log('[Sync] No API URL configured');
      return { success: false, reason: 'no_api_url' };
    }

    this._syncing = true;
    this.onSyncStart?.();  // Notify UI: show "syncing" state

    let result = { success: false, pushed: 0, pulled: false };

    try {
      // --- STEP 1: PUSH local changes ---
      const pushResult = await this._pushDirtyBriefs();
      result.pushed = pushResult.pushed;

      // --- STEP 2: PULL from sheet ---
      const pullResult = await this._pullFromSheet();
      result.pulled = pullResult.pulled;

      result.success = true;
      this.onSyncEnd?.(result);  // Notify UI: show "synced" state
    } catch (error) {
      console.error('[Sync] Error:', error);
      result.error = error.message;
      this.onSyncError?.(error);  // Notify UI: show error state
    } finally {
      this._syncing = false;
    }

    return result;
  }

  // ==========================================
  // PUSH: send dirty briefs to Google Sheet
  // ==========================================

  /**
   * Find all briefs marked dirty and upload them to Google Sheets.
   * 
   * The Apps Script receives a POST with:
   *   { action: 'push', briefs: [...] }
   * 
   * On success, we mark each brief as clean locally.
   */
  async _pushDirtyBriefs() {
    const dirtyBriefs = await db.getDirtyBriefs();

    if (dirtyBriefs.length === 0) {
      console.log('[Sync] No dirty briefs to push');
      return { pushed: 0 };
    }

    console.log(`[Sync] Pushing ${dirtyBriefs.length} dirty brief(s)`);

    // Strip the internal 'dirty' flag before sending to the sheet
    // (the sheet doesn't need or understand this field)
    const cleanPayload = dirtyBriefs.map(brief => {
      const copy = { ...brief };
      delete copy.dirty;
      return copy;
    });

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      // mode: 'no-cors' won't work for reading responses, so we use default
      // The Apps Script must have CORS headers set (it does by default)
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'push',       // Tells the script what operation to perform
        briefs: cleanPayload  // The brief data to write
      })
    });

    if (!response.ok) {
      throw new Error(`Push failed: HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(`Push rejected: ${result.error || 'Unknown error'}`);
    }

    // Mark all successfully pushed briefs as clean
    for (const brief of dirtyBriefs) {
      await db.markClean(brief['Briefs ID']);
    }

    console.log(`[Sync] Pushed ${dirtyBriefs.length} brief(s)`);
    return { pushed: dirtyBriefs.length };
  }

  // ==========================================
  // PULL: fetch data from Google Sheet
  // ==========================================

  /**
   * Fetch all data from the Google Sheet and update local DB.
   * 
   * The Apps Script receives a POST with:
   *   { action: 'pull' }
   * 
   * And returns:
   *   { success: true, briefs: [...], airports: [...], hotels: [...], cities: [...] }
   */
  async _pullFromSheet() {
    console.log('[Sync] Pulling from sheet...');

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pull' })
    });

    if (!response.ok) {
      throw new Error(`Pull failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(`Pull rejected: ${data.error || 'Unknown error'}`);
    }

    // Update reference data (one-way: sheet is source of truth)
    if (data.airports) {
      await db.bulkPut('airports', data.airports);
      console.log(`[Sync] Pulled ${data.airports.length} airport(s)`);
    }
    if (data.hotels) {
      await db.bulkPut('hotels', data.hotels);
      console.log(`[Sync] Pulled ${data.hotels.length} hotel(s)`);
    }
    if (data.cities) {
      await db.bulkPut('cities', data.cities);
      console.log(`[Sync] Pulled ${data.cities.length} cities`);
    }

    // Merge briefs (protects local dirty edits)
    if (data.briefs) {
      await db.syncBriefsFromSheet(data.briefs);
      console.log(`[Sync] Pulled ${data.briefs.length} brief(s)`);
    }

    return { pulled: true };
  }

  // ==========================================
  // AUTO-SYNC TIMER
  // ==========================================

  /**
   * Start periodic auto-sync.
   * 
   * @param {number} minutes - Interval in minutes (0 = disabled)
   */
  startAutoSync(minutes) {
    this.stopAutoSync();  // Clear any existing timer first

    if (!minutes || minutes <= 0) return;

    const ms = minutes * 60 * 1000;
    console.log(`[Sync] Auto-sync every ${minutes} min`);

    this._intervalHandle = setInterval(() => {
      // Only sync if online
      if (navigator.onLine) {
        this.fullSync();
      }
    }, ms);
  }

  /**
   * Stop auto-sync timer.
   */
  stopAutoSync() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }
}

// Global singleton
const syncEngine = new SyncEngine();
