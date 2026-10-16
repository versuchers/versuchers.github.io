#!/usr/bin/env node
/**
 * Spotify public playlist'leri çek → src/data/spotify-playlists.json
 *
 * Yalnızca KENDİ public playlistlerin alınır (owner filtresi).
 * Şubat 2026 kuralı: başkasının playlist içeriği 403 verir; takip edilen
 * playlistler listeden düşürülür.
 *
 * Kullanım:
 *   npm run spotify                 → tam çekim (playlist + şarkı + özet)
 *   npm run spotify -- --genres-only → sadece eksik türleri tamamla (hızlı)
 *
 * Ortam değişkenleri (.env):
 *   SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN
 *   LASTFM_API_KEY         tür çekimi için (artist.getTopTags)
 *   SPOTIFY_GENRE_BUDGET   bir çalıştırmada en fazla kaç sanatçı türü
 *                          çekilecek (varsayılan 3000)
 *
 * Not: Spotify artist.genres alanı 2025-2026'da tamamen boşaltıldı; türler
 * Last.fm etiketlerinden gelir.
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
const GENRE_BUDGET = Number(process.env.SPOTIFY_GENRE_BUDGET || 3000);
const GENRES_ONLY = process.argv.includes('--genres-only');
const LASTFM_KEY = process.env.LASTFM_API_KEY || '';

const TRACK_PREVIEW = 12;

// Siteden ve veriden tamamen çıkarılan sanatçılar (büyük/küçük harf duyarsız).
// Bir şarkıda bu sanatçılardan herhangi biri geçiyorsa şarkı tamamen atlanır;
// böylece playlistten de sanatçıdan da hiçbir iz kalmaz. Tamamen boşalan
// playlistler listeye alınmaz.
const EXCLUDE_ARTISTS = [
  'cem karaca', 'sagopa kajmer', 'ceylan ertem', 'pecattiphilia',
  'şebnem ferah', 'adil', 'haluk levent', 'selda bağcan',
  'taylor swift', 'istanbul attack', 'zeal & ardor',
];

function normName(s) {
  return String(s ?? '').trim().toLocaleLowerCase('tr').normalize('NFC').replace(/\s+/g, ' ');
}
const EXCLUDE_SET = new Set(EXCLUDE_ARTISTS.map(normName));
const isExcluded = (name) => EXCLUDE_SET.has(normName(name));

// İsim bazlı playlist dışlaması: başında [ost] bulunan ve isimsiz (boş) listeler
// listeye hiçbir zaman alınmaz. Kural burada ve prune-playlists.mjs'te aynıdır.
const OST_NAME_RE = /^\s*\[ost\]/i;
const isExcludedPlaylist = (name) => OST_NAME_RE.test(String(name ?? '')) || !String(name ?? '').trim();

// Klasör süzgeci: yalnızca whitelist klasörlere DOĞRUDAN ait playlistler alınır.
// Harita main()'de doldurulur (src/data/playlist-folders.json).
let playlistFolderMap = { exists: false };

// ---------------------------------------------------------------- yardımcılar

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString('base64');

async function readJson(p, fallback) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
}

let token = '';
let lastWindow = [];

/** Kaba hız sınırı: 30 sn'lik pencerede 170 isteği geçme. */
async function throttle() {
  const now = Date.now();
  lastWindow = lastWindow.filter((t) => now - t < 30000);
  if (lastWindow.length >= 170) {
    const wait = 30000 - (now - lastWindow[0]) + 50;
    if (wait > 0) await sleep(wait);
  }
  lastWindow.push(Date.now());
}

/** Tek API çağrısı; 429'da bekleyip tekrar dener. */
async function api(u, { retries = 3 } = {}) {
  for (let i = 0; i <= retries; i++) {
    await throttle();
    const res = await fetch(`https://api.spotify.com/v1${u}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 3);
      console.warn(`   ⏳ 429 — ${retry}s bekleniyor`);
      await sleep(retry * 1000);
      continue;
    }
    return res;
  }
  throw new Error(`Üst üste 429: ${u}`);
}

/** Sayfalama; her sayfayı handler'a verir. `next` yoksa biter. */
async function paged(u, handler) {
  let next = u;
  while (next) {
    const res = await api(next);
    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`HTTP ${res.status} ${body}`), { status: res.status });
    }
    const json = await res.json();
    await handler(json);
    next = json.next ? json.next.replace('https://api.spotify.com/v1', '') : null;
  }
}

async function getAccessToken() {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${b64(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }).toString(),
  });
  if (!res.ok) throw new Error(`Token alınamadı: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// ------------------------------------------------------------- tür zenginleştirme

let genreCache = {};

// Last.fm etiketlerinde tür olmayan (gürültü) etiketler
const JUNK_TAGS = new Set([
  'seen live', 'live', 'favorites', 'favourite', 'favourites', 'favorite',
  'albums i own', 'i own this', 'to listen', 'music', 'spotify', 'love',
  'loved', 'my music', 'vinyl', 'awesome', 'cool', 'best', 'beautiful',
  'favorite songs', 'fav', 'listen', 'songs', 'artist', 'band', 'all',
  'other', 'misc', 'unknown', 'under 2000 listeners', 'wishlist', 'owned',
  'covers', 'cover', 'turkish', 'turkiye', 'turkey', 'türkiye', 'türkçe',
  '80s', '90s', '70s', '60s', '2000s', '2010s',
]);

function cleanTags(tags) {
  const out = [];
  for (const t of tags || []) {
    const n = String(t?.name || '').trim().toLowerCase();
    if (!n || JUNK_TAGS.has(n) || n.length < 3) continue;
    if (!out.includes(n)) out.push(n);
    if (out.length >= 6) break;
  }
  return out;
}

function genreCounts(playlist) {
  const map = new Map();
  for (const a of playlist.artists || []) {
    const cached = a.name && genreCache[a.name.toLowerCase()];
    if (!cached) continue;
    for (const g of cached.tags || []) map.set(g, (map.get(g) || 0) + a.count);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'));
}

/** Sanatçı türlerini Last.fm'den (artist.getTopTags) çeker. */
async function enrichGenres(playlists, budget) {
  if (!LASTFM_KEY) {
    console.warn('⚠️  LASTFM_API_KEY yok — tür çekimi atlandı (.env\'e ekle)');
    return { fetched: 0, remaining: 0, skipped: true };
  }

  const need = new Map(); // anahtar (küçük harf isim) -> isim
  for (const p of playlists) {
    for (const a of p.artists || []) {
      if (!a.name) continue;
      const key = a.name.toLowerCase();
      if (!genreCache[key]) need.set(key, a.name);
    }
  }
  const queue = Array.from(need.entries()).slice(0, budget);
  console.log(`🎼 Last.fm tür: ${queue.length} çekilecek / ${need.size} eksik (bütçe ${budget})`);

  let done = 0;
  for (const [key, name] of queue) {
    const url =
      `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags` +
      `&artist=${encodeURIComponent(name)}&api_key=${encodeURIComponent(LASTFM_KEY)}` +
      `&format=json&autocorrect=1`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const j = await res.json();
        const tags = cleanTags(j?.toptags?.tag);
        genreCache[key] = { name, tags };
      } else if (res.status === 429) {
        await sleep(2000);
        continue;
      } else {
        genreCache[key] = { name, tags: [] };
      }
    } catch {
      genreCache[key] = { name, tags: [] };
    }
    done++;
    if (done % 100 === 0) console.log(`   ... ${done}/${queue.length}`);
    await sleep(220); // ~4,5 istek/sn
  }
  return { fetched: done, remaining: Math.max(0, need.size - queue.length) };
}

// ------------------------------------------------------------------- ana akış

async function fullFetch() {
  const meRes = await api('/me');
  if (!meRes.ok) throw new Error(`/me başarısız: ${meRes.status}`);
  const me = await meRes.json();
  console.log(`👤 ${me.display_name} (${me.id}) — ${me.product}`);

  // 1) playlist listesi
  const raw = [];
  await paged('/me/playlists?limit=50', async (json) => {
    for (const p of json.items || []) if (p) raw.push(p);
  });

  const owned = raw.filter((p) => p.owner?.id === me.id);
  const publicOwned = owned.filter((p) => p.public === true);
  const nameKept = publicOwned.filter((p) => !isExcludedPlaylist(p.name));
  const nameSkipped = publicOwned.length - nameKept.length;
  const kept = nameKept.filter((p) => isKeptByFolder(playlistFolderMap, p.id));
  const folderSkipped = nameKept.length - kept.length;
  console.log(`📋 ${raw.length} liste • ${owned.length} bana ait • ${publicOwned.length} public (bana ait)`);
  console.log(
    `   atlanan: ${raw.length - owned.length} takip/başkası, ${owned.length - publicOwned.length} özel, ` +
      `${nameSkipped} [ost]/isimsiz, ${folderSkipped} whitelist dışı klasör`,
  );

  // 2) her playlistin şarkıları
  const output = [];
  let skipped = 0;
  for (let i = 0; i < kept.length; i++) {
    const pl = kept[i];
    const tracks = [];
    let earliestAddedAt = null;
    try {
      await paged(`/playlists/${pl.id}/items?limit=100`, async (json) => {
        for (const it of json.items || []) {
          // Playlistin oluşturulma tarihi için en eski ekleme anını yakala
          // (sanatçı/yerel filtresinden bağımsız olarak tüm öğeler sayılır).
          const a = it?.added_at;
          if (a && (earliestAddedAt === null || a < earliestAddedAt)) earliestAddedAt = a;
          const item = it?.item ?? it?.track;
          if (!item || it.is_local || !item.name) continue;
          const trackArtists = (item.artists || []).map((a) => ({ name: a.name, id: a.id }));
          // Hariç tutulan sanatçılardan biri geçiyorsa şarkıyı tamamen atla.
          if (trackArtists.some((a) => isExcluded(a.name))) continue;
          tracks.push({
            name: item.name,
            artists: trackArtists,
            album: item.album?.name || '',
            durationMs: item.duration_ms || 0,
          });
        }
      });
    } catch (e) {
      skipped++;
      console.warn(`   ⚠️ atlandı (${e.status}): ${pl.name}`);
      continue;
    }

    const artistMap = new Map();
    for (const t of tracks)
      for (const a of t.artists) {
        const key = a.id || a.name.toLowerCase();
        const cur = artistMap.get(key) || { name: a.name, id: a.id, count: 0 };
        cur.count++;
        artistMap.set(key, cur);
      }
    const artists = Array.from(artistMap.values()).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'),
    );

    // Hariç tutma sonrası tamamen boşalan listeyi hiç ekleme (silinmiş sayılır).
    if (tracks.length === 0) {
      console.log(`   🗑️  tamamen boşaldı, listeden çıkarıldı: ${pl.name}`);
      continue;
    }

    output.push({
      id: pl.id,
      name: pl.name,
      description: pl.description || null,
      url: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`,
      cover: pl.images?.[0]?.url || null,
      owner: pl.owner?.display_name || pl.owner?.id || null,
      trackCount: tracks.length || (pl.items?.total ?? pl.tracks?.total ?? 0),
      durationMs: tracks.reduce((s, t) => s + t.durationMs, 0),
      artistCount: artists.length,
      albumCount: new Set(tracks.map((t) => t.album).filter(Boolean)).size,
      createdAt: earliestAddedAt || null,
      artists,
      genres: [],
      tracks: tracks.slice(0, TRACK_PREVIEW),
    });

    if ((i + 1) % 25 === 0) console.log(`   ... ${i + 1}/${kept.length} playlist`);
  }

  console.log(`✅ ${output.length} playlist çekildi${skipped ? ` (${skipped} atlandı)` : ''}`);
  return output;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('❌ Eksik env: SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN (.env)');
    process.exit(1);
  }
  token = await getAccessToken();
  genreCache = await readJson(GENRE_CACHE, {});
  // Hariç tutulan sanatçıların tür önbelleğini kalıcı olarak temizle.
  for (const k of Object.keys(genreCache)) {
    if (isExcluded(genreCache[k]?.name || k)) delete genreCache[k];
  }

  playlistFolderMap = await loadPlaylistFolderMap();
  if (playlistFolderMap.exists) {
    console.log(`🗂️  klasör eşlemesi: ${playlistFolderMap.whitelist.size} whitelist klasör`);
  } else {
    console.warn('⚠️  src/data/playlist-folders.json yok — klasör süzgeci UYGULANMIYOR (npm run spotify:folders)');
  }

  let playlists;
  if (GENRES_ONLY) {
    playlists = (await readJson(OUT, { playlists: [] })).playlists;
    if (!playlists.length) {
      console.error('❌ Önce tam çekim yap: npm run spotify');
      process.exit(1);
    }
    // Savunma: hariç tutulan sanatçıları, isim kuralına takılan listeleri ve
    // whitelist dışı klasörlerdeki playlistleri burada da temizle.
    playlists = playlists
      .map((p) => ({
        ...p,
        artists: (p.artists || []).filter((a) => !isExcluded(a.name)),
        tracks: (p.tracks || []).filter((t) => !(t.artists || []).some((a) => isExcluded(a.name))),
      }))
      .filter(
        (p) => (p.artists || []).length > 0 && !isExcludedPlaylist(p.name) && isKeptByFolder(playlistFolderMap, p.id),
      );
  } else {
    playlists = await fullFetch();
  }

  const { fetched, remaining } = await enrichGenres(playlists, GENRE_BUDGET);
  for (const p of playlists) p.genres = genreCounts(p);

  const prevFetchedAt = (await readJson(OUT, {})).fetchedAt || null;
  await writeFile(
    OUT,
    JSON.stringify({ fetchedAt: GENRES_ONLY ? prevFetchedAt : new Date().toISOString(), playlists }, null, 2),
  );
  await writeFile(GENRE_CACHE, JSON.stringify(genreCache, null, 2));

  const size = Buffer.byteLength(JSON.stringify(playlists)) / 1024;
  console.log(`💾 ${OUT} — ${playlists.length} playlist, ${Math.round(size)} KB`);
  console.log(`🎼 tür: ${fetched} yeni çekildi, ${remaining} kaldı${remaining ? ' → npm run spotify -- --genres-only ile devam' : ''}`);
}

main().catch((e) => {
  console.error('❌ Hata:', e.message || e);
  process.exit(1);
});
