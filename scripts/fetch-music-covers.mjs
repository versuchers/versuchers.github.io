#!/usr/bin/env node
/**
 * src/data/music/*.json içindeki detay varlıkları için Deezer'dan kapak/görsel
 * URL'i çeker ve src/data/music/covers.json olarak önbelleğe yazar.
 *
 * Çalıştırma:  node scripts/fetch-music-covers.mjs
 *
 * - Anahtar gerekmez. Rate limit için istekler arasında kısa bekleme vardır.
 * - Zaten önbellekte olan anahtarlar atlanır (kesintiden sonra devam edilebilir).
 * - Sonuç bulunamazsa anahtar eklenmez; arayüzde harf madalyonu gösterilir.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mirror, flush, hosted, logUrl } from './lib/mirror.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, '..', 'src', 'data', 'music');
const OUT = resolve(DIR, 'covers.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const DELAY = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NUL = String.fromCharCode(0);
const FORCE = process.argv.includes('--force');

// Kiril/benzeri "karıştırılabilir" harfleri Latin karşılığına çevirir; böylece
// sahne yazımları eşleşir (ör. "KoЯn" -> "korn", "Mgła" -> "mgla").
const CONF = {
	я: 'r', а: 'a', е: 'e', о: 'o', с: 'c', р: 'p', х: 'x', у: 'y', к: 'k', м: 'm',
	т: 't', в: 'b', н: 'h', і: 'i', ѕ: 's', ј: 'j', г: 'g', д: 'd', з: 'z', и: 'i',
	й: 'i', л: 'l', п: 'n', ф: 'f', ц: 'c', ч: 'c', ш: 's', щ: 's', ы: 'y', э: 'e',
	ю: 'yu', ё: 'e', ø: 'o', æ: 'ae', ß: 'ss', ð: 'd', þ: 'th',
};

const norm = (s) =>
	String(s ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^\x00-\x7f]/g, (c) => CONF[c] ?? c)
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

async function deezer(path) {
	for (let a = 0; a < 4; a++) {
		try {
			const res = await fetch('https://api.deezer.com/' + path, { headers: { 'User-Agent': UA } });
			if (res.status === 200) return await res.json();
			if (res.status === 429 || res.status >= 500) {
				await sleep(1500 * (a + 1));
				continue;
			}
			return null;
		} catch {
			await sleep(700 * (a + 1));
		}
	}
	return null;
}

const loadJson = async (f) => JSON.parse(await readFile(resolve(DIR, f), 'utf-8'));

async function main() {
	const artists = await loadJson('artists.json');
	const albums = await loadJson('albums.json');
	const tracks = await loadJson('tracks.json');

	let covers = {};
	try {
		covers = JSON.parse(await readFile(OUT, 'utf-8'));
	} catch {
		/* ilk çalıştırma */
	}

	const albumCoverByName = new Map(); // artist \u0000 albüm -> kapak
	const total = artists.length + albums.length + tracks.length;
	let done = 0;
	let fetched = 0;
	const newly = []; // bu çalışmada aynalanan { key, url, rel }

	const save = () => writeFile(OUT, JSON.stringify(covers, null, 0) + '\n', 'utf-8');
	const bogus = (u) => u && !/artist\/\d+\/image|album\/\d+\/image/.test(u);

	// Deezer görselini log deposuna aynalar (indir → webp → push) ve
	// covers.json'a log adresini yazar. Aynalama yoksa özgün URL kalır.
	const publish = async (key, kind, slug, url) => {
		if (!url || !bogus(url)) return;
		const rel = `music/${kind}/${slug}.webp`;
		if (await mirror(url, rel, `kapaklar: ${kind}`)) {
			newly.push({ key, url, rel });
			covers[key] = logUrl(rel);
		} else {
			covers[key] = url;
		}
	};

	// ------------------------------------------------------------ sanatçılar
	for (const a of artists) {
		const key = `artist:${a.slug}`;
		done++;
		if (!FORCE && key in covers) continue;
		const j = await deezer(`search/artist?q=${encodeURIComponent(a.name)}&limit=10`);
		const cand = j?.data || [];
		const exact = cand.filter((h) => norm(h.name) === norm(a.name));
		// Tam ad eşleşenler arasından en çok dinleyicisi olanı seç (yanlış
		// "adaş" sanatçıları eler: ör. Teoman fans=7 yerine fans=494.808).
		const hit = exact.length
			? exact.reduce((x, y) => ((y.nb_fan || 0) > (x.nb_fan || 0) ? y : x))
			: cand[0];
		const url = hit?.picture_xl || hit?.picture_big || hit?.picture_medium || null;
		await publish(key, 'artist', a.slug, url);
		fetched++;
		if (done % 50 === 0) console.log(`  ... ${done}/${total} (${fetched} istek)`);
		if (fetched % 200 === 0) await save();
		await sleep(DELAY);
	}

	// ---------------------------------------------------------------- albümler
	for (const al of albums) {
		const key = `album:${al.slug}`;
		done++;
		if (FORCE || !(key in covers)) {
			const j = await deezer(
				`search/album?q=${encodeURIComponent(al.artist + ' ' + al.name)}&limit=5`,
			);
			const hits = j?.data || [];
			const pick = hits.find((h) => norm(h.artist?.name) === norm(al.artist)) || hits[0];
			const url = pick?.cover_xl || pick?.cover_big || null;
			await publish(key, 'album', al.slug, url);
			fetched++;
			if (fetched % 200 === 0) await save();
			await sleep(DELAY);
		}
		if (covers[key]) albumCoverByName.set(al.artist + NUL + al.name, covers[key]);
	}

	// ---------------------------------------------------------------- şarkılar
	for (const t of tracks) {
		const key = `track:${t.slug}`;
		done++;
		if (!FORCE && key in covers) continue;
		let url = albumCoverByName.get(t.artist + NUL + t.album);
		if (!url) {
			const j = await deezer(`search?q=${encodeURIComponent(t.artist + ' ' + t.name)}&limit=5`);
			const hits = j?.data || [];
			const pick = hits.find((h) => norm(h.artist?.name) === norm(t.artist)) || hits[0];
			url = pick?.album?.cover_xl || pick?.album?.cover_big || null;
		}
		await publish(key, 'track', t.slug, url);
		fetched++;
		if (fetched % 200 === 0) await save();
		await sleep(DELAY);
	}

	// Aynalanan dosyaları push et; push tutmazsa yayında olmayanları özgün
	// (harici) URL'ye geri çevir — site asla kırık görsel göstermesin.
	const pushed = newly.length ? await flush() : false;
	if (newly.length && !pushed) {
		let reverted = 0;
		for (const { key, url, rel } of newly) {
			if (!(await hosted(rel))) {
				covers[key] = url;
				reverted++;
			}
		}
		if (reverted) console.log(`  · aynalanamayan ${reverted} kapak özgün URL'ye döndürüldü`);
	}

	await save();
	const ok = Object.keys(covers).length;
	const self = Object.values(covers).filter((u) => String(u).startsWith('http') && u.includes('/log/')).length;
	console.log(`\n✓ Kapaklar: ${ok}/${total} bulundu (${fetched} yeni istek)`);
	console.log(`✓ log deposundan gelen: ${self}/${ok}`);
	console.log(`✓ Yazıldı: src/data/music/covers.json`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
