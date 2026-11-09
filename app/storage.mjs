import { decodeBackup, emptyData, LEGACY_KEY, mergeData } from './domain.mjs';

export function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pokeradar', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Ferme les autres onglets PokéRadar et recharge cette page.'));
  });
}

export function access(db, update) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('data', update ? 'readwrite' : 'readonly');
    const table = transaction.objectStore('data');
    const request = table.get('current');
    let result;
    let failure;
    request.onsuccess = () => {
      try {
        const current = { ...emptyData(), ...request.result };
        result = update ? update(current) : current;
        if (update) table.put(result, 'current');
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Enregistrement interrompu.'));
  });
}

export function migratePortal(db) {
  let raw;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch {}
  if (!raw) return Promise.resolve();
  const legacy = decodeBackup(raw);
  return access(db, data => {
    if (data.portalMigrated) return data;
    return { ...mergeData(data, legacy), portalMigrated: true };
  });
}
