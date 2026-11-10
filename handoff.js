/* Moves the finished parts from the blanking page to the sending page without the network. Both pages share a
   browser database. The sending page empties it the moment it reads, so the file doesn't stay on the device. */
(function (global) {
  "use strict";
  const DB = "handoff";
  const STORE = "parts";
  const MAX_AGE = 2 * 3600 * 1000;

  function open() {
    return new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "index" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function run(mode, work) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result;
      Promise.resolve(work(tx.objectStore(STORE))).then((value) => { result = value; });
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    }));
  }

  const clear = () => run("readwrite", (store) => { store.clear(); });

  /* parts: array of Blob, each one a complete PDF. */
  const put = (parts) => run("readwrite", (store) => {
    store.clear();
    const at = Date.now();
    parts.forEach((blob, index) => store.put({ index, blob, at }));
  });

  /* Adds after what is already waiting: the pension report joins the payslips made a moment ago. */
  const add = (parts) => run("readwrite", (store) => {
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      const first = keys.result.length ? Math.max(...keys.result) + 1 : 0;
      const at = Date.now();
      parts.forEach((blob, i) => store.put({ index: first + i, blob, at }));
    };
  });

  /* How many fresh parts are waiting, without taking them. */
  const count = () => run("readonly", (store) => new Promise((resolve) => {
    const rows = store.getAll();
    rows.onsuccess = () => resolve(rows.result.filter((r) => Date.now() - r.at < MAX_AGE).length);
    rows.onerror = () => resolve(0);
  }));

  /* Reads and empties in one step. Parts older than the limit are dropped, not sent. */
  const take = () => open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.getAll();
    let rows = [];
    request.onsuccess = () => { rows = request.result; store.clear(); };
    tx.oncomplete = () => {
      db.close();
      const fresh = rows.filter((r) => Date.now() - r.at < MAX_AGE).sort((a, b) => a.index - b.index);
      resolve(fresh.map((r) => r.blob));
    };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  }));

  global.Handoff = { put, add, count, take, clear };
})(window);
