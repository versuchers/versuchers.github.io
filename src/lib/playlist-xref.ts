/**
 * Playlist <-> sanatçı sayfası eşleştirme modülü (build zamanı, statik).
 *
 * Kural:
 *  1. Spotify sanatçı kimliği iki tarafta birden olmadığı için (playlist
 *     track'inde id var, artists.json'da yok) eşleştirme normalize ad ile
 *     yapılır: küçük harf, baş/son boşluk, tekrarlayan boşluğu tek'e indirme,
 *     tipografik tırnak → düz tırnak. Türkçe ı/i, ş/s katlaması YOK.
 *  2. Çok sanatçılı şarkıda her sanatçı ayrı eşleşir.
 *  3. Sanatçı sayfası olmayan (dinlenmemiş) sanatçı için href üretilmez.
 *  4. Yalnızca sitede gösterilen (public) playlistler hesaba girer.
 *
 * Slug'lar mevcut veriden (artists.json / tracks.json) alınır; yeni slug
 * üretilmez. Şarkı sayfası eşleştirmesi: eşleşen sanatçının slug'ı +
 * normalize şarkı adı -> tracks.json'daki slug (varsa).
 */
import { listedPlaylists } from './playlists';
import { artists, tracks, hasArtist, hasTrack } from './music';

/** Kural 1: normalize ad (Türkçe katlama yok). */
export function normArtist(name: string): string {
	return String(name ?? '')
		.replace(/[\u2018\u2019\u201C\u201D\u02BC\u201A\u201B]/g, "'")
		.toLowerCase()
		.replace(/\u0307/g, '') // Türkçe İ küçültmesinin artefaktı (i + nokta)
		.replace(/\s+/g, ' ')
		.trim();
}

/** Normalize şarkı adı (aynı kural; birleştirilmiş sürümler tek geçer). */
function normTrack(name: string): string {
	return normArtist(name);
}

/** Normalize sanatçı adı -> sanatçı sayfası slug'ı (sayfası olanlar). */
const artistSlugByNorm = new Map<string, string>();
for (const a of artists) {
	if (a.slug && hasArtist(a.slug) && !artistSlugByNorm.has(normArtist(a.name))) {
		artistSlugByNorm.set(normArtist(a.name), a.slug);
	}
}

/** `sanatçı slug'ı | normalize şarkı adı` -> şarkı sayfası slug'ı. */
const trackSlugByKey = new Map<string, string>();
for (const t of tracks) {
	if (t.slug && t.artistSlug && hasTrack(t.slug)) {
		trackSlugByKey.set(`${t.artistSlug}|${normTrack(t.name)}`, t.slug);
	}
}

/** Sanatçı sayfası varsa href, yoksa null (düz metin kalsın). */
export function artistHref(name: string): string | null {
	const slug = artistSlugByNorm.get(normArtist(name));
	return slug ? `/muzik/sanatci/${slug}` : null;
}

/** Çok sanatçılı şarkıda ilk eşleşen sanatçının slug'ı (yoksa null). */
function matchedArtistSlug(names: { name: string }[]): string | null {
	for (const a of names) {
		const slug = artistSlugByNorm.get(normArtist(a.name));
		if (slug) return slug;
	}
	return null;
}

/** Şarkının sayfası varsa href (sanatçı + normalize ad eşleşmesiyle). */
export function trackHref(track: { name: string; artists: { name: string }[] }): string | null {
	const aslug = matchedArtistSlug(track.artists);
	if (!aslug) return null;
	const slug = trackSlugByKey.get(`${aslug}|${normTrack(track.name)}`);
	return slug ? `/muzik/sarki/${slug}` : null;
}

/* --------------------------------------------------- sanatçı -> playlistler */

export interface ArtistPlaylistRow {
	id: string;
	name: string;
	/** Bu playlistte o sanatçının benzersiz şarkı sayısı. */
	count: number;
	/** Şarkı adları (en fazla 5). */
	trackNames: string[];
	/** Gösterilmeyen ek şarkı sayısı. */
	extra: number;
}

export interface ArtistPlaylistsResult {
	/** Tüm playlistlerde geçen benzersiz şarkı sayısı. */
	songs: number;
	/** En az bir şarkısı olan playlist sayısı. */
	playlists: number;
	rows: ArtistPlaylistRow[];
}

/** Bir sanatçının public playlistlerdeki varlığı. */
export function artistPlaylists(artistSlug: string): ArtistPlaylistsResult {
	const rows: ArtistPlaylistRow[] = [];
	const allSongs = new Set<string>();
	for (const pl of listedPlaylists()) {
		const names = new Set<string>(); // aynı şarkı farklı albümde tek
		for (const t of pl.tracks) {
			for (const a of t.artists) {
				if (artistSlugByNorm.get(normArtist(a.name)) === artistSlug) {
					names.add(normTrack(t.name));
					break; // aynı şarkının aynı sanatçıyı tekrar sayması engellenir
				}
			}
		}
		if (!names.size) continue;
		names.forEach((n) => allSongs.add(n));
		// Playlist sırası korunur; benzersiz adlar sırayla alınır.
		const ordered: string[] = [];
		const seen = new Set<string>();
		for (const t of pl.tracks) {
			const hit = t.artists.some((a) => artistSlugByNorm.get(normArtist(a.name)) === artistSlug);
			const key = normTrack(t.name);
			if (hit && !seen.has(key)) {
				seen.add(key);
				ordered.push(t.name);
			}
		}
		rows.push({
			id: pl.id,
			name: pl.name,
			count: names.size,
			trackNames: ordered.slice(0, 5),
			extra: Math.max(0, names.size - 5),
		});
	}
	// Çoktan aza, eşitlikte ada göre.
	rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'));
	return { songs: allSongs.size, playlists: rows.length, rows };
}
