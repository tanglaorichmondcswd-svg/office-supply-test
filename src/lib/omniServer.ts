import { io } from 'socket.io-client';

const SERVER_URL = (import.meta as any).env?.VITE_OMNISERVER_URL || 'https://ais-dev-fawlctnrytfe5rdsfig2at-217932031428.asia-southeast1.run.app';
const APP_TOKEN = (import.meta as any).env?.VITE_OMNISERVER_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFwcF8xNzgyMjYyOTQ0NTU1IiwidHlwZSI6ImV4dGVybmFsX2FwcCIsImFwcE5hbWUiOiJSZW1peDogQ1NXRE8gTWFiYWxhY2F0IENpdHkgLSBPZmZpY2UgU3VwcGxpZXMgU3lzdGVtIiwiaWF0IjoxNzgyMjYyOTQ0LCJleHAiOjE4MTM3OTg5NDR9.ZFRDtwtqSN7jKWR5_V2XVvLq0jDvH_LKKdsROnxz2L4';

// Initialize WebSocket connection
export const socket = io(SERVER_URL, {
  query: { appName: 'Remix: CSWDO Mabalacat City - Office Supplies System' },
  transports: ['polling', 'websocket']
});

socket.on('connect', () => {
  console.log('Connected to OmniServer WebSocket');
});

socket.on('connect_error', (err) => {
  console.warn('OmniServer WebSocket connection error:', err.message);
});

// --- OMNI HOST DATA SYNC ENGINE ---
const HOST_DATA_URL = (import.meta as any).env?.VITE_OMNI_HOST_DATA_URL || 'https://ais-dev-cspw766qmfzgzsulbjkhi4-78153391540.asia-east1.run.app/api/host-data/cswdo-office-supplies-system';

let globalDbState: { [collection: string]: any[] } = {};
let isDbLoaded = false;
let dbLoadPromise: Promise<void> | null = null;

// Migrate legacy local storage fallbacks to the central host data
const migrateLocalDataToHostState = () => {
  const state: { [col: string]: any[] } = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('omni_fallback_')) {
      const colName = key.replace('omni_fallback_', '');
      try {
        const val = localStorage.getItem(key);
        if (val) {
          state[colName] = JSON.parse(val);
        }
      } catch (e) {}
    }
  }
  return state;
};

// Save current DB state to the external Omni Host API
export const saveDatabaseState = async () => {
  try {
    // Back up locally to storage first for optimistic offline usage
    localStorage.setItem('omni_host_backup', JSON.stringify(globalDbState));

    let response;
    try {
      response = await fetch('/api/proxy-host-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          collections: globalDbState,
          updatedAt: new Date().toISOString()
        })
      });
    } catch (proxyError) {
      console.warn('Proxy save failed, attempting direct fetch fallback:', proxyError);
      response = await fetch(HOST_DATA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          collections: globalDbState,
          updatedAt: new Date().toISOString()
        })
      });
    }
    
    if (!response.ok) {
      console.warn('Omni Host API returned non-OK status during save:', response.status);
    } else {
      console.log('Successfully synced database state to Omni Host API');
    }
  } catch (error) {
    console.error('Failed to save database state to Omni Host API:', error);
  }
};

// Load current DB state from the external Omni Host API
export const loadDatabaseState = async () => {
  try {
    let response;
    try {
      response = await fetch('/api/proxy-host-data');
    } catch (proxyError) {
      console.warn('Proxy load failed, attempting direct fetch fallback:', proxyError);
      response = await fetch(HOST_DATA_URL);
    }

    if (response.ok) {
      const text = await response.text();
      const trimmed = text.trim();
      
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const data = JSON.parse(text);
          if (data && typeof data === 'object') {
            if (data.collections && typeof data.collections === 'object') {
              globalDbState = data.collections;
            } else {
              const keys = Object.keys(data);
              if (keys.length > 0 && Array.isArray(data[keys[0]])) {
                globalDbState = data;
              } else {
                globalDbState = {};
              }
            }
            console.log('Loaded database state from Omni Host API:', Object.keys(globalDbState));
            localStorage.setItem('omni_host_backup', JSON.stringify(globalDbState));
            return;
          }
        } catch (jsonErr: any) {
          console.warn('JSON parsing failed on received Omni Host data:', jsonErr.message);
        }
      } else {
        console.warn('Omni Host API response did not contain valid JSON format.');
      }
    }
  } catch (error) {
    console.error('Failed to load database state from Omni Host API, checking backup:', error);
  }

  // Load from local storage backup if API fails
  try {
    const backup = localStorage.getItem('omni_host_backup');
    if (backup) {
      globalDbState = JSON.parse(backup);
      console.log('Loaded database state from local backup.');
    }
  } catch (e) {
    console.error('Failed to parse local backup:', e);
  }

  // If still completely empty, check and migrate legacy fallback keys
  if (Object.keys(globalDbState).length === 0) {
    const localMigrated = migrateLocalDataToHostState();
    if (Object.keys(localMigrated).length > 0) {
      console.log('Migrating legacy localStorage fallback data to new Omni Host API');
      globalDbState = localMigrated;
      saveDatabaseState();
    }
  }
};

export const ensureDbLoaded = async () => {
  if (isDbLoaded) return;
  if (!dbLoadPromise) {
    dbLoadPromise = loadDatabaseState().then(() => {
      isDbLoaded = true;
    });
  }
  return dbLoadPromise;
};

// Start initial load immediately
ensureDbLoaded();

// Compatibility wrappers for existing caching helpers
const getLocalData = (collection: string) => {
  return globalDbState[collection] || [];
};

const setLocalData = (collection: string, data: any[]) => {
  globalDbState[collection] = data;
  saveDatabaseState();
};

const saveToLocal = (collection: string, item: any) => {
  if (!globalDbState[collection]) {
    globalDbState[collection] = [];
  }
  const data = globalDbState[collection];
  const index = data.findIndex((i: any) => (i.id || i._id) === (item.id || item._id));
  if (index >= 0) {
    data[index] = { ...data[index], ...item };
  } else {
    data.push(item);
  }
  saveDatabaseState();
};

// Helper for OmniServer API calls
const omniFetch = async (endpoint: string, options: RequestInit = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    'Authorization': `Bearer ${APP_TOKEN}`,
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };

  try {
    const response = await fetch(`${SERVER_URL}${endpoint}`, {
      ...options,
      method,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;
      console.warn(`OmniServer returned ${status}: ${errorText.substring(0, 100)}...`);
      
      // If it's a redirect or auth error, throw specific info
      if (status === 301 || status === 302 || status === 307 || status === 308) {
        throw new Error(`Server redirecting (Status ${status}). Possible authentication or configuration issue.`);
      }
      if (status === 401 || status === 403) {
        throw new Error(`Authentication failed (Status ${status}). Check APP_TOKEN.`);
      }
      
      throw new Error(`OmniServer error: ${errorText}`);
    }

    const data = await response.json();
    
    // Sync to local on success for read-through cache
    const parts = endpoint.split('/');
    const collection = parts[3]; // /api/database/COLLECTION
    if (collection) {
      if (method === 'GET' && !parts[4] && Array.isArray(data)) {
        setLocalData(collection, data);
      } else if (method === 'GET' && parts[4] && data) {
        saveToLocal(collection, data);
      }
    }

    return data;
  } catch (error: any) {
    // Only log "Failed to fetch" once as a warning to avoid console spam
    if (error.message === 'Failed to fetch') {
      console.warn('OmniServer unreachable. Using local storage fallback.');
    } else {
      console.error('omniFetch error:', error.message);
    }
    
    // Fallback logic for GET and writes
    const parts = endpoint.split('/');
    const collection = parts[3];
    const id = parts[4];

    if (method === 'GET') {
      const localData = getLocalData(collection);
      if (id) {
        return localData.find((i: any) => (i.id || i._id) === id) || null;
      }
      return localData;
    }
    
    // For writes, store locally for optimistic offline behavior
    if (collection && options.body && typeof options.body === 'string') {
      try {
        const bodyData = JSON.parse(options.body);
        const itemToSave = { ...bodyData, id: id || bodyData.id || Math.random().toString(36).substr(2, 9) };
        saveToLocal(collection, itemToSave);
        return itemToSave;
      } catch (e) {
        console.error('Failed to parse body for local fallback');
      }
    }
    
    // If we can't fallback, we still return null instead of throwing to keep UI alive
    return null;
  }
};

// Mock Timestamp for compatibility
export class Timestamp {
  seconds: number;
  nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static now() {
    const now = Date.now();
    return new Timestamp(Math.floor(now / 1000), (now % 1000) * 1e6);
  }

  static fromDate(date: Date) {
    const ms = date.getTime();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }

  toDate() {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
  }

  toMillis() {
    return this.seconds * 1000 + this.nanoseconds / 1e6;
  }
}

// Database interface mimicking Firestore
export const db = { _type: 'omni_db' };

export const collection = (dbRef: any, collectionName: string) => {
  return { _type: 'mock_col', name: collectionName };
};

export const doc = (dbRefOrColRef: any, collectionOrId?: string, ...idSegments: string[]) => {
  let collectionName: string;
  let docId: string;

  if (dbRefOrColRef && dbRefOrColRef._type === 'mock_col') {
    collectionName = dbRefOrColRef.name;
    docId = collectionOrId || Math.random().toString(36).substr(2, 9);
  } else {
    collectionName = collectionOrId!;
    docId = idSegments[0] || Math.random().toString(36).substr(2, 9);
  }

  return { _type: 'mock_doc', collectionName, id: docId };
};

export const getDocs = async (colRef: any) => {
  await ensureDbLoaded();
  const data = globalDbState[colRef.name] || [];
  const docs = (Array.isArray(data) ? data : []).map((item: any) => ({
    id: item.id || item._id,
    ref: { id: item.id || item._id, collectionName: colRef.name, _type: 'mock_doc' },
    data: () => item
  }));
  return {
    docs,
    forEach: (callback: any) => docs.forEach(callback)
  };
};

export const getDoc = async (docRef: any) => {
  await ensureDbLoaded();
  const collectionName = docRef.collectionName;
  const list = globalDbState[collectionName] || [];
  const data = list.find((item: any) => (item.id || item._id) === docRef.id) || null;
  return {
    exists: () => !!data,
    id: docRef.id,
    ref: { id: docRef.id, collectionName: docRef.collectionName, _type: 'mock_doc' },
    data: () => data
  };
};

export const setDoc = async (docRef: any, data: any) => {
  await ensureDbLoaded();
  const collectionName = docRef.collectionName;
  if (!globalDbState[collectionName]) {
    globalDbState[collectionName] = [];
  }
  const list = globalDbState[collectionName];
  const item = { ...data, id: docRef.id };
  const index = list.findIndex((i: any) => (i.id || i._id) === docRef.id);
  if (index >= 0) {
    list[index] = item;
  } else {
    list.push(item);
  }
  await saveDatabaseState();
  
  try {
    socket.emit('db_change', { collection: collectionName });
  } catch (e) {}

  return item;
};

export const addDoc = async (colRef: any, data: any) => {
  await ensureDbLoaded();
  const collectionName = colRef.name;
  if (!globalDbState[collectionName]) {
    globalDbState[collectionName] = [];
  }
  const list = globalDbState[collectionName];
  const id = data.id || Math.random().toString(36).substr(2, 9);
  const item = { ...data, id };
  list.push(item);
  await saveDatabaseState();
  
  try {
    socket.emit('db_change', { collection: collectionName });
  } catch (e) {}

  return { id, ...item };
};

export const updateDoc = async (docRef: any, data: any) => {
  await ensureDbLoaded();
  const collectionName = docRef.collectionName;
  if (!globalDbState[collectionName]) {
    globalDbState[collectionName] = [];
  }
  const list = globalDbState[collectionName];
  const index = list.findIndex((i: any) => (i.id || i._id) === docRef.id);
  if (index >= 0) {
    list[index] = { ...list[index], ...data, id: docRef.id };
  } else {
    list.push({ ...data, id: docRef.id });
  }
  await saveDatabaseState();
  
  try {
    socket.emit('db_change', { collection: collectionName });
  } catch (e) {}

  return { id: docRef.id };
};

export const deleteDoc = async (docRef: any) => {
  await ensureDbLoaded();
  const collectionName = docRef.collectionName;
  if (!collectionName) return;
  const list = globalDbState[collectionName] || [];
  const index = list.findIndex((i: any) => (i.id || i._id) === docRef.id);
  if (index >= 0) {
    list.splice(index, 1);
    await saveDatabaseState();
    
    try {
      socket.emit('db_change', { collection: collectionName });
    } catch (e) {}
  }
};

// File storage
export const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return omniFetch('/api/files/upload', {
    method: 'POST',
    body: formData
  });
};

// Auth state listeners
const authListeners: ((user: any) => void)[] = [];

// Auth state and actions
export const onAuthStateChanged: any = (authOrCallback: any, callbackIfFirstIsAuth?: any) => {
  const callback = typeof authOrCallback === 'function' ? authOrCallback : callbackIfFirstIsAuth;
  
  // Initial check
  const user = JSON.parse(localStorage.getItem('cswdo_user') || 'null');
  if (user) {
    console.log('onAuthStateChanged: Found existing session', user.email);
  }
  callback(user);
  
  // Register listener
  authListeners.push(callback);
  
  // Listen for storage changes in other tabs
  const storageListener = (e: StorageEvent) => {
    if (e.key === 'cswdo_user') {
      const newUser = JSON.parse(e.newValue || 'null');
      authListeners.forEach(l => l(newUser));
    }
  };
  window.addEventListener('storage', storageListener);
  
  return () => {
    const index = authListeners.indexOf(callback);
    if (index > -1) authListeners.splice(index, 1);
    window.removeEventListener('storage', storageListener);
  };
};

export const signOut: any = async () => {
  localStorage.removeItem('cswdo_user');
  authListeners.forEach(l => l(null));
};

export const auth = {
  get currentUser() {
    return JSON.parse(localStorage.getItem('cswdo_user') || 'null');
  }
};

export const signInWithGoogle: any = async () => {
  const mockUser = {
    uid: 'omni-user-123',
    email: 'tanglaorichmond.cswd@gmail.com',
    displayName: 'Richmond Tanglao',
    role: 'ADMIN'
  };
  localStorage.setItem('cswdo_user', JSON.stringify(mockUser));
  authListeners.forEach(l => l(mockUser));
  return { user: mockUser };
};

// Query placeholders
export const query = (colRef: any, ...constraints: any[]) => colRef;
export const orderBy = (field: string, direction: string = 'asc') => ({ type: 'orderBy', field, direction });
export const limit = (n: number) => ({ type: 'limit', n });
export const where = (field: string, op: string, value: any) => ({ type: 'where', field, op, value });

// Real-time listener using Sockets and Multi-tab Broadcast Sync
export const onSnapshot: any = (queryOrRef: any, callback: (snapshot: any) => void, errorCallback?: any) => {
  const collectionName = queryOrRef.name || queryOrRef.collectionName;
  
  if (!collectionName) {
    console.error('onSnapshot: collectionName is missing', queryOrRef);
    return () => {};
  }

  // Initial fetch
  getDocs(queryOrRef).then(callback).catch(errorCallback);

  // Listen for updates via socket
  const eventName = `update:${collectionName}`;
  const listener = () => {
    loadDatabaseState().then(() => {
      getDocs(queryOrRef).then(callback).catch(errorCallback);
    });
  };

  const dbChangeListener = (data: any) => {
    if (data && data.collection === collectionName) {
      loadDatabaseState().then(() => {
        getDocs(queryOrRef).then(callback).catch(errorCallback);
      });
    }
  };

  socket.on(eventName, listener);
  socket.on('db_change', dbChangeListener);

  // Storage listener for multi-tab synchronization
  const storageListener = (e: StorageEvent) => {
    if (e.key === 'omni_host_backup') {
      try {
        globalDbState = JSON.parse(e.newValue || '{}');
        getDocs(queryOrRef).then(callback).catch(errorCallback);
      } catch (err) {}
    }
  };
  window.addEventListener('storage', storageListener);

  return () => {
    socket.off(eventName, listener);
    socket.off('db_change', dbChangeListener);
    window.removeEventListener('storage', storageListener);
  };
};

export const serverTimestamp = () => new Date().toISOString();

export const runTransaction = async (db: any, updateFn: any) => {
  const transaction = {
    get: (ref: any) => getDoc(ref),
    set: (ref: any, data: any) => setDoc(ref, data),
    update: (ref: any, data: any) => updateDoc(ref, data),
    delete: (ref: any) => deleteDoc(ref)
  };
  return updateFn(transaction);
};
