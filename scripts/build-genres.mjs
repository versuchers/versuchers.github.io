#!/usr/bin/env node
/**
 * Sanatçı → tür verisi ve tür listeleri.
 *
 * - Türler Spotify export'unda yok; Last.fm artist.getTopTags ile BİR KEZ
 *   çekilir ve src/data/music/genres_cache.json'a yazılır (sonraki
 *   çalıştırmalarda istek atılmaz; cache'i seed eden kaynak:
 *   src/data/spotify-artist-genres.json).
 * - Sanatçının dinleme süresi (ms) türlerine EŞİT paylaştırılır.
 * - Çıktılar:
 *     src/data/music/genres.json              → 2016–2026 ilk 66 tür
 *     public/data/muzik/yil/<y>-tur.json      → aynı evrenin yıl bazlı sıralaması
 *
 * Çalışma: node --env-file-if-exists=.env scripts/build-genres.mjs [--no-fetch]
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HIST = '/home/versucher/Downloads/Spotify Extended Streaming History';
const CACHE_FILE = path.join(ROOT, 'src', 'data', 'music', 'genres_cache.json');
const SEED_FILE = path.join(ROOT, 'src', 'data', 'spotify-artist-genres.json');
const OUT = path.join(ROOT, 'src', 'data', 'music', 'genres.json');
const YEAR_DIR = path.join(ROOT, 'public', 'data', 'muzik', 'yil');

const API_KEY = process.env.LASTFM_API_KEY || '';
const NO_FETCH = process.argv.includes('--no-fetch');
const MIN_MS = 30_000;        // çalma eşiği (build-music ile aynı)
const FETCH_MIN_MS = 60_000;  // etiket çekilen asgari toplam dinleme (1 dk)
const GENRE_LIMIT = 66;
const TAG_CAP = 6;
const Y0 = 2016, Y1 = 2026, YN = Y1 - Y0 + 1;
const TZ_MS = 3 * 3600 * 1000;
const blank = () => new Array(YN).fill(0);
const artistKey = (n) => String(n ?? '').trim().toLowerCase();
const yearIdx = (ts) => Math.min(YN - 1, Math.max(0,
  new Date(new Date(ts).getTime() + TZ_MS).getUTCFullYear() - Y0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- blacklist
// Yalnızca BUNLARLA SINIRLI tam eşleşme elenir; "german metal", "turkish
// hip hop" gibi bileşikler korunur.
const JUNK = new Set([
  // çöp/genel etiketler
  'pop', 'seen live', 'favorites', 'favorite', 'awesome', 'amazing', 'beautiful',
  'love', 'best', 'classic', 'epic', 'chill', 'spotify', 'perfect', 'gem',
  'male vocalists', 'female vocalists', 'i love this artist', 'greatest',
  'under 2000 listeners', 'under 1000 listeners',
  // 'turkish'/'turkey' tek başına
  'turkish', 'turkey', 'türk', 'türkçe',
  // ülke / uyruk
  'germany', 'german', 'france', 'french', 'usa', 'america', 'american',
  'united states', 'uk', 'england', 'british', 'scotland', 'scottish',
  'sweden', 'swedish', 'norway', 'norwegian', 'finland', 'finnish',
  'denmark', 'danish', 'iceland', 'icelandic', 'greece', 'greek', 'italy',
  'italian', 'spain', 'spanish', 'portugal', 'portuguese', 'netherlands',
  'dutch', 'belgium', 'belgian', 'austria', 'austrian', 'poland', 'polish',
  'russia', 'russian', 'czech', 'japan', 'japanese', 'china', 'chinese',
  'korea', 'korean', 'canada', 'canadian', 'brazil', 'brazilian',
  'argentina', 'australia', 'australian', 'mexico', 'mexican', 'israel',
  'israeli', 'ireland', 'irish', 'hungary', 'hungarian', 'romania', 'romanian',
  'croatia', 'serbia', 'europe', 'european', 'middle eastern',
  // şehir
  'istanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'berlin', 'paris',
  'london', 'lisbon', 'athens', 'los angeles', 'new york', 'tokyo', 'seoul',
  // dönem
  '2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s', '1950s',
  "'80s", "'90s", "'70s", '80s', '90s', '70s',
]);

/** Küçük normalize sözlüğü: tutarlı adlar için. */
const SYNONYM = new Map([
  ['rap', 'hip hop'],
  ['blackmetal', 'black metal'],
  ['deathmetal', 'death metal'],
  ['thrashmetal', 'thrash metal'],
  ['heavy metal music', 'heavy metal'],
]);

function normGenre(g) {
  let s = String(g || '').trim().toLowerCase().replace(/[-_/]+/g, ' ');
  s = s.replace(/\s+/g, ' ');
  if (SYNONYM.has(s)) s = SYNONYM.get(s);
  return s;
}

/** Last.fm tag listesini sadeleştir (ad + sayı yok). */
function cleanTags(tags) {
  const out = [];
  for (const t of tags || []) {
    const n = String(t?.name || '').trim().toLowerCase();
    if (!n || n.length < 3) continue;
    if (!out.includes(n)) out.push(n);
    if (out.length >= 12) break;
  }
  return out;
}

// ---------------------------------------------------------------- 1) arşiv
const files = (await readdir(HIST))
  .filter((f) => /^Streaming_History_Audio_.*\.json$/.test(f))
  .sort();

const artists = new Map(); // key -> {name, byYearMs, byYearPlays}
const seen = new Set();
let rawRows = 0, musicRows = 0, scrobbles = 0;

for (const f of files) {
  const rows = JSON.parse(await readFile(path.join(HIST, f), 'utf-8'));
  for (const r of rows) {
    rawRows++;
    const track = r.master_metadata_track_name;
    const artist = r.master_metadata_album_artist_name;
    if (!track || !artist || !r.ts) continue;
    const uri = r.spotify_track_uri || `${artist}\0${track}`;
    const key = `${r.ts}|${uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    musicRows++;
    const ms = r.ms_played || 0;
    if (ms >= MIN_MS) scrobbles++;
    const yi = yearIdx(r.ts);
    let a = artists.get(artistKey(artist));
    if (!a) {
      a = { name: artist, byYearMs: blank(), byYearPlays: blank() };
      artists.set(artistKey(artist), a);
    }
    a.byYearMs[yi] += ms;
    if (ms >= MIN_MS) a.byYearPlays[yi]++;
  }
}

// ---------------------------------------------------------------- 2) cache
let cache = {};
try {
  cache = JSON.parse(await readFile(CACHE_FILE, 'utf-8'));
} catch {
  try {
    cache = JSON.parse(await readFile(SEED_FILE, 'utf-8'));
    console.log(`Cache seed: ${SEED_FILE} → ${Object.keys(cache).length} sanatçı`);
  } catch {
    cache = {};
  }
}

const totalMsOf = (a) => a.byYearMs.reduce((s, v) => s + v, 0);
const missing = [...artists.entries()]
  .filter(([k, a]) => totalMsOf(a) >= FETCH_MIN_MS && !cache[k])
  .sort((x, y) => totalMsOf(y[1]) - totalMsOf(x[1]));

console.log(`Arşiv: ${rawRows} satır / ${musicRows} tekil müzik / ${scrobbles} çalma`);
console.log(`Sanatçı: ${artists.size} | cache: ${Object.keys(cache).length} | çekilecek: ${missing.length}${NO_FETCH ? ' (--no-fetch)' : ''}`);

// ---------------------------------------------------------------- 3) fetch
async function fetchTags(name) {
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags` +
    `&artist=${encodeURIComponent(name)}&api_key=${encodeURIComponent(API_KEY)}` +
    `&format=json&autocorrect=1`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(2000); continue; }
      if (!res.ok) return [];
      const j = await res.json();
      return cleanTags(j?.toptags?.tag);
    } catch {
      await sleep(500);
    }
  }
  return [];
}

if (!NO_FETCH && missing.length) {
  if (!API_KEY) {
    console.warn('⚠ LASTFM_API_KEY yok — cache dışı sanatçılar etiketsiz kalacak');
  } else {
    let done = 0;
    for (const [k, a] of missing) {
      const tags = await fetchTags(a.name);
      cache[k] = { name: a.name, tags }; // boş olsa da yaz → tekrar istek atma
      done++;
      if (done % 100 === 0) {
        console.log(`  … ${done}/${missing.length}`);
        await writeFile(CACHE_FILE, JSON.stringify(cache));
      }
      await sleep(220);
    }
    console.log(`✓ ${done} sanatçının türü çekildi`);
  }
}
// cache'i her koşulda kalıcı yaz (seed edildiyse de)
await mkdir(path.dirname(CACHE_FILE), { recursive: true });
await writeFile(CACHE_FILE, JSON.stringify(cache));

// ---------------------------------------------------------------- 4) türler
// sanatçı adları da etiket olamaz (zaten blacklist'te ama büyük küme yardımı)
const nameSet = new Set(artists.keys());

const genre = new Map(); // tür -> {byYearMs, byYearPlays, artists:Set, yilArtists:[Set]}
let taggedMs = 0, untaggedMs = 0, junkDropped = 0;

const gEntry = (name) => {
  let g = genre.get(name);
  if (!g) {
    g = { byYearMs: blank(), byYearPlays: blank(), artists: new Set(),
          yilArtists: Array.from({ length: YN }, () => new Set()) };
    genre.set(name, g);
  }
  return g;
};

for (const [k, a] of artists) {
  const ms = totalMsOf(a);
  if (ms <= 0) continue;
  const raw = cache[k]?.tags || [];
  const genres = [];
  for (const t of raw) {
    const g = normGenre(t);
    if (!g || g.length < 3 || JUNK.has(g) || nameSet.has(g)) { junkDropped++; continue; }
    if (!genres.includes(g)) genres.push(g);
    if (genres.length >= TAG_CAP) break;
  }
  if (!genres.length) { untaggedMs += ms; continue; }
  taggedMs += ms;
  for (const g of genres) {
    const e = gEntry(g);
    e.artists.add(k);
    for (let yi = 0; yi < YN; yi++) {
      if (!a.byYearMs[yi]) continue;
      e.byYearMs[yi] += a.byYearMs[yi] / genres.length;
      e.byYearPlays[yi] += a.byYearPlays[yi] / genres.length;
      e.yilArtists[yi].add(k);
    }
  }
}

const totalMs = taggedMs + untaggedMs;
const ranking = [...genre.entries()]
  .map(([name, g]) => ({
    name,
    ms: g.byYearMs.reduce((s, v) => s + v, 0),
    plays: Math.max(1, Math.round(g.byYearPlays.reduce((s, v) => s + v, 0))),
    artists: g.artists.size,
    g,
  }))
  .sort((x, y) => y.ms - x.ms);

const universe = ranking.slice(0, GENRE_LIMIT);

// ---------------------------------------------------------------- 5) çıktı
await mkdir(YEAR_DIR, { recursive: true });
await writeFile(OUT, JSON.stringify(
  universe.map(({ name, ms, plays, artists }) => ({ name, ms, plays, artists })),
  null, 1,
));

let yearFiles = 0;
for (let yi = 0; yi < YN; yi++) {
  const year = Y0 + yi;
  const items = universe
    .filter(({ g }) => g.byYearMs[yi] > 0)
    .sort((x, y) => y.g.byYearMs[yi] - x.g.byYearMs[yi])
    .map(({ name, g }) => ({
      name,
      sub: `${g.yilArtists[yi].size} sanatçı`,
      plays: Math.max(1, Math.round(g.byYearPlays[yi])),
      href: null,
      img: null,
    }));
  await writeFile(path.join(YEAR_DIR, `${year}-tur.json`),
    JSON.stringify({ year, kat: 'tur', items }));
  yearFiles++;
}

const pct = (x) => `${((100 * x) / (totalMs || 1)).toFixed(1)}%`;
console.log('\nTÜR ÖZETİ');
console.log(`  sanatçı      : ${artists.size}`);
console.log(`  etiketli ms  : ${pct(taggedMs)}  | etiketsiz: ${pct(untaggedMs)}`);
console.log(`  elenen etiket: ${junkDropped} (blacklist/isim)`);
console.log(`  tür sayısı   : ${genre.size} → ilk ${universe.length} listelendi`);
console.log(`  dosya        : ${path.relative(ROOT, OUT)} + ${yearFiles} yıl dosyası`);
console.log('\n  ilk 10 tür (2016–2026):');
universe.slice(0, 10).forEach((x, i) =>
  console.log(`   ${String(i + 1).padStart(2)}. ${x.name.padEnd(24)} ${x.plays} çalma · ${x.artists} sanatçı`));
