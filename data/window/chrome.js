'use strict';

chrome = chrome || {};
/* storage */
{
  const storage = {
    name: 'db',
    version: 2,
    cache: [],
    ready() {
      return new Promise((resolve, reject) => {
        storage.cache.push({resolve, reject});
      });
    },
    get(o, c) {
      const db = request.result;
      const tx = db.transaction(storage.name);
      const prefs = {};
      tx.addEventListener('complete', () => c(prefs));
      const store = tx.objectStore(storage.name);
      for (const key of Object.keys(o)) {
        const request = store.get(key);
        request.onsuccess = e => {
          prefs[key] = e.target.result ? e.target.result.value : o[key];
        };
      }
    },
    set(o, c) {
      const db = request.result;
      const tx = db.transaction(storage.name, 'readwrite');
      tx.addEventListener('complete', () => c());
      const store = tx.objectStore(storage.name);
      Object.entries(o).forEach(([name, value]) => store.put({
        name,
        value
      }));
    },
    remove(arr, c) {
      const db = request.result;
      const tx = db.transaction(storage.name, 'readwrite');
      tx.addEventListener('complete', () => c());
      const store = tx.objectStore(storage.name);
      for (const key of Array.isArray(arr) ? arr : [arr]) {
        store.delete(key);
      }
    }
  };
  const request = indexedDB.open('storage', storage.version);
  request.onupgradeneeded = e => {
    const db = e.target.result;
    db.createObjectStore(storage.name, {
      keyPath: 'name'
    }).createIndex('name', 'name', {
      unique: true
    });
  };
  request.onsuccess = () => {
    storage.ready = () => Promise.resolve();
    for (const {resolve} of storage.cache) {
      resolve();
    }
  };

  chrome.storage = chrome.storage || {
    local: {
      get(o, c = () => {}) {
        storage.ready().then(() => storage.get(o, c));
      },
      set(o, c = () => {}) {
        storage.ready().then(() => storage.set(o, c));
      }
    }
  };
}
/* tabs */
chrome.tabs = chrome.tabs || {
  create(o) {
    const a = document.createElement('a');
    a.href = o.url;
    a.target = '_blank';
    a.click();
  }
};
