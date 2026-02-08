// Database layer using IndexedDB and localStorage
import type { Issue, PhotoRef, Room } from './types.ts';
import { DEFAULT_ROOMS } from './types.ts';

const DB_NAME = 'pasfini';
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('issues')) {
        const issueStore = db.createObjectStore('issues', { keyPath: 'id' });
        issueStore.createIndex('roomSlug', 'roomSlug', { unique: false });
        issueStore.createIndex('status', 'status', { unique: false });
        issueStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
        photoStore.createIndex('issueId', 'issueId', { unique: false });
      }
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };
  });
}

// --- Rooms (localStorage) ---

export function getRooms(): Room[] {
  const stored = localStorage.getItem('rooms');
  if (!stored) {
    localStorage.setItem('rooms', JSON.stringify(DEFAULT_ROOMS));
    return [...DEFAULT_ROOMS];
  }
  try {
    const rooms = JSON.parse(stored) as Room[];
    return rooms.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  } catch {
    localStorage.setItem('rooms', JSON.stringify(DEFAULT_ROOMS));
    return [...DEFAULT_ROOMS];
  }
}

export function getLastRoomSlug(): string | null {
  return localStorage.getItem('ui.lastRoomSlug');
}

export function setLastRoomSlug(slug: string): void {
  localStorage.setItem('ui.lastRoomSlug', slug);
}

// --- Issues (IndexedDB) ---

export async function getAllIssues(): Promise<Issue[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('issues', 'readonly');
    const store = tx.objectStore('issues');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as Issue[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getIssue(id: string): Promise<Issue | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('issues', 'readonly');
    const store = tx.objectStore('issues');
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as Issue | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function saveIssue(issue: Issue): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('issues', 'readwrite');
    const store = tx.objectStore('issues');
    store.put(issue);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteIssue(id: string): Promise<void> {
  const db = await openDB();
  // Delete associated photos first
  const photos = await getPhotosByIssue(id);
  const tx = db.transaction(['issues', 'photos'], 'readwrite');
  tx.objectStore('issues').delete(id);
  for (const photo of photos) {
    tx.objectStore('photos').delete(photo.id);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Photos (IndexedDB) ---

export async function savePhoto(photo: PhotoRef): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(photo);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPhoto(id: string): Promise<PhotoRef | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const request = tx.objectStore('photos').get(id);
    request.onsuccess = () => resolve(request.result as PhotoRef | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getPhotosByIssue(issueId: string): Promise<PhotoRef[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const index = tx.objectStore('photos').index('issueId');
    const request = index.getAll(issueId);
    request.onsuccess = () => resolve(request.result as PhotoRef[]);
    request.onerror = () => reject(request.error);
  });
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
