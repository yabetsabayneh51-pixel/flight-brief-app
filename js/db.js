/*
 * Flight Brief — IndexedDB Database Layer
 * 
 * WHY INDEXEDDB (not localStorage)?
 *  - localStorage is synchronous, limited to ~5MB, and blocks the UI thread
 *  - IndexedDB is async, handles 50MB+ easily, supports indexes for fast queries,
 *    and can store complex objects without JSON serialization overhead
 *  - For a data-heavy offline app, IndexedDB is the correct choice
 * 
 * Architecture:
 *  - One database: 'FlightBriefDB'
 *  - Four object stores (tables): briefs, airports, hotels, cities
 *  - Briefs have a 'dirty' flag: true when modified locally but not yet synced
 *  - All methods return Promises for clean async/await usage
 */

class FlightBriefDB {
  constructor() {
    // Database name — change this if you want to run multiple instances
    this.DB_NAME = 'FlightBriefDB';
    
    // Schema version — increment this when adding/removing stores or indexes
    // IndexedDB only runs upgrade() when the version increases
    this.DB_VERSION = 1;
    
    // The actual database connection (set after open())
    this.db = null;
  }

  /**
   * Opens (or creates) the database. Must be called before any other method.
   * 
   * The onupgradeneeded event fires ONLY when:
   *  - The database is created for the first time
   *  - The version number increases
   * 
   * This is where we define our "schema" — object stores and indexes.
   */
  open() {
    return new Promise((resolve, reject) => {
      // open() returns an IDBOpenDBRequest
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      // --- SCHEMA DEFINITION ---
      // This runs once when the DB is first created or version changes
      // --- SCHEMA DEFINITION ---
request.onupgradeneeded = (event) => {
  const db = event.target.result;

  // ----- BRIEFS STORE -----
  if (!db.objectStoreNames.contains('briefs')) {
    // FIX: IndexedDB keyPaths with spaces must be handled carefully. 
    // It is best to use underscores or camelCase, but since your sheet 
    // uses "Briefs ID", we must ensure it is defined as a single string.
    const briefsStore = db.createObjectStore('briefs', {
      keyPath: 'Briefs ID' 
    });
    
    briefsStore.createIndex('Flight_Number', 'Flight_Number', { unique: false });
    briefsStore.createIndex('Origin', 'Origin', { unique: false });
    briefsStore.createIndex('Destination', 'Destination', { unique: false });
    briefsStore.createIndex('Date', 'Date', { unique: false });
    briefsStore.createIndex('dirty', 'dirty', { unique: false });
  }

  // ----- AIRPORTS STORE -----
  if (!db.objectStoreNames.contains('airports')) {
    db.createObjectStore('airports', {
      keyPath: 'ICAO'
    });
    // Ensure "AirportName" matches your Sheet column exactly
    db.index('airports').createIndex('AirportName', 'AirportName', { unique: false });
  }

  // ----- HOTELS STORE -----
  if (!db.objectStoreNames.contains('hotels')) {
    db.createObjectStore('hotels', {
      keyPath: 'HotelName' 
    });
    db.index('hotels').createIndex('City', 'City', { unique: false });
  }

  // ----- CITIES STORE -----
  if (!db.objectStoreNames.contains('cities')) {
    db.createObjectStore('cities', {
      keyPath: 'City'
    });
    db.index('cities').createIndex('Country', 'Country', { unique: false });
  }

  console.log('[DB] Schema upgraded to version', this.DB_VERSION);
};

      // --- SUCCESS: store the connection ---
      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('[DB] Opened successfully');
        resolve(this.db);
      };

      // --- ERROR: reject the promise ---
      request.onerror = (event) => {
        console.error('[DB] Open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Generic helper: gets a transaction and object store.
   * 
   * In IndexedDB, ALL reads/writes must happen inside a transaction.
   * Transactions auto-commit when all requests complete.
   * 
   * @param {string} storeName - The object store name ('briefs', 'airports', etc.)
   * @param {string} mode - 'readonly' (default) or 'readwrite'
   * @returns {IDBObjectStore} - The store to perform operations on
   */
  _getStore(storeName, mode = 'readonly') {
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  // ==========================================
  // BRIEFS OPERATIONS
  // ==========================================

  /**
   * Get all briefs, sorted by date descending (newest first).
   * 
   * IndexedDB getAll() returns an array — we sort in memory because
   * IndexedDB cursors on indexes can't easily reverse-sort.
   */
  async getAllBriefs() {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs');
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort: newest date first, then by flight number
        const briefs = request.result.sort((a, b) => {
          const dateCompare = (b.Date || '').localeCompare(a.Date || '');
          if (dateCompare !== 0) return dateCompare;
          return (a.Flight_Number || '').localeCompare(b.Flight_Number || '');
        });
        resolve(briefs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a single brief by its ID.
   * 
   * @param {string} id - The 'Briefs ID' value
   * @returns {Object|null} - The brief object or null if not found
   */
  async getBrief(id) {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save (insert or update) a brief.
   * 
   * Key behaviors:
   *  1. If no 'Briefs ID' exists, generates one (timestamp-based)
   *  2. Sets 'dirty' = true so the sync engine knows to push it
   *  3. Sets 'LastUpdated' to current ISO timestamp
   *  4. Uses put() which inserts OR updates (upsert behavior)
   * 
   * @param {Object} brief - The brief data object
   * @returns {string} - The brief ID (useful for new briefs)
   */
  async saveBrief(brief) {
    return new Promise((resolve, reject) => {
      // Generate ID if this is a new brief
      if (!brief['Briefs ID']) {
        // Timestamp-based ID: ensures uniqueness across offline devices
        // Format: BR-{timestamp}-{random 4 chars}
        brief['Briefs ID'] = 'BR-' + Date.now() + '-' + 
          Math.random().toString(36).substring(2, 6).toUpperCase();
      }

      // Mark as dirty (needs sync) and set timestamp
      brief.dirty = true;
      brief.LastUpdated = new Date().toISOString();

      const store = this._getStore('briefs', 'readwrite');
      const request = store.put(brief);
      // put() = insert or update (unlike add() which fails on duplicates)

      request.onsuccess = () => resolve(brief['Briefs ID']);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a brief by ID.
   * 
   * For sync purposes, we could mark as "deleted" and sync the deletion.
   * For simplicity, this hard-deletes locally. If you need conflict-free
   * delete sync, add a 'deleted' flag and sync that.
   */
  async deleteBrief(id) {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all briefs modified locally (dirty = true).
   * These are the records the sync engine needs to push to Google Sheets.
   */
  async getDirtyBriefs() {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs');
      const index = store.index('dirty');
      // We store dirty as boolean true
      const request = index.getAll(true);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark a brief as clean (synced).
   * Called by the sync engine after successfully pushing to Google Sheets.
   */
  async markClean(id) {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs', 'readwrite');
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const brief = getRequest.result;
        if (brief) {
          brief.dirty = false;
          const putRequest = store.put(brief);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve(); // Brief was deleted, nothing to mark
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // ==========================================
  // REFERENCE DATA OPERATIONS (Airports, Hotels, Cities)
  // ==========================================
  // These are typically read-only for the pilot and synced FROM the sheet.
  // No 'dirty' flag needed — changes flow one direction.

  async getAllAirports() {
    return new Promise((resolve, reject) => {
      const store = this._getStore('airports');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Lookup a single airport by ICAO code.
   * Used for auto-filling departure/arrival fields in the brief form.
   */
  async getAirport(icao) {
    return new Promise((resolve, reject) => {
      const store = this._getStore('airports');
      const request = store.get(icao.toUpperCase());
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllHotels() {
    return new Promise((resolve, reject) => {
      const store = this._getStore('hotels');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllCities() {
    return new Promise((resolve, reject) => {
      const store = this._getStore('cities');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // BULK OPERATIONS (used by sync engine)
  // ==========================================

  /**
   * Bulk replace all records in a store.
   * Used when syncing FROM Google Sheets — we replace the entire
   * local cache with the sheet data to stay in sync.
   * 
   * @param {string} storeName - 'airports', 'hotels', or 'cities'
   * @param {Array} records - Array of objects to store
   */
  async bulkPut(storeName, records) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      // Clear existing data first (full replacement strategy)
      store.clear();

      // Add each record
      for (const record of records) {
        store.put(record);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Bulk sync briefs from the sheet.
   * Strategy: for each incoming brief, check if we have local edits.
   * If local is dirty, keep local. If not, take the server version.
   * 
   * This is a "last-write-wins" approach with local-edit protection.
   * For production, you'd want proper vector clocks or timestamps.
   */
  async syncBriefsFromSheet(serverBriefs) {
    return new Promise(async (resolve, reject) => {
      try {
        const tx = this.db.transaction('briefs', 'readwrite');
        const store = tx.objectStore('briefs');

        for (const serverBrief of serverBriefs) {
          const id = serverBrief['Briefs ID'];
          if (!id) continue; // Skip records without an ID

          // Check existing local record
          const getRequest = store.get(id);
          getRequest.onsuccess = () => {
            const localBrief = getRequest.result;
            
            if (localBrief && localBrief.dirty) {
              // Local has unsaved edits — don't overwrite.
              // The sync push will handle uploading local changes.
              console.log(`[DB] Skipping ${id} (local dirty)`);
            } else {
              // No local edits — take server version
              // Ensure dirty flag is false for sheet-sourced data
              serverBrief.dirty = false;
              store.put(serverBrief);
            }
          };
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  // ==========================================
  // MAINTENANCE
  // ==========================================

  /**
   * Delete all data from all stores.
   * Used by the "Clear All Data" button in settings.
   */
  async clearAll() {
    const stores = ['briefs', 'airports', 'hotels', 'cities'];
    for (const name of stores) {
      await new Promise((resolve, reject) => {
        const store = this._getStore(name, 'readwrite');
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
    console.log('[DB] All stores cleared');
  }

  /**
   * Export all data as a JSON object.
   * Used for backup / transfer between devices.
   */
  async exportAll() {
    return {
      briefs: await this.getAllBriefs(),
      airports: await this.getAllAirports(),
      hotels: await this.getAllHotels(),
      cities: await this.getAllCities(),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import data from a JSON object (from exportAll).
   */
  async importAll(data) {
    if (data.briefs) await this.bulkPut('briefs', data.briefs);
    if (data.airports) await this.bulkPut('airports', data.airports);
    if (data.hotels) await this.bulkPut('hotels', data.hotels);
    if (data.cities) await this.bulkPut('cities', data.cities);
    console.log('[DB] Import complete');
  }
}

// Create a global singleton — all modules share this one connection
const db = new FlightBriefDB();
