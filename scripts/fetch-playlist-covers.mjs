#!/usr/bin/env node
/**
 * Playlist kapaklarını log deposuna aynalar (indir → webp → push) ve
 * src/data/spotify-playlists.json içindeki `cover` alanını
 * https://versucher.com/log/playlist/<id>.webp adresine çevirir.
 *
 * Çalıştırma:  node scripts/fetch-playlist-covers.mjs [--force] [--no-push]
 *
 * - Zaten log deposunda olan kapaklar atlanır (kesintiden sonra devam edilebilir).
 * - Aynalama yoksa (klon/PAT yoksa) kapak Spotify CDN adresinde kalır — kırık olmaz.
 * - --no-push: dosyaları yerele yazar/veriyi günceller ama log deposuna
 *   commit/push YAPMAZ (yayına almadan hazırlamak için).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mirror, flush, hosted, logUrl } from './lib/mirror.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/spotify-playlists.json');
const FORCE = process.argv.includes('--force');
const NO_PUSH = process.argv.includes('--no-push');
const CONC = 6;

const isLog = (u) => typeof u === 'string' && u.includes('/log/playlist/');

async function main() {
	const data = JSON.parse(await readFile(OUT, 'utf8'));
	const playlists = data.playlists || [];
	const newly = [];
	let done = 0;

	const queue = playlists.filter((p) => {
		if (!p.cover) return false;
		if (!FORCE && isLog(p.cover)) return false;
		return true;
	});
	console.log(`🖼  ${playlists.length} playlist • ${queue.length} kapak aynalanacak`);

	const worker = async () => {
		for (;;) {
			const pl = queue.shift();
			if (!pl) break;
			const rel = `playlist/${pl.id}.webp`;
			const url = pl.cover;
			done++;
			if (await mirror(url, rel, 'playlist kapakları')) {
				newly.push({ id: pl.id, url, rel });
				pl.cover = logUrl(rel);
			}
			if (done % 25 === 0) {
				console.log(`   ... ${done}/${playlists.length}`);
				await writeFile(OUT, JSON.stringify(data, null, 2));
			}
		}
	};

	await Promise.all(Array.from({ length: CONC }, worker));

	if (NO_PUSH) {
		console.log(`\n⏸  --no-push: ${newly.length} kapak yerele yazıldı; log deposuna commit/push yapılmadı.`);
	} else {
		const pushed = newly.length ? await flush() : false;
		if (newly.length && !pushed) {
			let reverted = 0;
			for (const { id, url, rel } of newly) {
				if (!(await hosted(rel))) {
					const pl = playlists.find((p) => p.id === id);
					if (pl) pl.cover = url;
					reverted++;
				}
			}
			if (reverted) console.log(`   · yayında olmayan ${reverted} kapak özgün URL'ye döndürüldü`);
		}
	}

	await writeFile(OUT, JSON.stringify(data, null, 2));
	const self = playlists.filter((p) => isLog(p.cover)).length;
	console.log(`\n✓ ${self}/${playlists.length} kapak log deposundan geliyor`);
	console.log(`✓ Yazıldı: ${OUT}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
