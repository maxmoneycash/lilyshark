import { parseDirectorySnapshot, type DirectorySnapshot } from './communityDirectory';

let memory: DirectorySnapshot | undefined;
function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let rejected = false;
    const request = indexedDB.open('lilyshark-public-meshcore', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('directory');
    request.onsuccess = () => {
      if (rejected) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { rejected = true; reject(new Error('Directory storage is busy.')); };
  });
}
export async function readDirectoryCache(): Promise<DirectorySnapshot | undefined> {
  if (memory) return memory;
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    const payload = await new Promise<unknown>((resolve, reject) => {
      const request = db!.transaction('directory', 'readonly').objectStore('directory').get('latest');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (payload && !memory) memory = parseDirectorySnapshot(payload);
    return memory;
  } catch { return; }
  finally { db?.close(); }
}
export async function saveDirectoryCache(snapshot: DirectorySnapshot): Promise<boolean> {
  memory = snapshot;
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction('directory', 'readwrite');
      transaction.objectStore('directory').put(snapshot, 'latest');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return true;
  } catch { return false; }
  finally { db?.close(); }
}
