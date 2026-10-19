/**
 * Playlist tür etiketleri: süzülmüş liste ve tür sayfaları için indeks.
 *
 * Kaynak veri (spotify-playlists.json) DEĞİŞTİRİLMEZ; süzgeç gösterim/build
 * sırasında uygulanır (bkz. src/lib/genre-tags.mjs). Rapor:
 * src/data/non-genre-report.json (scripts/build-genre-report.mjs üretir).
 */
import nonGenreJson from '../data/non-genre-tags.json';
import { makeNonGenreSet, filterGenres } from './genre-tags.mjs';
import {
	listedPlaylists,
	getPlaylistFolderIds,
	folderDisplayName,
	playlistFolders,
	type SpotifyPlaylist,
	type SpotifyGenreCount,
} from './playlists';
import { tagSlug } from './text';

const NON_GENRE = makeNonGenreSet(nonGenreJson);

/** Bir playlistin süzgeçten geçmiş türleri (eşik + siyah liste). */
export function keptGenres(pl: SpotifyPlaylist): SpotifyGenreCount[] {
	return filterGenres(pl.genres, NON_GENRE).kept;
}

/** Tür adından sayfa adresi: /playlist/tur/<slug> */
export function genreHref(name: string): string {
	return `/playlist/tur/${tagSlug(name)}`;
}

export interface GenreRow {
	id: string;
	name: string;
	folders: string[];
	/** Bu playlistte bu türün (slug grubunun) şarkı sayısı. */
	count: number;
}

export interface GenrePage {
	slug: string;
	/** Gösterilecek ad: en yaygın yazım. */
	name: string;
	rows: GenreRow[];
}

/**
 * Tür sayfaları: slug çakışmaları (ör. "hip hop"/"hip-hop") tek sayfada birleşir;
 * bir playlist aynı slug için birden fazla yazım içerirse satır bir kez görünür
 * ve sayıları toplanır. Sıralama: şarkı sayısı azalan, ardından ad A→Z (tr).
 */
export function genrePages(): GenrePage[] {
	const bySlug = new Map<
		string,
		{
			variantPlaylists: Map<string, Set<string>>; // yazım -> playlist id'ler
			rows: Map<string, GenreRow>; // playlist id -> satır
		}
	>();

	for (const pl of listedPlaylists()) {
		const kept = keptGenres(pl);
		if (kept.length === 0) continue;

		const folders = getPlaylistFolderIds(pl.id).map((id) =>
			folderDisplayName(playlistFolders.folders[id]?.name ?? id),
		);

		const perSlug = new Map<string, number>();
		for (const g of kept) {
			const slug = tagSlug(g.name);
			perSlug.set(slug, (perSlug.get(slug) ?? 0) + g.count);

			let entry = bySlug.get(slug);
			if (!entry) {
				entry = { variantPlaylists: new Map(), rows: new Map() };
				bySlug.set(slug, entry);
			}
			let ids = entry.variantPlaylists.get(g.name);
			if (!ids) {
				ids = new Set();
				entry.variantPlaylists.set(g.name, ids);
			}
			ids.add(pl.id);
		}

		for (const [slug, count] of perSlug) {
			bySlug.get(slug)!.rows.set(pl.id, {
				id: pl.id,
				name: pl.name,
				folders,
				count,
			});
		}
	}

	const pages: GenrePage[] = [];
	for (const [slug, entry] of bySlug) {
		const sorted = [...entry.variantPlaylists.entries()].sort(
			(a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], 'tr'),
		);
		const rows = [...entry.rows.values()].sort(
			(a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'),
		);
		pages.push({ slug, name: sorted[0][0], rows });
	}
	return pages.sort((a, b) => a.rows.length - b.rows.length || a.name.localeCompare(b.name, 'tr'));
}
