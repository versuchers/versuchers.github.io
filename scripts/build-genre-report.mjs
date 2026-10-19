/**
 * Build sırasında tür etiketi süzgeç raporunu üretir.
 *
 * Kural: kaynak veri DEĞİŞMEZ. Bu betik src/data/spotify-playlists.json okur,
 * siteyle AYNI süzgeçleri uygular (exclude + klasör whitelist + non-genre
 * siyah liste + count >= 2 eşiği) ve elenen etiketleri
 * src/data/non-genre-report.json'a yazar + konsola özet basar.
 *
 * Raporda sessiz hiçbir şey yok:
 *  - nonGenre: siyah liste nedeniyle elenenler (etiket, kaç listede geçti)
 *  - threshold: eşik (<2 şarkı) nedeniyle elenenler (etiket, kaç listede geçti)
 *  - variantPairs: büyük ihtimalle aynı türün farklı yazımları (birleştirilmez,
 *    yalnızca listelenir; slug çakışmaları sayfa düzeyinde birleşir)
 *
 * Çıktı deterministiktir (zaman damgası yok), böylece build git'i kirletmez.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	GENRE_MIN_COUNT,
	normTag,
	makeNonGenreSet,
	filterGenres,
} from '../src/lib/genre-tags.mjs';
import { tagSlug } from '../src/lib/text.ts';
import { loadPlaylistFolderMap, isKeptByFolder } from './playlist-folders.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/non-genre-report.json');

const playlistsRaw = JSON.parse(
	await readFile(path.join(ROOT, 'src/data/spotify-playlists.json'), 'utf8'),
);
const overrides = JSON.parse(
	await readFile(path.join(ROOT, 'src/data/playlist-overrides.json'), 'utf8'),
);
const nonGenreList = JSON.parse(
	await readFile(path.join(ROOT, 'src/data/non-genre-tags.json'), 'utf8'),
);
const folderMap = await loadPlaylistFolderMap();

const excludedIds = new Set(overrides.exclude ?? []);
const listed = playlistsRaw.playlists.filter(
	(p) => !excludedIds.has(p.id) && isKeptByFolder(folderMap, p.id),
);

const nonGenreSet = makeNonGenreSet(nonGenreList);

const countByTag = (map, tag) => map.set(tag, (map.get(tag) ?? 0) + 1);

const nonGenreDrops = new Map(); // siyah liste nedeniyle elenen (etiket -> listede sayısı)
const thresholdDrops = new Map(); // eşik nedeniyle elenen
const keptTags = new Map(); // tutulan (etiket -> listede sayısı)
const keptSpellings = new Map(); // slug -> yazım -> liste sayısı (varyant raporu)

for (const pl of listed) {
	const { kept, droppedNonGenre, droppedThreshold } = filterGenres(pl.genres, nonGenreSet);
	for (const g of droppedNonGenre) countByTag(nonGenreDrops, normTag(g.name));
	for (const g of droppedThreshold) countByTag(thresholdDrops, normTag(g.name));
	for (const g of kept) {
		countByTag(keptTags, normTag(g.name));
		const slug = tagSlug(g.name);
		let variants = keptSpellings.get(slug);
		if (!variants) {
			variants = new Map();
			keptSpellings.set(slug, variants);
		}
		countByTag(variants, normTag(g.name));
	}
}

const byPlaysDescThenName = (a, b) => b.playlists - a.playlists || a.tag.localeCompare(b.tag);

const nonGenre = [...nonGenreDrops.entries()]
	.map(([tag, playlists]) => ({ tag, playlists }))
	.sort(byPlaysDescThenName);
const threshold = [...thresholdDrops.entries()]
	.map(([tag, playlists]) => ({ tag, playlists }))
	.sort(byPlaysDescThenName);
const variantPairs = [...keptSpellings.entries()]
	.filter(([, variants]) => variants.size > 1)
	.map(([slug, variants]) => ({
		slug,
		variants: [...variants.entries()]
			.map(([tag, playlists]) => ({ tag, playlists }))
			.sort(byPlaysDescThenName),
	}))
	.sort((a, b) => a.slug.localeCompare(b.slug));

const report = {
	note:
		'Tür etiketi süzgeç raporu (build sırasında scripts/build-genre-report.mjs ile üretilir). ' +
		'nonGenre = siyah liste (src/data/non-genre-tags.json), threshold = count < ' +
		`${GENRE_MIN_COUNT} eşiği. variantPairs = aynı slug'a düşen farklı yazımlar (birleştirilmedi).`,
	minCount: GENRE_MIN_COUNT,
	nonGenre,
	threshold,
	variantPairs,
	totals: {
		listedPlaylists: listed.length,
		keptTagOccurrences: [...keptTags.values()].reduce((a, b) => a + b, 0),
		keptTags: keptTags.size,
		droppedNonGenreTags: nonGenre.length,
		droppedNonGenreOccurrences: nonGenre.reduce((a, r) => a + r.playlists, 0),
		droppedThresholdTags: threshold.length,
		droppedThresholdOccurrences: threshold.reduce((a, r) => a + r.playlists, 0),
		variantPairGroups: variantPairs.length,
	},
};

await writeFile(OUT, JSON.stringify(report, null, '\t') + '\n', 'utf8');

console.log(`[genre-report] ${listed.length} liste süzgeçten geçirildi → ${OUT}`);
console.log(
	`[genre-report] siyah liste: ${report.totals.droppedNonGenreTags} etiket (${report.totals.droppedNonGenreOccurrences} listede görünüm), ` +
		`eşik (<${GENRE_MIN_COUNT} şarkı): ${report.totals.droppedThresholdTags} etiket (${report.totals.droppedThresholdOccurrences} listede görünüm), ` +
		`tutulan: ${report.totals.keptTags} etiket (${report.totals.keptTagOccurrences} listede görünüm)`,
);
console.log(
	`[genre-report] varyant (aynı slug, farklı yazım) grupları: ${report.totals.variantPairGroups}`,
);
console.log('[genre-report] en çok elenen ilk 10:');
for (const r of nonGenre.slice(0, 10)) {
	console.log(`  - ${r.tag} (${r.playlists} liste)`);
}
