/**
 * Sanatçı ek bilgileri: ülke + dış bağlantılar.
 *
 * Kaynaklar:
 *   - MusicBrainz  → ülke + bandcamp / discogs / metal-archives (arama + lookup)
 *   - iTunes       → Apple Music sanatçı sayfası (artistLinkUrl; arama linki DEĞİL)
 *   - Spotify      → sanatçı sayfası (search API)
 *   - Last.fm      → isimden doğrudan türetilir (fetch yok)
 *   - Türler       → src/data/music/genres_cache.json (zaten mevcut; fetch yok)
 *
 * Kullanım:
 *   node --env-file-if-exists=.env scripts/fetch-artist-info.mjs [--force]
 *
 * Idempotent: `src/data/music/artist-info.json` içinde kaydı olan sanatçı
 * atlanır; --force ile yeniden çekilir. Eşleşmeyen kaynaklar sessizce boş
 * kalır. MusicBrainz kuralı: 1 istek/sn; 503/429'da backoff.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, createThrottle, createSpotifyApi, hasSpotifyCreds } from './lib/spotify.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARTISTS = path.join(ROOT, 'src/data/music/artists.json');
const TAG_CACHE = path.join(ROOT, 'src/data/music/genres_cache.json');
const OUT = path.join(ROOT, 'src/data/music/artist-info.json');
const FORCE = process.argv.includes('--force');
/** --fix-links: kayıtlı sanatçıların EXİK spotify/apple/bandcamp/discogs/metalArchives linklerini MB'den tamamla. */
const FIX_LINKS = process.argv.includes('--fix-links');

const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_UA = 'versuchers-site/1.0 (https://github.com/versuchers/versuchers.github.io)';
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** ISO ülke kodu → Türkçe ad. Bilinmeyen kodlar MB alan adına düşer. */
const COUNTRY_TR = {
	TR: 'Türkiye', DE: 'Almanya', US: 'ABD', GB: 'Birleşik Krallık', SE: 'İsveç',
	NO: 'Norveç', FI: 'Finlandiya', DK: 'Danimarka', IS: 'İzlanda', IT: 'İtalya',
	FR: 'Fransa', ES: 'İspanya', AT: 'Avusturya', AU: 'Avustralya', CA: 'Kanada',
	NL: 'Hollanda', BE: 'Belçika', PL: 'Polonya', RU: 'Rusya', UA: 'Ukrayna',
	GR: 'Yunanistan', JP: 'Japonya', BR: 'Brezilya', MX: 'Meksika', IE: 'İrlanda',
	PT: 'Portekiz', CH: 'İsviçre', CZ: 'Çekya', RO: 'Romanya', HU: 'Macaristan',
	BG: 'Bulgaristan', RS: 'Sırbistan', HR: 'Hırvatistan', SK: 'Slovakya',
	SI: 'Slovenya', LT: 'Litvanya', LV: 'Letonya', EE: 'Estonya', BY: 'Belarus',
	KZ: 'Kazakistan', AZ: 'Azerbaycan', AM: 'Ermenistan', GE: 'Gürcistan',
	IL: 'İsrail', IR: 'İran', IQ: 'Irak', EG: 'Mısır', MA: 'Fas', DZ: 'Cezayir',
	TN: 'Tunus', NG: 'Nijerya', ZA: 'Güney Afrika', NZ: 'Yeni Zelanya',
	KR: 'Güney Kore', CN: 'Çin', TW: 'Tayvan', SG: 'Singapur', AR: 'Arjantin',
	CL: 'Şili', CO: 'Kolombiya', PE: 'Peru', LU: 'Lüksemburg', MT: 'Malta',
	CY: 'Kıbrıs', BA: 'Bosna-Hersek', MK: 'Kuzey Makedonya', AL: 'Arnavutluk',
	ME: 'Karadağ', MD: 'Moldova',
};

const norm = (s) => String(s ?? '').trim().toLocaleLowerCase('tr').normalize('NFC').replace(/\s+/g, ' ');

async function readJson(p, fallback) {
	try {
		return JSON.parse(await readFile(p, 'utf8'));
	} catch {
		return fallback;
	}
}

/** MusicBrainz 503/429/502 için backoff'lu fetch. */
async function mbFetch(url, tries = 4) {
	for (let i = 0; i < tries; i++) {
		const res = await fetch(url, { headers: { 'User-Agent': MB_UA } });
		if (res.status === 503 || res.status === 429 || res.status === 502) {
			await sleepMs(3000 * (i + 1));
			continue;
		}
		return res;
	}
	return null;
}

/** MusicBrainz: isim araması → en iyi eşleşen MBID. */
async function mbSearch(name) {
	const url = `${MB_BASE}/artist?query=artist:${encodeURIComponent(`"${name}"`)}&fmt=json&limit=5`;
	const res = await mbFetch(url);
	if (!res?.ok) return null;
	const j = await res.json();
	const list = Array.isArray(j?.artists) ? j.artists : [];
	const exact = list.filter((a) => norm(a.name) === norm(name));
	return (exact[0] || list[0] || null)?.id || null;
}

/**
 * MusicBrainz lookup → ülke + bandcamp / discogs / metal-archives.
 * Lookup hem country kodu hem area adı döndürür. metal-archives relation'ı
 * "other databases" tipi altında geldiği için tip yerine hostname ile eşleşir.
 */
async function mbLookup(mbid) {
	const res = await mbFetch(`${MB_BASE}/artist/${mbid}?inc=url-rels&fmt=json`);
	if (!res?.ok) return null;
	const j = await res.json();
	const out = { country: j.country || '', area: j.area?.name || '', links: {} };
	for (const r of j?.relations ?? []) {
		const u = r?.url?.resource;
		if (!u) continue;
		if (r.type === 'bandcamp' || u.includes('bandcamp.com')) out.links.bandcamp ||= u;
		else if (r.type === 'discogs' || u.includes('discogs.com')) out.links.discogs ||= u;
		else if (u.includes('metal-archives.com')) out.links.metalArchives ||= u;
		else if (r.type === 'free streaming' && u.includes('open.spotify.com')) out.links.spotify ||= u;
	}
	return out;
}

/** iTunes: sanatçı adı birebir eşleşiyorsa Apple Music sayfası (artistLinkUrl). */
async function appleMusicUrl(name) {
	const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`;
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		const j = await res.json();
		const hit = (j?.results ?? []).find((r) => {
			const u = r.artistLinkUrl || r.artistViewUrl || '';
			return norm(r.artistName) === norm(name) && u.includes('music.apple.com');
		});
		return hit?.artistLinkUrl || hit?.artistViewUrl || null;
	} catch {
		return null;
	}
}

/** Last.fm sanatçı sayfası: isimden doğrudan türetilir. */
const lastfmUrl = (name) => `https://www.last.fm/music/${encodeURIComponent(name)}`;

// ---------------------------------------------------------------- main
const artists = await readJson(ARTISTS, []);
const tagCache = await readJson(TAG_CACHE, {});
const existing = await readJson(OUT, {});
const todo = FIX_LINKS
	? artists.filter((a) => a.slug && existing[a.slug])
		.filter((a) => {
			const l = existing[a.slug].links || {};
			return !(l.spotify && l.apple && l.bandcamp && l.discogs);
		})
	: artists.filter((a) => a.slug && (FORCE || !existing[a.slug]));
console.log(`Sanatçı: ${artists.length} | kayıtlı: ${Object.keys(existing).length} | çekilecek: ${todo.length}${FIX_LINKS ? ' (eksik linkler tamamlanacak)' : ''}`);
if (!todo.length) process.exit(0);

const hasSpotify = hasSpotifyCreds();
if (!hasSpotify) console.warn('⚠ SPOTIFY_* yok — Spotify bağlantıları atlanacak');
const { api } = hasSpotify ? createSpotifyApi({ retries: 3, throttle: createThrottle(170, 30000) }) : { api: null };

let ok = 0, fail = 0, n = 0;
for (const a of todo) {
  n++;
  const name = a.name;
  const info = { genres: tagCache[norm(name)]?.tags ?? [], country: '', links: {} };
  try {
    // MusicBrainz: search → lookup (1/sn kuralı + backoff)
    const mbid = await mbSearch(name);
    await sleepMs(1100);
    if (mbid) {
      const mb = await mbLookup(mbid);
      if (mb) {
        info.country = COUNTRY_TR[mb.country] || mb.area || '';
        Object.assign(info.links, mb.links);
      }
      await sleepMs(1100);
    }
    info.links.apple = await appleMusicUrl(name) || undefined;
    // Spotify API yalnızca MB'den link gelmediyse ve fix modunda değilse
    // (429 kotası tükendiği için fix aşamasında API'ye hiç gidilmez).
    if (api && !FIX_LINKS && !info.links.spotify) {
      const res = await api(`/search?q=${encodeURIComponent(`artist:"${name}"`)}&type=artist&limit=5`);
      if (res.ok) {
        const j = await res.json();
        const hit = (j?.artists?.items ?? []).find((x) => norm(x.name) === norm(name));
        info.links.spotify = hit?.external_urls?.spotify || undefined;
      }
    }
    info.links.lastfm = lastfmUrl(name);
  } catch (e) {
    fail++;
    console.warn(`  ⚠ ${name}: ${e.message}`);
  }
  // boş alanları temizle ki JSON sade kalsın
  info.links = Object.fromEntries(Object.entries(info.links).filter(([, v]) => v));
  if (FIX_LINKS && existing[a.slug]) {
    // mevcut kaydın sadece eksik alanlarını doldur
    const cur = existing[a.slug];
    cur.links = { ...info.links, ...cur.links };
    cur.country ||= info.country;
    if (!cur.genres?.length) cur.genres = info.genres;
  } else {
    existing[a.slug] = info;
  }
  ok++;
  if (n % 25 === 0) {
    console.log(`  ${n}/${todo.length}…`);
    await writeFile(OUT, JSON.stringify(existing, null, 1) + '\n');
  }
}
await writeFile(OUT, JSON.stringify(existing, null, 1) + '\n');
console.log(`✔ ${ok} sanatçı işlendi${fail ? `, ${fail} hata` : ''} → ${path.relative(ROOT, OUT)}`);
