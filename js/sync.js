class SyncEngine {
  constructor() {
    this._intervalHandle = null;
    this._syncing = false;
    this.onSyncStart = null;
    this.onSyncEnd = null;
    this.onSyncError = null;
  }
  get apiUrl() { return localStorage.getItem('fb_api_url') || ''; }
  set apiUrl(url) { localStorage.setItem('fb_api_url', url); }

  async fullSync() {
    if (this._syncing) { console.log('[Sync] Already syncing, skipping'); return { success: false, reason: 'already_syncing' }; }
    if (!this.apiUrl) { console.log('[Sync] No API URL configured'); return { success: false, reason: 'no_api_url' }; }
    this._syncing = true;
    this.onSyncStart?.();
    let result = { success: false, pushed: 0, pulled: false };
    try {
      const pushResult = await this._pushDirtyBriefs(); result.pushed = pushResult.pushed;
      const pullResult = await this._pullFromSheet(); result.pulled = pullResult.pulled;
      result.success = true; this.onSyncEnd?.(result);
    } catch (error) { console.error('[Sync] Error:', error); result.error = error.message; this.onSyncError?.(error); }
    finally { this._syncing = false; }
    return result;
  }

  async _pushDirtyBriefs() {
    const dirtyBriefs = await db.getDirtyBriefs();
    if (dirtyBriefs.length === 0) { console.log('[Sync] No dirty briefs to push'); return { pushed: 0 }; }
    console.log('[Sync] Pushing ' + dirtyBriefs.length + ' dirty brief(s)');
    const cleanPayload = dirtyBriefs.map(brief => { const copy = { ...brief }; delete copy.dirty; return copy; });
    const response = await fetch(this.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'push', briefs: cleanPayload }) });
    if (!response.ok) throw new Error('Push failed: HTTP ' + response.status);
    const result = await response.json();
    if (!result.success) throw new Error('Push rejected: ' + (result.error || 'Unknown error'));
    for (const brief of dirtyBriefs) { await db.markClean(brief[''BriefsID'']); }
    console.log('[Sync] Pushed ' + dirtyBriefs.length + ' brief(s)');
    return { pushed: dirtyBriefs.length };
  }

  async _pullFromSheet() {
    console.log('[Sync] Pulling from sheet...');
    const response = await fetch(this.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pull' }) });
    if (!response.ok) throw new Error('Pull failed: HTTP ' + response.status);
    const data = await response.json();
    if (!data.success) throw new Error('Pull rejected: ' + (data.error || 'Unknown error'));
    if (data.airports) { await db.bulkPut('airports', data.airports); console.log('[Sync] Pulled ' + data.airports.length + ' airport(s)'); }
    if (data.hotels) { await db.bulkPut('hotels', data.hotels); console.log('[Sync] Pulled ' + data.hotels.length + ' hotel(s)'); }
    if (data.cities) { await db.bulkPut('cities', data.cities); console.log('[Sync] Pulled ' + data.cities.length + ' cities'); }
    if (data.briefs) { const mappedBriefs = data.briefs.map(b => {
  if (b['Briefs ID'] && !b.BriefsID) {
    b.BriefsID = b['Briefs ID'];
    delete b['Briefs ID'];
  }
  return b;
});
await db.syncBriefsFromSheet(mappedBriefs);; console.log('[Sync] Pulled ' + data.briefs.length + ' brief(s)'); }
    return { pulled: true };
  }

  startAutoSync(minutes) {
    this.stopAutoSync();
    if (!minutes || minutes <= 0) return;
    const ms = minutes * 60 * 1000;
    console.log('[Sync] Auto-sync every ' + minutes + ' min');
    this._intervalHandle = setInterval(() => { if (navigator.onLine) { this.fullSync(); } }, ms);
  }

  stopAutoSync() { if (this._intervalHandle) { clearInterval(this._intervalHandle); this._intervalHandle = null; } }
}

const syncEngine = new SyncEngine();
