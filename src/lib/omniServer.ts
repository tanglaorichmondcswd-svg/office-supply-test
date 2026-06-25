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

// Local Storage Fallback implementation
const getLocalData = (collection: string) => {
  const data = localStorage.getItem(`omni_fallback_${collection}`);
  return data ? JSON.parse(data) : [];
};

const setLocalData = (collection: string, data: any[]) => {
  localStorage.setItem(`omni_fallback_${collection}`, JSON.stringify(data));
};

const saveToLocal = (collection: string, item: any) => {
  const data = getLocalData(collection);
  const index = data.findIndex((i: any) => (i.id || i._id) === (item.id || item._id));
  if (index >= 0) {
    data[index] = { ...data[index], ...item };
  } else {
    data.push(item);
  }
  setLocalData(collection, data);
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
  const data = await omniFetch(`/api/database/${colRef.name}`);
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
  const data = await omniFetch(`/api/database/${docRef.collectionName}/${docRef.id}`);
  return {
    exists: () => !!data,
    id: docRef.id,
    ref: { id: docRef.id, collectionName: docRef.collectionName, _type: 'mock_doc' },
    data: () => data
  };
};

export const setDoc = async (docRef: any, data: any) => {
  return omniFetch(`/api/database/${docRef.collectionName}`, {
    method: 'POST',
    body: JSON.stringify({ ...data, id: docRef.id })
  });
};

export const addDoc = async (colRef: any, data: any) => {
  return omniFetch(`/api/database/${colRef.name}`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const updateDoc = async (docRef: any, data: any) => {
  return omniFetch(`/api/database/${docRef.collectionName}`, {
    method: 'POST',
    body: JSON.stringify({ ...data, id: docRef.id })
  });
};

export const deleteDoc = async (docRef: any) => {
  // Handle if docRef is from forEach (item.ref)
  const collectionName = docRef.collectionName;
  const id = docRef.id;
  
  if (!collectionName) {
     console.error('deleteDoc: collectionName is missing from ref', docRef);
     return;
  }

  return omniFetch(`/api/database/${collectionName}/${id}`, {
    method: 'DELETE'
  });
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

// Real-time listener using Sockets
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
    getDocs(queryOrRef).then(callback).catch(errorCallback);
  };

  socket.on(eventName, listener);
  return () => socket.off(eventName, listener);
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
