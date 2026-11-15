/**
 * Robust IndexedDB Storage Manager for MUGEN Projects.
 * Handles large binary assets (SFF sprites, SND audio, ACT palettes) with high capacity (GBs)
 * avoiding localStorage 5MB quota exhaustion.
 */

export interface SavedProject {
  id: string;
  name: string;
  updatedAt: number;
  isAutoSave?: boolean;
  spriteCount?: number;
  animCount?: number;
  soundCount?: number;
  iniData?: any;
  iniRawText?: string | null;
  stFiles?: any[];
  cmdFiles?: any[];
  airRawText?: string | null;
  sffData?: any;
  sndData?: any;
  actPalette?: Uint8Array | null;
}

const DB_NAME = 'mugen_studio_db';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB.'));
    };
  });
}

/**
 * Saves or updates a project in IndexedDB.
 */
export async function saveProject(project: SavedProject): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // Clean up metadata counts
      const spriteCount = project.sffData?.images?.length || 0;
      const animCount = project.airRawText ? (project.airRawText.match(/\[\s*Begin\s+Action/gi) || []).length : 0;
      const soundCount = project.sndData?.sounds?.length || 0;

      const projectToStore: SavedProject = {
        ...project,
        spriteCount,
        animCount,
        soundCount,
        updatedAt: project.updatedAt || Date.now()
      };

      const request = store.put(projectToStore);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);

      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB save failed:', err);
    throw err;
  }
}

/**
 * Retrieves all saved projects (sorted by latest updatedAt first).
 */
export async function getAllProjects(): Promise<SavedProject[]> {
  try {
    // Check if migration from localStorage is needed
    await migrateFromLocalStorage();

    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = (request.result as SavedProject[]) || [];
        results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(results);
      };

      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn('Could not load projects from IndexedDB, attempting fallback:', err);
    return [];
  }
}

/**
 * Retrieves a single project by ID.
 */
export async function getProjectById(id: string): Promise<SavedProject | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve((request.result as SavedProject) || null);
      };

      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.error(`Failed to get project ${id}:`, err);
    return null;
  }
}

/**
 * Deletes a project by ID from IndexedDB.
 */
export async function deleteProject(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.error(`Failed to delete project ${id}:`, err);
    throw err;
  }
}

/**
 * One-time migration for legacy projects stored in localStorage.
 * Clears localStorage upon migration to free up browser storage quota.
 */
async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const legacy = localStorage.getItem('mugen_saved_projects');
    if (!legacy) return;

    const parsed = JSON.parse(legacy);
    if (Array.isArray(parsed) && parsed.length > 0) {
      for (const item of parsed) {
        if (item && item.id) {
          // Rebuild TypedArrays if legacy array representation exists
          const deserializedSff = item.sffData ? {
            ...item.sffData,
            images: item.sffData.images?.map((img: any) => ({
              ...img,
              pixelIndices: img.pixelIndices instanceof Uint8Array ? img.pixelIndices : new Uint8Array(img.pixelIndices || []),
              palette: img.palette ? (img.palette instanceof Uint8Array ? img.palette : new Uint8Array(img.palette)) : undefined
            })),
            palettes: item.sffData.palettes?.map((pal: any) => ({
              ...pal,
              data: pal.data instanceof Uint8Array ? pal.data : new Uint8Array(pal.data || [])
            }))
          } : null;

          const deserializedSnd = item.sndData ? {
            ...item.sndData,
            sounds: item.sndData.sounds?.map((snd: any) => ({
              ...snd,
              data: snd.data instanceof Uint8Array ? snd.data : new Uint8Array(snd.data || [])
            }))
          } : null;

          const deserializedPalette = item.actPalette ? (
            item.actPalette instanceof Uint8Array ? item.actPalette : new Uint8Array(item.actPalette)
          ) : null;

          await saveProject({
            ...item,
            sffData: deserializedSff,
            sndData: deserializedSnd,
            actPalette: deserializedPalette
          });
        }
      }
    }
    // Remove the legacy item so quota errors are prevented forever
    localStorage.removeItem('mugen_saved_projects');
  } catch (e) {
    console.warn('Legacy localStorage migration notice:', e);
    try {
      localStorage.removeItem('mugen_saved_projects');
    } catch {}
  }
}
