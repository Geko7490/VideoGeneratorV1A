import { openDB, type IDBPDatabase } from 'idb';
import type { Project } from '../types';

/**
 * Project persistence (IndexedDB). All data stays in the user's browser profile.
 *
 * stores:
 *  projects  -> Project JSON (settings, script, master prompt, chunk records)
 *  blobs     -> binary assets keyed `${projectId}/${kind}/${name}` (images, tts wav, music, sfx, final export)
 *  chunks    -> encoded video/audio chunks for resumable rendering
 */

const DB_NAME = 'local-ai-video-generator';
const DB_VERSION = 1;

export interface StoredEncodedChunk {
  key: string; // `${projectId}/${chunkIndex}`
  projectId: string;
  chunkIndex: number;
  video: { data: ArrayBuffer; timestamp: number; duration: number; type: 'key' | 'delta' }[];
  audio: { data: ArrayBuffer; timestamp: number; duration: number; type: 'key' | 'delta' }[];
  videoDescription: ArrayBuffer | null;
  audioDescription: ArrayBuffer | null;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  sampleRate: number;
  channels: number;
  startTime: number;
  endTime: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('chunks')) {
          const s = d.createObjectStore('chunks', { keyPath: 'key' });
          s.createIndex('byProject', 'projectId');
        }
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

export const projectStore = {
  async save(project: Project) {
    project.updatedAt = Date.now();
    await (await db()).put('projects', JSON.parse(JSON.stringify(project)));
  },
  async get(id: string): Promise<Project | undefined> {
    return (await db()).get('projects', id);
  },
  async list(): Promise<Project[]> {
    const all: Project[] = await (await db()).getAll('projects');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async delete(id: string) {
    const d = await db();
    await d.delete('projects', id);
    // delete blobs
    const keys = (await d.getAllKeys('blobs')) as string[];
    const tx = d.transaction('blobs', 'readwrite');
    for (const k of keys) if (k.startsWith(id + '/')) tx.store.delete(k);
    await tx.done;
    const chunkKeys = await d.getAllKeysFromIndex('chunks', 'byProject', id);
    const tx2 = d.transaction('chunks', 'readwrite');
    for (const k of chunkKeys) tx2.store.delete(k);
    await tx2.done;
  },
};

export const blobStore = {
  key(projectId: string, kind: 'image' | 'tts' | 'music' | 'sfx' | 'export' | 'ref', name: string) {
    return `${projectId}/${kind}/${name}`;
  },
  async put(key: string, blob: Blob) {
    await (await db()).put('blobs', blob, key);
  },
  async get(key: string): Promise<Blob | undefined> {
    return (await db()).get('blobs', key);
  },
  async delete(key: string) {
    await (await db()).delete('blobs', key);
  },
  async has(key: string) {
    return (await (await db()).getKey('blobs', key)) !== undefined;
  },
};

export const chunkStore = {
  async put(chunk: StoredEncodedChunk) {
    await (await db()).put('chunks', chunk);
  },
  async get(projectId: string, index: number): Promise<StoredEncodedChunk | undefined> {
    return (await db()).get('chunks', `${projectId}/${index}`);
  },
  async listIndexes(projectId: string): Promise<number[]> {
    const keys = (await (await db()).getAllKeysFromIndex('chunks', 'byProject', projectId)) as string[];
    return keys.map((k) => Number(k.split('/')[1])).sort((a, b) => a - b);
  },
  async clear(projectId: string) {
    const d = await db();
    const keys = await d.getAllKeysFromIndex('chunks', 'byProject', projectId);
    const tx = d.transaction('chunks', 'readwrite');
    for (const k of keys) tx.store.delete(k);
    await tx.done;
  },
};

export const kvStore = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await db()).get('kv', key);
  },
  async set<T>(key: string, value: T) {
    await (await db()).put('kv', value, key);
  },
};
