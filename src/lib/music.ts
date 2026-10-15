/**
 * Müzik bölümü verisi: Spotify dinleme arşivinden üretilen özetler.
 * JSON dosyaları scripts/build-music.mjs, kapaklar scripts/fetch-music-covers.mjs
 * tarafından yazılır. Ham arşiv repoda tutulmaz.
 */
import statsJson from '../data/music/stats.json';
import artistsJson from '../data/music/artists.json';
import albumsJson from '../data/music/albums.json';
import tracksJson from '../data/music/tracks.json';
import coversJson from '../data/music/covers.json';
import lastfmJson from '../data/music/lastfm.json';

export interface MiniTrack {
	name: string;
	album: string;
	plays: number;
	ms: number;
	slug: string | null;
}
export interface MiniAlbum {
	name: string;
	plays: number;
	ms: number;
	slug: string | null;
}

export interface Artist {
	slug: string;
	name: string;
	plays: number;
	ms: number;
	first: string | null;
	last: string | null;
	trackCount: number;
	albumCount: number;
	byYear: number[];
	topTracks: MiniTrack[];
	topAlbums: MiniAlbum[];
}

export interface Album {
	slug: string;
	name: string;
	artist: string;
	artistSlug: string | null;
	plays: number;
	ms: number;
	first: string | null;
	last: string | null;
	trackCount: number;
	byYear: number[];
	tracks: { name: string; plays: number; ms: number; slug: string | null }[];
}

export interface Track {
	slug: string;
	name: string;
	artist: string;
	artistSlug: string | null;
	album: string;
	uri: string;
	plays: number;
	ms: number;
	first: string | null;
	last: string | null;
	byYear: number[];
}

export interface Milestones {
	firstPlay: { name: string; artist: string; ts: string } | null;
	busiestDay: { d: string | null; plays: number };
	longestStreak: { days: number; start: string | null; end: string | null };
	busiestHour: { hour: number; plays: number };
	topDow: { dow: number; plays: number };
	mostPlayedArtist: { name: string; slug: string; plays: number } | null;
	mostPlayedAlbum: { name: string; artist: string; slug: string; plays: number } | null;
	mostPlayedTrack: { name: string; artist: string; slug: string; plays: number } | null;
}

export interface YearStat {
	year: number;
	plays: number;
	ms: number;
	newArtists: number;
}

export interface Stats {
	generatedAt: string;
	range: { first: string | null; last: string | null };
	totals: {
		rawRows: number;
		musicRows: number;
		podcastRows: number;
		scrobbles: number;
		ms: number;
		hours: number;
		artists: number;
		albums: number;
		tracks: number;
		days: number;
		skipRate: number;
	};
	years: YearStat[];
	months: { ym: string; plays: number; ms: number }[];
	days: { d: string; plays: number; ms: number }[];
	weekdayHour: number[][];
	milestones: Milestones;
	topArtists: { slug: string; name: string; plays: number; ms: number }[];
	topAlbums: { slug: string; name: string; artist: string; plays: number; ms: number }[];
	topTracks: { slug: string; name: string; artist: string; album: string; plays: number; ms: number }[];
}

export const stats = statsJson as unknown as Stats;
export const artists = artistsJson as unknown as Artist[];
export const albums = albumsJson as unknown as Album[];
export const tracks = tracksJson as unknown as Track[];

export interface LastfmEntry {
	artist: string;
	name: string;
	album: string;
	/** Unix saniye; null = şu an çalıyor. */
	date: number | null;
	image: string | null;
}
export interface LastfmData {
	fetchedAt?: string;
	tracks?: LastfmEntry[];
}
/** scripts/fetch-lastfm.mjs yazar; anahtarsızsa dosya boş kalır. */
export const lastfm = lastfmJson as LastfmData;

const covers = coversJson as Record<string, string>;

/**
 * Veri dosyaları 666 kayıtla sınırlı olduğundan, başka listelerde geçen bir
 * slug her zaman sayfa üretmez. Bağlantı vermeden önce doğrula.
 */
const trackSlugSet = new Set(tracks.map((t) => t.slug));
const albumSlugSet = new Set(albums.map((a) => a.slug));
const artistSlugSet = new Set(artists.map((a) => a.slug));

export function hasTrack(slug: string | null | undefined): boolean {
	return !!slug && trackSlugSet.has(slug);
}
export function hasAlbum(slug: string | null | undefined): boolean {
	return !!slug && albumSlugSet.has(slug);
}
export function hasArtist(slug: string | null | undefined): boolean {
	return !!slug && artistSlugSet.has(slug);
}

/** Önbellekteki kapak URL'i (yoksa undefined → harf madalyonu). */
export function cover(kind: 'artist' | 'album' | 'track', slug: string): string | undefined {
	return covers[`${kind}:${slug}`];
}

export const MONTHS_TR = [
	'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
	'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
/** Pazartesi'den başlar (JS getUTCDay: 0=Pazar). */
export const WEEKDAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** 1.234 biçiminde tam sayı. */
export function integer(n: number): string {
	return Math.round(n).toLocaleString('tr-TR');
}

/** Saat cinsinden okunur metin (7.705 / 12,4). */
export function hoursText(ms: number): string {
	const h = ms / 3_600_000;
	if (h >= 100) return Math.round(h).toLocaleString('tr-TR');
	return h.toFixed(1).replace('.', ',');
}

/** "2 sa 14 dk" / "18 dk". */
export function durationText(ms: number): string {
	const totalMin = Math.round(ms / 60_000);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h <= 0) return `${m} dk`;
	return `${h} sa ${m} dk`;
}

export function spotifyTrackUrl(uri: string): string {
	const id = uri.split(':').pop();
	return `https://open.spotify.com/track/${id}`;
}
export function spotifySearchUrl(q: string): string {
	return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
}

/** ISO damgasını Türkiye saatinde "12 Mart 2024" biçiminde yazar. */
export function musicDate(iso: string | null): string {
	if (!iso) return '';
	const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
	return `${d.getUTCDate()} ${MONTHS_TR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** YYYY-AA-GG → "12 Mart 2024". */
export function dayLabel(ymd: string | null): string {
	if (!ymd) return '';
	const [y, m, d] = ymd.split('-').map(Number);
	return `${d} ${MONTHS_TR[m - 1]} ${y}`;
}

/** Bir varlığın yıllık sütun grafiği için en yüksek değer. */
export function maxOf(arr: number[]): number {
	return arr.reduce((m, v) => (v > m ? v : m), 0);
}

const FOLD: Record<string, string> = {
	ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u',
};
/** Türkçe karakterleri sadeleştirip küçük harfe çevirir (arama için). */
export function foldTr(s: string): string {
	return (s || '').toLowerCase().replace(/[çğıöşüâîû]/g, (c) => FOLD[c] ?? c);
}
