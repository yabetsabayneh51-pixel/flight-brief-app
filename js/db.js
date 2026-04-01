class FlightBriefDB {
  constructor() {
    this.DB_NAME = 'FlightBriefDB';
    this.DB_VERSION = 1;
    this.db = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('briefs')) {
          const briefsStore = db.createObjectStore('briefs', { keyPath: 'BriefsID' });
          briefsStore.createIndex('Flight_Number', 'Flight_Number', { unique: false });
          briefsStore.createIndex('Origin', 'Origin', { unique: false });
          briefsStore.createIndex('Destination', 'Destination', { unique: false });
          briefsStore.createIndex('Date', 'Date', { unique: false });
          briefsStore.createIndex('dirty', 'dirty', { unique: false });
        }
        if (!db.objectStoreNames.contains('airports')) {
          const airportsStore = db.createObjectStore('airports', { keyPath: 'ICAO' });
          airportsStore.createIndex('AirportName', 'AirportName', { unique: false });
        }
        if (!db.objectStoreNames.contains('hotels')) {
          const hotelsStore = db.createObjectStore('hotels', { keyPath: 'HotelName' });
          hotelsStore.createIndex('City', 'City', { unique: false });
        }
        if (!db.objectStoreNames.contains('cities')) {
          const citiesStore = db.createObjectStore('cities', { keyPath: 'City' });
          citiesStore.createIndex('Country', 'Country', { unique: false });
        }
        console.log('[DB] Schema upgraded to version', this.DB_VERSION);
      };
      request.onsuccess = (event) => { this.db = event.target.result; console.log('[DB] Opened successfully'); resolve(this.db); };
      request.onerror = (event) => { console.error('[DB] Open error:', event.target.error); reject(event.target.error); };
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
      if (!brief[''BriefsID'']) {
        brief[''BriefsID''] = 'BR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      }
      brief.dirty = true;
      brief.LastUpdated = new Date().toISOString();
      const store = this._getStore('briefs', 'readwrite');
      const request = store.put(brief);
      request.onsuccess = () => resolve(brief[''BriefsID'']);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteBrief(id) {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getDirtyBriefs() {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs');
      const index = store.index('dirty');
      const request = index.getAll(true);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async markClean(id) {
    return new Promise((resolve, reject) => {
      const store = this._getStore('briefs', 'readwrite');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const brief = getRequest.result;
        if (brief) { brief.dirty = false; const putRequest = store.put(brief); putRequest.onsuccess = () => resolve(); putRequest.onerror = () => reject(putRequest.error); }
        else { resolve(); }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async getAllAirports() { return new Promise((resolve, reject) => { const store = this._getStore('airports'); const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async getAirport(icao) { return new Promise((resolve, reject) => { const store = this._getStore('airports'); const request = store.get(icao.toUpperCase()); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); }); }
  async getAllHotels() { return new Promise((resolve, reject) => { const store = this._getStore('hotels'); const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async getAllCities() { return new Promise((resolve, reject) => { const store = this._getStore('cities'); const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }

  async bulkPut(storeName, records) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      for (const record of records) { store.put(record); }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async syncBriefsFromSheet(serverBriefs) {
    return new Promise(async (resolve, reject) => {
      try {
        const tx = this.db.transaction('briefs', 'readwrite');
        const store = tx.objectStore('briefs');
        for (const serverBrief of serverBriefs) {
          const id = serverBrief[''BriefsID''];
          if (!id) continue;
          const getRequest = store.get(id);
          getRequest.onsuccess = () => {
            const localBrief = getRequest.result;
            if (localBrief && localBrief.dirty) { console.log('[DB] Skipping ' + id + ' (local dirty)'); }
            else { serverBrief.dirty = false; store.put(serverBrief); }
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (err) { reject(err); }
    });
  }

  async clearAll() {
    const stores = ['briefs', 'airports', 'hotels', 'cities'];
    for (const name of stores) {
      await new Promise((resolve, reject) => { const store = this._getStore(name, 'readwrite'); const request = store.clear(); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    }
    console.log('[DB] All stores cleared');
  }

  async exportAll() { return { briefs: await this.getAllBriefs(), airports: await this.getAllAirports(), hotels: await this.getAllHotels(), cities: await this.getAllCities(), exportedAt: new Date().toISOString() }; }
  async importAll(data) { if (data.briefs) await this.bulkPut('briefs', data.briefs); if (data.airports) await this.bulkPut('airports', data.airports); if (data.hotels) await this.bulkPut('hotels', data.hotels); if (data.cities) await this.bulkPut('cities', data.cities); console.log('[DB] Import complete'); }
}

const db = new FlightBriefDB();
