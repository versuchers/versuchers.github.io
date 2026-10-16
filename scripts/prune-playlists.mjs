#!/usr/bin/env node
/**
 * Playlist verisinden hariç tutulan sanatçıları tamamen çıkarır.
 *
 * İki mod:
 *   • varsayılan  : etkilenen playlistleri Spotify'dan TÜM alanlarla tam
 *                   yeniden çeker (en doğru; fazla istek → 429 riski).
 *   • --offline   : API'ye hiç dokunmadan mevcut veriyi yerelde dönüştürür.
 *                   trackCount, artistCount, artists, tracks, genres TAM;
 *                   durationMs ve albumCount yalnızca >12 şarkılı listelerde
 *                   orantısal tahmindir (≤12 şarkılılarda tamdır).
 *
 * Tamamen boşalan playlist listeden çıkarılır.
 * Kullanım: npm run spotify:prune [-- --offline]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaylistFolderMap, isKeptByFolder } from './playlist-folders.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/spotify-playlists.json');
const GENRE_CACHE = path.join(ROOT, 'src/data/spotify-artist-genres.json');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN || '';
const OFFLINE = process.argv.includes('--offline');

const TRACK_PREVIEW = 12;
const EXCLUDE_ARTISTS = [
  'cem karaca', 'sagopa kajmer', 'ceylan ertem', 'pecattiphilia',
  'şebnem ferah', 'adil', 'haluk levent', 'selda bağcan',
  'taylor swift', 'istanbul attack', 'zeal & ardor',
];
const normName = (s) => String(s ?? '').trim().toLocaleLowerCase('tr').normalize('NFC').replace(/\s+/g, ' ');
const EXCLUDE_SET = new Set(EXCLUDE_ARTISTS.map(normName));
const isExcluded = (n) => EXCLUDE_SET.has(normName(n));

// İsim bazlı playlist dışlaması: başında [ost] bulunan ve isimsiz (boş) listeler
// listeye hiçbir zaman alınmaz. Kural fetch-spotify.mjs ile aynıdır.
const OST_NAME_RE = /^\s*\[ost\]/i;
const isExcludedPlaylist = (name) => OST_NAME_RE.test(String(name ?? '')) || !String(name ?? '').trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString('base64');
const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return f; } };

function genreCounts(playlist, genreCache) {
  const map = new Map();
  for (const a of playlist.artists || []) {
    const cached = a.name && genreCache[a.name.toLowerCase()];
    if (!cached) continue;
    for (const g of cached.tags || []) map.set(g, (map.get(g) || 0) + a.count);
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'));
}

/** Çevrimdışı: mevcut playlist kaydını yerelde süzer. */
function pruneOffline(p) {
  const removed = (p.artists || []).filter((a) => isExcluded(a.name));
  if (!removed.length) return { playlist: p, changed: false, removedTracks: 0 };
  const removedTracks = removed.reduce((s, a) => s + a.count, 0);
  const trackCount = p.trackCount - removedTracks;
  const artists = (p.artists || []).filter((a) => !isExcluded(a.name));
  const tracks = (p.tracks || []).filter((t) => !(t.artists || []).some((a) => isExcluded(a.name)));

  let durationMs = p.durationMs;
  let albumCount = p.albumCount;
  let estimated = false;
  if (p.trackCount <= TRACK_PREVIEW) {
    // tüm şarkılar elimizde → tam
    durationMs = tracks.reduce((s, t) => s + (t.durationMs || 0), 0);
    albumCount = new Set(tracks.map((t) => t.album).filter(Boolean)).size;
  } else if (p.trackCount > 0 && trackCount > 0) {
    const ratio = trackCount / p.trackCount;
    durationMs = Math.round(p.durationMs * ratio);
    albumCount = Math.max(1, Math.round(p.albumCount * ratio));
    estimated = true;
  }
  return {
    playlist: { ...p, trackCount, durationMs, artistCount: artists.length, albumCount, artists, tracks },
    changed: true,
    removedTracks,
    estimated,
  };
}

// ------------------------------------------------------------------- API yolu
let token = '';
async function getToken() {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${b64(`${CLIENT_ID}:${CLIENT_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }).toString(),
  });
  if (!res.ok) throw new Error(`Token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}
async function api(u, retries = 4) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(`https://api.spotify.com/v1${u}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get('retry-after') || 5), 30);
      console.warn(`   ⏳ 429 — ${wait}s bekleniyor`);
      await sleep(wait * 1000);
      continue;
    }
    return res;
  }
  throw new Error(`Üst üste 429: ${u}`);
}
async function fetchTracks(id) {
  const tracks = [];
  let next = `/playlists/${id}/items?limit=100`;
  while (next) {
    const res = await api(next);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const json = await res.json();
    for (const it of json.items || []) {
      const item = it?.item ?? it?.track;
      if (!item || it.is_local || !item.name) continue;
      const arts = (item.artists || []).map((a) => ({ name: a.name, id: a.id }));
      if (arts.some((a) => isExcluded(a.name))) continue;
      tracks.push({ name: item.name, artists: arts, album: item.album?.name || '', durationMs: item.duration_ms || 0 });
    }
    next = json.next ? json.next.replace('https://api.spotify.com/v1', '') : null;
    await sleep(150);
  }
  return tracks;
}

async function main() {
  const data = await readJson(OUT, { playlists: [] });
  const genreCache = await readJson(GENRE_CACHE, {});
  const folderMap = await loadPlaylistFolderMap();
  if (folderMap.exists) {
    console.log(`🗂️  klasör eşlemesi: ${folderMap.whitelist.size} whitelist klasör`);
  } else {
    console.warn('⚠️  playlist-folders.json yok — klasör süzgeci UYGULANMIYOR (npm run spotify:folders)');
  }
  const folderExcluded = (name, id) => {
    if (isKeptByFolder(folderMap, id)) return false;
    console.log(`   🗑️ silindi (whitelist dışı klasör): ${JSON.stringify(name)}`);
    return true;
  };

  let cachePruned = 0;
  for (const k of Object.keys(genreCache)) {
    if (isExcluded(genreCache[k]?.name || k)) { delete genreCache[k]; cachePruned++; }
  }

  const before = data.playlists.length;
  const playlists = [];
  let dropped = 0;
  let estCount = 0;

  if (OFFLINE) {
    console.log('🧩 çevrimdışı mod (API kullanılmaz)');
    for (const p of data.playlists) {
      if (isExcludedPlaylist(p.name)) { dropped++; console.log(`   🗑️ silindi ([ost]/isimsiz): ${JSON.stringify(p.name)}`); continue; }
      if (folderExcluded(p.name, p.id)) { dropped++; continue; }
      const { playlist: np, changed, estimated } = pruneOffline(p);
      if (changed) {
        if (np.trackCount === 0) { dropped++; console.log(`   🗑️ silindi (boşaldı): ${p.name}`); continue; }
        if (estimated) estCount++;
        console.log(`   ${JSON.stringify(p.name).slice(0, 34).padEnd(36)} ${p.trackCount} -> ${np.trackCount}${estimated ? ' (süre/albüm tahmini)' : ''}`);
      }
      np.genres = genreCounts(np, genreCache);
      playlists.push(np);
    }
  } else {
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) { console.error('❌ Eksik env (.env)'); process.exit(1); }
    token = await getToken();
    const affected = data.playlists.filter((p) => (p.artists || []).some((a) => isExcluded(a.name)));
    console.log(`🎯 etkilenen playlist: ${affected.length} / ${data.playlists.length}`);
    const byId = new Map();
    for (let i = 0; i < affected.length; i++) {
      const p = affected[i];
      const tracks = await fetchTracks(p.id);
      const artistMap = new Map();
      for (const t of tracks) for (const a of t.artists) {
        const key = a.id || a.name.toLowerCase();
        const cur = artistMap.get(key) || { name: a.name, id: a.id, count: 0 };
        cur.count++; artistMap.set(key, cur);
      }
      const artists = Array.from(artistMap.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'));
      byId.set(p.id, { ...p, trackCount: tracks.length, durationMs: tracks.reduce((s, t) => s + t.durationMs, 0), artistCount: artists.length, albumCount: new Set(tracks.map((t) => t.album).filter(Boolean)).size, artists, tracks: tracks.slice(0, TRACK_PREVIEW) });
      console.log(`   ${(i + 1).toString().padStart(2)}/${affected.length} ${JSON.stringify(p.name).slice(0, 34).padEnd(36)} ${p.trackCount} -> ${tracks.length}`);
    }
    for (const p of data.playlists) {
      if (isExcludedPlaylist(p.name)) { dropped++; console.log(`   🗑️ silindi ([ost]/isimsiz): ${JSON.stringify(p.name)}`); continue; }
      if (folderExcluded(p.name, p.id)) { dropped++; continue; }
      const np = byId.get(p.id) || p;
      if (np.trackCount === 0) { dropped++; console.log(`   🗑️ silindi (boşaldı): ${p.name}`); continue; }
      np.genres = genreCounts(np, genreCache);
      playlists.push(np);
    }
  }

  await writeFile(OUT, JSON.stringify({ fetchedAt: data.fetchedAt, playlists }, null, 2));
  await writeFile(GENRE_CACHE, JSON.stringify(genreCache, null, 2));
  console.log(`💾 ${playlists.length} playlist (${before} -> ${playlists.length}, silinen ${dropped})${estCount ? `, tahmini alan: ${estCount}` : ''}`);
  console.log(`🧹 tür önbelleğinden silinen sanatçı: ${cachePruned}`);
}

main().catch((e) => { console.error('❌ Hata:', e.message || e); process.exit(1); });
