/*************************************************
 * CrewBriefs Offline Database (IndexedDB)
 * Version: Stable Build
 *************************************************/

class FlightBriefDB {

  constructor() {
    this.DB_NAME = "FlightBriefDB";
    this.DB_VERSION = 2; // incremented for safe upgrades
    this.db = null;

    // initialization gate
    this.ready = this.open();
  }

  /*************************************************
   * OPEN DATABASE
   *************************************************/
  open() {
    return new Promise((resolve, reject) => {

      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        console.log("[DB] Creating/Upgrading schema");

        // BRIEFS
        if (!db.objectStoreNames.contains("briefs")) {
          const briefs = db.createObjectStore("briefs", { keyPath: "id" });
          briefs.createIndex("date", "Date", { unique: false });
        }

        // AIRPORTS
        if (!db.objectStoreNames.contains("airports")) {
          db.createObjectStore("airports", { keyPath: "icao" });
        }

        // HOTELS
        if (!db.objectStoreNames.contains("hotels")) {
          db.createObjectStore("hotels", { keyPath: "id", autoIncrement: true });
        }

        // META STORE
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;

        this.db.onversionchange = () => {
          this.db.close();
          alert("Database updated. Please reload the app.");
        };

        console.log("[DB] Connected");
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /*************************************************
   * INTERNAL STORE ACCESS
   *************************************************/
  async _getStore(storeName, mode = "readonly") {
    await this.ready;

    if (!this.db) {
      throw new Error("[DB] Not initialized");
    }

    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  /*************************************************
   * SAVE BRIEF
   *************************************************/
  async saveBrief(brief) {
    const store = await this._getStore("briefs", "readwrite");

    return new Promise((resolve, reject) => {

      brief.id = brief.id || crypto.randomUUID();
      brief.updatedAt = Date.now();
      brief.dirty = true;

      const request = store.put(brief);

      request.onsuccess = () => resolve(brief);
      request.onerror = () => reject(request.error);
    });
  }

  /*************************************************
   * GET ALL BRIEFS
   *************************************************/
  async getAllBriefs() {
    const store = await this._getStore("briefs");

    return new Promise((resolve, reject) => {

      const request = store.getAll();

      request.onsuccess = () => {
        const sorted = request.result.sort(
          (a, b) => new Date(b.Date) - new Date(a.Date)
        );
        resolve(sorted);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /*************************************************
   * DELETE BRIEF
   *************************************************/
  async deleteBrief(id) {
    const store = await this._getStore("briefs", "readwrite");

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }

  /*************************************************
   * BULK PUT (SAFE)
   *************************************************/
  async bulkPut(storeName, records) {
    await this.ready;

    return new Promise((resolve, reject) => {

      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);

      const clearReq = store.clear();

      clearReq.onsuccess = () => {
        records.forEach(r => store.put(r));
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /*************************************************
   * SYNC FROM SERVER (SAFE MERGE)
   *************************************************/
  async syncBriefsFromSheet(serverBriefs) {
    await this.ready;

    return new Promise((resolve, reject) => {

      const tx = this.db.transaction("briefs", "readwrite");
      const store = tx.objectStore("briefs");

      serverBriefs.forEach(serverBrief => {

        const id = serverBrief["Briefs ID"];
        if (!id) return;

        const req = store.get(id);

        req.onsuccess = () => {
          const local = req.result;

          // keep local changes if dirty
          if (!local || !local.dirty) {
            serverBrief.id = id;
            serverBrief.dirty = false;
            store.put(serverBrief);
          }
        };
      });

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  /*************************************************
   * AIRPORT LOOKUP
   *************************************************/
  async getAirport(icao) {
    const store = await this._getStore("airports");

    return new Promise((resolve, reject) => {

      const request = store.get((icao || "").toUpperCase());

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /*************************************************
   * SAVE AIRPORTS
   *************************************************/
  async saveAirports(list) {
    return this.bulkPut("airports", list);
  }

  /*************************************************
   * SAVE HOTELS
   *************************************************/
  async saveHotels(list) {
    return this.bulkPut("hotels", list);
  }

}

/*************************************************
 * GLOBAL INSTANCE
 *************************************************/
window.flightDB = new FlightBriefDB();
