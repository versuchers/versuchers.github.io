#!/usr/bin/env node
/**
 * Spotify "Extended Streaming History" arşivini okuyup özetler ve
 * src/data/music/*.json olarak yazar.
 *
 * Çalıştırma:  node scripts/build-music.mjs
 *              MUSIC_DIR="/başka/yol" node scripts/build-music.mjs
 *
 * Ham arşiv büyüktür (yüzlerce MB); tarayıcıya asla gönderilmez. Yalnızca
 * burada üretilen küçük özet JSON'lar repoya girer. Bu yüzden build sırasında
 * ham arşive ihtiyaç yoktur.
 *
 * Tanımlar:
 *   "çalma" (scrobble) = en az 30 sn dinlenen kayıt (Last.fm mantığı).
 *   Süre (ms)          = gerçekten dinlenen tüm milisaniyeler (atlamalar dâhil).
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'src', 'data', 'music');
const MUSIC_DIR =
	process.env.MUSIC_DIR || '/home/versucher/Downloads/Spotify Extended Streaming History';

const MIN_MS = 30_000; // scrobble eşiği
const DETAIL_MIN = 25; // albüm/şarkı detay eşiği (çalma). Sanatçılar eşik yerine
                       // "en çok dinlenen ilk 666" kuralıyla seçilir (LIST_LIMIT).
const Y0 = 2016;
const Y1 = 2026;
const YN = Y1 - Y0 + 1;
const TZ_MS = 3 * 3600 * 1000; // Türkiye sabit UTC+3 (2016'dan beri)

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** URL-güvenli slug. Latin dışı adlar boş dönerse hash ile desteklenir. */
function slugify(input) {
	return String(input ?? '')
		.toLowerCase()
		.replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] ?? c)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
function hash(s) {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
	return h.toString(36);
}
function makeSlug(name) {
	const s = slugify(name);
	return s || 'x-' + hash(String(name));
}

const nowYearIdx = (y) => y - Y0;
const blank = () => new Array(YN).fill(0);

// Sanatçı eşleme anahtarı: trim + küçük harf (locale YOK, 'tr' DEĞİL).
// "Buz" ile "BUZ" aynı sanatçıdır: çalmalar toplanır, görünen ad en çok
// çalınan yazımdır (aşağıda slug bölümünde çözülür).
const artistKey = (name) => String(name ?? '').trim().toLowerCase();

function getArtist(map, name) {
	const key = artistKey(name);
	let a = map.get(key);
	if (!a) {
		a = { key, name, spellings: new Map(), plays: 0, ms: 0, first: null, last: null, byYear: blank() };
		map.set(key, a);
	}
	return a;
}
function touch(e, ts, idx) {
	if (e.first === null || ts < e.first) e.first = ts;
	if (e.last === null || ts > e.last) e.last = ts;
	if (idx >= 0 && idx < YN) e.byYear[idx] += 1;
}

async function main() {
	const files = (await readdir(MUSIC_DIR))
		.filter((f) => /^Streaming_History_Audio_.*\.json$/.test(f))
		.sort();
	if (!files.length) {
		console.error(`Ham arşiv bulunamadı: ${MUSIC_DIR}`);
		process.exit(1);
	}

	const seen = new Set();
	let rawRows = 0;
	let musicRows = 0; // dedup sonrası müzik satırı
	let scrobbleCount = 0;
	let musicMs = 0;
	let podcastRows = 0;

	const artists = new Map();
	const albums = new Map(); // artist \u0000 album
	const tracks = new Map(); // uri
	const artistAlbums = new Map();

	const dayPlays = new Map();
	const dayMs = new Map();
	const yearPlays = blank();
	const yearMs = blank();
	const weekdayHour = Array.from({ length: 7 }, () => new Array(24).fill(0));
	const hourPlays = new Array(24).fill(0);
	const dowPlays = new Array(7).fill(0);

	const A0 = String.fromCharCode(0);

	for (const file of files) {
		const text = await readFile(join(MUSIC_DIR, file), 'utf-8');
		const rows = JSON.parse(text);
		for (const r of rows) {
			rawRows++;
			const track = r.master_metadata_track_name;
			if (!track) {
				if (r.episode_name) podcastRows++;
				continue;
			}
			const ts = r.ts;
			if (!ts) continue;
			const uri = r.spotify_track_uri || `${r.master_metadata_album_artist_name}${A0}${track}`;
			const key = `${ts}|${uri}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const artist = r.master_metadata_album_artist_name || 'Bilinmeyen';
			const album = r.master_metadata_album_album_name || 'Bilinmeyen';
			const ms = r.ms_played || 0;
			const isScrobble = ms >= MIN_MS;

			musicRows++;
			musicMs += ms;
			if (isScrobble) scrobbleCount++;

			// yerel zaman (UTC+3)
			const d = new Date(new Date(ts).getTime() + TZ_MS);
			const yr = d.getUTCFullYear();
			const yIdx = nowYearIdx(yr);
			const ymd = `${yr}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
				d.getUTCDate(),
			).padStart(2, '0')}`;
			const dow = d.getUTCDay(); // 0=Pazar
			const hour = d.getUTCHours();

			// gün/ay/yıl — yalnızca scrobble'lar sayılır
			if (isScrobble) {
				dayPlays.set(ymd, (dayPlays.get(ymd) || 0) + 1);
				if (yIdx >= 0 && yIdx < YN) yearPlays[yIdx] += 1;
				weekdayHour[dow][hour] += 1;
				hourPlays[hour] += 1;
				dowPlays[dow] += 1;
			}
			dayMs.set(ymd, (dayMs.get(ymd) || 0) + ms);
			if (yIdx >= 0 && yIdx < YN) yearMs[yIdx] += ms;

			// varlıklar
			const a = getArtist(artists, artist);
			a.ms += ms;
			const albKey = artist + A0 + album;
			let al = albums.get(albKey);
			if (!al) {
				al = { name: album, artist, plays: 0, ms: 0, first: null, last: null, byYear: blank() };
				albums.set(albKey, al);
			}
			al.ms += ms;
			const t = tracks.get(uri);
			if (!t) {
				tracks.set(uri, { name: track, artist, album, uri, plays: 0, ms: 0, first: null, last: null, byYear: blank() });
			}
			const tr = tracks.get(uri);
			tr.ms += ms;

			if (isScrobble) {
				a.plays++;
				const sp = a.spellings.get(artist) || { name: artist, plays: 0 };
				sp.plays++;
				a.spellings.set(artist, sp);
				touch(a, ts, yIdx);
				al.plays++;
				touch(al, ts, yIdx);
				tr.plays++;
				touch(tr, ts, yIdx);

				// iç içe indeksler (sanatçı katmanı normalize anahtarla)
				let aa = artistAlbums.get(a.key);
				if (!aa) { aa = new Map(); artistAlbums.set(a.key, aa); }
				let aav = aa.get(albKey);
				if (!aav) { aav = { name: album, key: albKey, plays: 0, ms: 0 }; aa.set(albKey, aav); }
				aav.plays++; aav.ms += ms;
			}
		}
	}

	// ---------------------------------------------------------------- slug'lar
	const usedArtist = new Map();
	const artistSlug = new Map(); // normalize edilmiş sanatçı anahtarı -> slug
	for (const a of artists.values()) {
		// Görünen ad: en çok çalınan yazım (beraberlikte ilk görülen korunur).
		let best = a.name;
		let bestPlays = a.spellings.get(best)?.plays ?? 0;
		for (const sp of a.spellings.values()) {
			if (sp.plays > bestPlays) { best = sp.name; bestPlays = sp.plays; }
		}
		a.name = best;
		let s = makeSlug(a.name);
		const n = usedArtist.get(s) || 0;
		usedArtist.set(s, n + 1);
		if (n > 0) s = `${s}-${n + 1}`;
		artistSlug.set(a.key, s);
	}
	const usedAlbum = new Map();
	const albumSlug = new Map();
	for (const [k, al] of albums) {
		let s = makeSlug(al.name);
		const n = usedAlbum.get(s) || 0;
		usedAlbum.set(s, n + 1);
		if (n > 0) s = `${s}-${n + 1}`;
		albumSlug.set(k, s);
	}
	const usedTrack = new Map();
	const trackSlug = new Map();
	for (const [uri, t] of tracks) {
		let s = makeSlug(`${t.artist}-${t.name}`);
		const n = usedTrack.get(s) || 0;
		usedTrack.set(s, n + 1);
		if (n > 0) s = `${s}-${n + 1}`;
		trackSlug.set(uri, s);
	}

	// Aynı (sanatçı + albüm + şarkı) adına sahip kayıtlar tek kayıtta birleştirilir.
	// Bunlar aynı şarkının farklı Spotify URI'leridir (single/albüm sürümü, bölgesel
	// yayın vb.) ve listelerde mükerrer satır oluşturmamalı. Çalma ile süre toplanır,
	// yıllık seriler eklenir; temsilci URI en çok çalınan sürümdür, slug (dolayısıyla
	// kapak) ondan alınır — böylece mevcut slug/kapak anahtarları korunur.
	const mergedTracks = new Map(); // sanatçı \u0000 albüm \u0000 şarkı -> kayıt
	const mergedByArtist = new Map(); // sanatçı -> Map(k -> kayıt)
	const mergedByAlbum = new Map(); // sanatçı \u0000 albüm -> Map(k -> kayıt)
	for (const [uri, t] of tracks) {
		const albKey = t.artist + A0 + t.album;
		const k = albKey + A0 + t.name;
		let v = mergedTracks.get(k);
		if (!v) {
			v = {
				name: t.name, artist: t.artist, album: t.album, uri,
				plays: 0, ms: 0, first: null, last: null, byYear: blank(), slug: null, best: -1,
			};
			mergedTracks.set(k, v);
			const tak = artistKey(t.artist);
			let ma = mergedByArtist.get(tak);
			if (!ma) { ma = new Map(); mergedByArtist.set(tak, ma); }
			ma.set(k, v);
			let mb = mergedByAlbum.get(albKey);
			if (!mb) { mb = new Map(); mergedByAlbum.set(albKey, mb); }
			mb.set(k, v);
		}
		v.plays += t.plays;
		v.ms += t.ms;
		if (t.first && (v.first === null || t.first < v.first)) v.first = t.first;
		if (t.last && (v.last === null || t.last > v.last)) v.last = t.last;
		for (let i = 0; i < YN; i++) v.byYear[i] += t.byYear[i];
		if (t.plays > v.best) { v.best = t.plays; v.uri = uri; }
	}
	for (const v of mergedTracks.values()) v.slug = trackSlug.get(v.uri) ?? null;

	// ------------------------------------------------------------- diziler
	const num = (m, k) => m.get(k) || 0;

	const years = [];
	for (let i = 0; i < YN; i++) {
		if (yearPlays[i] || yearMs[i]) years.push({ year: Y0 + i, plays: yearPlays[i], ms: yearMs[i], newArtists: 0 });
	}

	// keşif: her sanatçının ilk çalma yılı
	const newByYear = new Array(YN).fill(0);
	for (const a of artists.values()) {
		if (a.first) {
			const y = new Date(new Date(a.first).getTime() + TZ_MS).getUTCFullYear();
			const i = nowYearIdx(y);
			if (i >= 0 && i < YN) newByYear[i] += 1;
		}
	}
	for (const y of years) y.newArtists = newByYear[nowYearIdx(y.year)];

	const days = [...dayPlays.keys()].sort().map((d) => ({ d, plays: num(dayPlays, d), ms: num(dayMs, d) }));

	// sanatçı detay kayıtları: en çok dinlenen ilk 666 (aşağıda LIST_LIMIT ile
	// kırpılır). Eşik yerine sıralama+kırpma kullanılır; yalnızca 0 çalmalı
	// (sadece atlanan) kayıtlar dışlanır.
	const artistArr = [];
	for (const a of artists.values()) {
		if (a.plays <= 0) continue;
		// En çok dinlenen şarkılar: aynı (albüm + şarkı) adına sahip kayıtlar zaten
		// tek kayıtta birleşiktir (mergedByArtist) ve çalma/süre toplamıdır.
		const tops = [...(mergedByArtist.get(a.key)?.values() || [])]
			.filter((x) => x.plays > 0)
			.sort((x, y) => y.plays - x.plays || x.name.localeCompare(y.name, 'tr'))
			.slice(0, 25)
			.map((x) => ({ name: x.name, album: x.album, plays: x.plays, ms: x.ms, slug: x.slug }));
		const topAlbums = [...(artistAlbums.get(a.key)?.values() || [])]
			.sort((x, y) => y.plays - x.plays)
			.slice(0, 12)
			.map((x) => {
				const k = x.key;
				return { name: x.name, plays: x.plays, ms: x.ms, slug: albumSlug.get(k) ?? null };
			});
		artistArr.push({
			slug: artistSlug.get(a.key),
			name: a.name,
			plays: a.plays,
			ms: a.ms,
			first: a.first,
			last: a.last,
			trackCount: [...(mergedByArtist.get(a.key)?.values() || [])].filter((x) => x.plays > 0).length,
			albumCount: (artistAlbums.get(a.key) || new Map()).size,
			byYear: a.byYear,
			topTracks: tops,
			topAlbums,
		});
	}

	// albüm detay kayıtları
	const albumArr = [];
	for (const [k, al] of albums) {
		if (al.plays < DETAIL_MIN) continue;
		const tt = [...(mergedByAlbum.get(k)?.values() || [])]
			.filter((x) => x.plays > 0)
			.sort((x, y) => y.plays - x.plays)
			.slice(0, 30)
			.map((x) => ({ name: x.name, plays: x.plays, ms: x.ms, slug: x.slug }));
		albumArr.push({
			slug: albumSlug.get(k),
			name: al.name,
			artist: al.artist,
			artistSlug: artistSlug.get(artistKey(al.artist)) ?? null,
			plays: al.plays,
			ms: al.ms,
			first: al.first,
			last: al.last,
			trackCount: [...(mergedByAlbum.get(k)?.values() || [])].filter((x) => x.plays > 0).length,
			byYear: al.byYear,
			tracks: tt,
		});
	}

	// şarkı detay kayıtları (aynı sanatçı \u0000 albüm \u0000 şarkı adı birleşiktir)
	const trackArr = [];
	for (const v of mergedTracks.values()) {
		if (v.plays < DETAIL_MIN) continue;
		trackArr.push({
			slug: v.slug,
			name: v.name,
			artist: v.artist,
			artistSlug: artistSlug.get(artistKey(v.artist)) ?? null,
			album: v.album,
			uri: v.uri,
			plays: v.plays,
			ms: v.ms,
			first: v.first,
			last: v.last,
			byYear: v.byYear,
		});
	}

	const byPlays = (arr) => arr.sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name, 'tr'));
	byPlays(artistArr);
	byPlays(albumArr);
	byPlays(trackArr);

	// veri dosyası üst sınırı: liste ve detay kayıtları en fazla 666 (çalma sırasına göre)
	const LIST_LIMIT = 666;
	for (const arr of [artistArr, albumArr, trackArr]) {
		if (arr.length > LIST_LIMIT) arr.splice(LIST_LIMIT);
	}

	// ------------------------------------------------------------- kilometre taşları
	const sortedDays = [...dayPlays.keys()].sort();
	let busiestDay = { d: null, plays: 0 };
	for (const [d, p] of dayPlays) if (p > busiestDay.plays) busiestDay = { d, plays: p };

	// en uzun seri (ardışık gün)
	let streak = { days: 0, start: null, end: null, cur: 0, curStart: null, prev: null };
	for (const d of sortedDays) {
		if (streak.prev) {
			const diff = (new Date(d) - new Date(streak.prev)) / 86400000;
			if (diff === 1) streak.cur++;
			else { streak.cur = 1; streak.curStart = d; }
		} else { streak.cur = 1; streak.curStart = d; }
		if (streak.cur > streak.days) streak = { ...streak, days: streak.cur, start: streak.curStart, end: d };
		streak.prev = d;
	}

	const firstTrack =
		[...tracks.values()].filter((t) => t.first).sort((a, b) => (a.first < b.first ? -1 : 1))[0] || null;

	const busiestHourIdx = hourPlays.indexOf(Math.max(...hourPlays));
	const topDow = dowPlays.indexOf(Math.max(...dowPlays));

	const stats = {
		generatedAt: new Date().toISOString(),
		source: 'Spotify Extended Streaming History',
		range: {
			first: [...tracks.values()].reduce((m, t) => (t.first && (!m || t.first < m) ? t.first : m), null),
			last: [...tracks.values()].reduce((m, t) => (t.last && (!m || t.last > m) ? t.last : m), null),
		},
		totals: {
			rawRows,
			musicRows,
			podcastRows,
			scrobbles: scrobbleCount,
			ms: musicMs,
			hours: Math.round(musicMs / 3600000),
			artists: artists.size,
			albums: albums.size,
			tracks: mergedTracks.size,
			days: sortedDays.length,
			skipRate: musicRows ? 1 - scrobbleCount / musicRows : 0,
		},
		years,
		days,
		weekdayHour,
		milestones: {
			firstPlay: firstTrack ? { name: firstTrack.name, artist: firstTrack.artist, ts: firstTrack.first } : null,
			busiestDay,
			longestStreak: { days: streak.days, start: streak.start, end: streak.end },
			busiestHour: { hour: busiestHourIdx, plays: hourPlays[busiestHourIdx] },
			topDow: { dow: topDow, plays: dowPlays[topDow] },
			mostPlayedArtist: artistArr[0] ? { name: artistArr[0].name, slug: artistArr[0].slug, plays: artistArr[0].plays } : null,
			mostPlayedAlbum: albumArr[0] ? { name: albumArr[0].name, artist: albumArr[0].artist, slug: albumArr[0].slug, plays: albumArr[0].plays } : null,
			mostPlayedTrack: trackArr[0] ? { name: trackArr[0].name, artist: trackArr[0].artist, slug: trackArr[0].slug, plays: trackArr[0].plays } : null,
		},
		topArtists: artistArr.slice(0, 10).map((a) => ({ slug: a.slug, name: a.name, plays: a.plays, ms: a.ms })),
	};

	await mkdir(OUT_DIR, { recursive: true });
	const write = async (name, data) => {
		const p = resolve(OUT_DIR, name);
		await writeFile(p, JSON.stringify(data) + '\n', 'utf-8');
		return p;
	};
	await write('stats.json', stats);
	await write('artists.json', artistArr);
	await write('albums.json', albumArr);
	await write('tracks.json', trackArr);

	// --------------------------------------------------- yıl başına ilk 100
	// /muzik sayfasındaki yıl sekmeleri: her yıl, her kategoride o yılın en
	// çok dinlenen 100 kaydı (666 listesi değil; tüm veriden). Detay sayfası
	// olmayan (666 dışı) kayıtlar href'siz yazılır; kapaklar covers.json'dan
	// eşlenir, dosya yoksa yıl kartlarında madalyon görünür.
	const YEAR_LIMIT = 100;
	const detailPage = {
		sanatci: new Set(artistArr.map((x) => x.slug)),
		album: new Set(albumArr.map((x) => x.slug)),
		sarki: new Set(trackArr.map((x) => x.slug)),
	};
	let coverMap = {};
	try {
		coverMap = JSON.parse(await readFile(resolve(OUT_DIR, 'covers.json'), 'utf-8'));
	} catch { /* kapak dosyası yoksa yıl listelerinde görsel olmaz */ }
	const artistName = new Map([...artists.values()].map((a) => [a.key, a.name]));
	const YEAR_KINDS = [
		{
			kat: 'sanatci',
			cover: 'artist',
			entries: () =>
				[...artists.values()].map((a) => ({ name: a.name, sub: null, plays: a.byYear, slug: artistSlug.get(a.key) })),
		},
		{
			kat: 'album',
			cover: 'album',
			entries: () =>
				[...albums.entries()].map(([k, al]) => ({
					name: al.name,
					sub: artistName.get(artistKey(al.artist)) ?? al.artist,
					plays: al.byYear,
					slug: albumSlug.get(k),
				})),
		},
		{
			kat: 'sarki',
			cover: 'track',
			entries: () =>
				[...mergedTracks.values()].map((t) => ({
					name: t.name,
					sub: artistName.get(artistKey(t.artist)) ?? t.artist,
					plays: t.byYear,
					slug: t.slug,
				})),
		},
	];
	const YEAR_DIR = resolve(__dirname, '..', 'public', 'data', 'muzik', 'yil');
	await mkdir(YEAR_DIR, { recursive: true });
	let yearFiles = 0;
	for (let i = 0; i < YN; i++) {
		const year = Y0 + i;
		for (const kind of YEAR_KINDS) {
			const items = kind
				.entries()
				.filter((e) => e.plays[i] > 0)
				.sort((a, b) => b.plays[i] - a.plays[i] || a.name.localeCompare(b.name, 'tr'))
				.slice(0, YEAR_LIMIT)
				.map((e) => ({
					name: e.name,
					...(e.sub ? { sub: e.sub } : {}),
					plays: e.plays[i],
					href: detailPage[kind.kat].has(e.slug) ? `/muzik/${kind.kat}/${e.slug}` : null,
					img: coverMap[`${kind.cover}:${e.slug}`] || null,
				}));
			await writeFile(
				resolve(YEAR_DIR, `${year}-${kind.kat}.json`),
				JSON.stringify({ year, kat: kind.kat, items }) + '\n',
				'utf-8',
			);
			yearFiles++;
		}
	}

	// ------------------------------------------------------------------ özet
	const f = (n) => n.toLocaleString('tr-TR');
	console.log(`Ham satır        : ${f(rawRows)}`);
	console.log(`Müzik (tekil)    : ${f(musicRows)}  (podcast: ${f(podcastRows)})`);
	console.log(`Çalma (>=30sn)   : ${f(scrobbleCount)}`);
	console.log(`Dinleme süresi   : ${f(Math.round(musicMs / 3600000))} saat`);
	console.log(`Sanatçı / Albüm / Şarkı : ${f(artists.size)} / ${f(albums.size)} / ${f(mergedTracks.size)}`);
	console.log(`Dinlenen gün     : ${f(sortedDays.length)}`);
	console.log(`Liste (ilk 666)  : ${f(artistArr.length)} sanatçı, ${f(albumArr.length)} albüm, ${f(trackArr.length)} şarkı`);
	console.log(`Yıl listeleri   : ${f(yearFiles)} dosya (public/data/muzik/, yılda ${f(YEAR_LIMIT)}er kayıt)`);
	console.log(`✓ Yazıldı: src/data/music/`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
