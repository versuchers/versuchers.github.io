/**
 * Sanatçı ek bilgisi (tür / ülke / dış bağlantılar) ve tür etiketi dizini.
 *
 * Veri: scripts/fetch-artist-info.mjs → src/data/music/artist-info.json.
 * Tür satırında yalnızca çıplak "metal" etiketi ve non-genre-tags.json siyah
 * listesi elenir; sanatçı başına en fazla GENRE_LIMIT tür gösterilir.
 * Türler kendi etiket sayfalarına (/muzik/tur/<slug>) bağlanır.
 */
import artistInfoJson from '../data/music/artist-info.json';
import nonGenreJson from '../data/non-genre-tags.json';
import { makeNonGenreSet, normTag } from './genre-tags.mjs';
import { artists, type Artist } from './music';
import { tagSlug } from './text';

interface RawInfo {
	genres?: string[];
	country?: string;
	links?: Record<string, string>;
}

export interface GenreLink {
	name: string;
	href: string | null;
}

export interface ArtistExtra {
	/** Gösterilen türler (en fazla 3), sayfa bağlantılarıyla. */
	genres: GenreLink[];
	country: string;
	links: Record<string, string>;
}

export interface GenrePage {
	slug: string;
	name: string;
	href: string;
	/** Türü (ilk 3 tür içinde) taşıyan sanatçılar, çalma sayısına göre. */
	artists: Artist[];
}

const INFO = artistInfoJson as Record<string, RawInfo>;
const NON_GENRE = makeNonGenreSet(nonGenreJson);

/** Bir sanatçı sayfasında gösterilecek en fazla tür sayısı. */
export const GENRE_LIMIT = 3;

/** Siyah liste + çıplak "metal" etiketi elenmiş ham tür listesi. */
function filteredGenres(slug: string): string[] {
	return (INFO[slug]?.genres ?? []).filter(
		(g) => normTag(g) !== 'metal' && !NON_GENRE.has(normTag(g)),
	);
}

export function genreHref(name: string): string {
	return `/muzik/tur/${tagSlug(name)}`;
}

/** Tür sayfası dizini: yalnızca sanatçı sayfalarında bağlantı verilen türler. */
export const genrePages: GenrePage[] = (() => {
	const bySlug = new Map<string, { names: Map<string, number>; artistSlugs: Set<string> }>();
	for (const a of artists) {
		const seen = new Set<string>();
		for (const g of filteredGenres(a.slug).slice(0, GENRE_LIMIT)) {
			const slug = tagSlug(g);
			if (seen.has(slug)) continue;
			seen.add(slug);
			let e = bySlug.get(slug);
			if (!e) {
				e = { names: new Map(), artistSlugs: new Set() };
				bySlug.set(slug, e);
			}
			e.names.set(g, (e.names.get(g) ?? 0) + 1);
			e.artistSlugs.add(a.slug);
		}
	}
	const byArtist = new Map(artists.map((a) => [a.slug, a]));
	const pickName = (names: Map<string, number>): string =>
		[...names.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'tr'))[0][0];
	return [...bySlug.entries()]
		.map(([slug, e]) => ({
			slug,
			name: pickName(e.names),
			href: `/muzik/tur/${slug}`,
			artists: [...e.artistSlugs]
				.map((s) => byArtist.get(s)!)
				.sort((x, y) => y.plays - x.plays || x.name.localeCompare(y.name, 'tr')),
		}))
		.sort((x, y) => x.name.localeCompare(y.name, 'tr'));
})();

const genreSlugSet = new Set(genrePages.map((g) => g.slug));

/** Türün sayfası varsa adresi, yoksa null (ör. çıplak "metal"). */
export function genrePageHref(name: string): string | null {
	const slug = tagSlug(name);
	return genreSlugSet.has(slug) ? `/muzik/tur/${slug}` : null;
}

/**
 * Tür slug'ına göre sanatçılar (çalma sayısına göre).
 *
 * Kaynak: `genrePages` ile aynı süzgeç (siyah liste + çıplak "metal", en fazla
 * GENRE_LIMIT tür). Playlist tür sayfaları kendi Last.fm etiketleriyle
 * eşleşen sanatçıları buradan alır; iki taraf aynı `tagSlug` havuzunu kullanır.
 */
export const artistsByGenre: Map<string, Artist[]> = (() => {
	const map = new Map<string, Artist[]>();
	for (const page of genrePages) map.set(page.slug, page.artists);
	return map;
})();

/** Sanatçı sayfası için tür (ilk 3), ülke ve dış bağlantılar. */
export function artistExtra(slug: string): ArtistExtra {
	const raw = INFO[slug] ?? {};
	const genres = filteredGenres(slug).slice(0, GENRE_LIMIT);
	return {
		genres: genres.map((g) => ({ name: g, href: genrePageHref(g) })),
		country: raw.country ?? '',
		links: raw.links ?? {},
	};
}

/** Bir sanatçının ülke etiketi adresi; ülke yoksa null. */
export function artistCountryHref(slug: string): string | null {
	const country = (INFO[slug]?.country ?? '').trim();
	if (!country || country === '-') return null;
	return `/ulke/${tagSlug(country)}`;
}

export interface CountryArtist {
	slug: string;
	name: string;
	plays: number;
}

/**
 * Ülke slug'ına göre sanatçılar (çalma sayısına göre).
 * Ülke sayfaları kitap/film/dizi kayıtlarının yanında sanatçıları da gösterir.
 */
export const artistsByCountry: Map<string, CountryArtist[]> = (() => {
	const map = new Map<string, CountryArtist[]>();
	for (const a of artists) {
		const country = (INFO[a.slug]?.country ?? '').trim();
		if (!country || country === '-') continue;
		const slug = tagSlug(country);
		let list = map.get(slug);
		if (!list) {
			list = [];
			map.set(slug, list);
		}
		list.push({ slug: a.slug, name: a.name, plays: a.plays });
	}
	for (const list of map.values()) {
		list.sort((x, y) => y.plays - x.plays || x.name.localeCompare(y.name, 'tr'));
	}
	return map;
})();

/** Ülke slug'ı → görünen ülke adı (sanatçı verisinden). */
export const countryLabels: Map<string, string> = (() => {
	const map = new Map<string, string>();
	for (const a of artists) {
		const country = (INFO[a.slug]?.country ?? '').trim();
		if (!country || country === '-') continue;
		const slug = tagSlug(country);
		if (!map.has(slug)) map.set(slug, country);
	}
	return map;
})();
