/*
 * Flight Brief — IndexedDB Database Layer
 *
 * WHY INDEXEDB (not localStorage)?
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
    this.DB_NAME = 'FlightBriefDB';
    this.DB_VERSION = 2;
    this.db = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('briefs')) {
          const briefsStore = db.createObjectStore('briefs', {
            keyPath: 'BriefsID'
          });
          briefsStore.createIndex('Flight_Number', 'Flight_Number', { unique: false });
          briefsStore.createIndex('Origin', 'Origin', { unique: false });
          briefsStore.createIndex('Destination', 'Destination', { unique: false });
          briefsStore.createIndex('Date', 'Date', { unique: false });
          briefsStore.createIndex('dirty', 'dirty', { unique: false });
        }

        if (!db.objectStoreNames.contains('airports')) {
          const airportsStore = db.createObjectStore('airports', {
            keyPath: 'ICAO'
          });
          airportsStore.createIndex('AirportName', 'AirportName', { unique: false });
        }

        if (!db.objectStoreNames.contains('hotels')) {
          const hotelsStore = db.createObjectStore('hotels', {
            keyPath: 'HotelName'
          });
          hotelsStore.createIndex('City', 'City', { unique: false });
        }

        if (!db.objectStoreNames.contains('cities')) {
          const citiesStore = db.createObjectStore('cities', {
            keyPath: 'City'
          });
          citiesStore.createIndex('Country', 'Country', { unique: false });
        }

        console.log('[DB] Schema upgraded to version', this.DB_VERSION);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('[DB] Opened successfully');
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[DB] Open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  _getStore(storeName, mode = 'readonly') {
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  async getAllBriefs() {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs');
      const request = store.getAll();
      request.onsuccess = () => {
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

  async getBrief(id) {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveBrief(brief) {
    return new Promise((resolve, reject) => {
      if (!brief.BriefsID) {
        brief.BriefsID = 'BR-' + Date.now() + '-' +
          Math.random().toString(36).substring(2, 6).toUpperCase();
      }
      brief.dirty = true;
      brief.LastUpdated = new Date().toISOString();
      const store = this._getStore('briefs', 'read
