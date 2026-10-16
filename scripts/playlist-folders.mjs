/**
 * Playlist → klasör eşlemesini okur ve whitelist süzgecini sağlar.
 *
 * Kaynak: src/data/playlist-folders.json (scripts/sync-playlist-folders.mjs
 * tarafından yerel Spotify rootlist'inden üretilir).
 *
 * Kural: bir playlist yalnızca DOĞRUDAN bulunduğu klasör whitelist'te ise
 * siteye alınır. Başka klasörlerin altındaki playlistler hiçbir zaman eklenmez.
 * Eşleme dosyası yoksa süzgeç uygulanmaz (güvenli varsayılan: her şeyi al).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = path.join(ROOT, 'src/data/playlist-folders.json');

export async function loadPlaylistFolderMap() {
  try {
    const raw = JSON.parse(await readFile(MAP_PATH, 'utf8'));
    return {
      exists: true,
      syncedAt: raw.syncedAt || null,
      whitelist: new Set(raw.whitelist || []),
      whitelistNames: raw.whitelistNames || [],
      folders: raw.folders || {},
      playlistFolders: raw.playlistFolders || {},
    };
  } catch {
    return {
      exists: false,
      syncedAt: null,
      whitelist: new Set(),
      whitelistNames: [],
      folders: {},
      playlistFolders: {},
    };
  }
}

/** Playlist doğrudan whitelist bir klasörde mi? (Harita yoksa true.) */
export function isKeptByFolder(map, id) {
  if (!map || !map.exists) return true;
  const fids = map.playlistFolders[id] || [];
  return fids.some((f) => map.whitelist.has(f));
}
