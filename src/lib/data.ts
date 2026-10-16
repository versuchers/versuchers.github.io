/**
 * Tüm içerik verisi tek noktadan: film / dizi / kitap.
 * JSON dosyaları scripts/fetch-sheets.mjs tarafından üretilir (npm run fetch).
 */
import filmsJson from '../data/film.json';
import seriesJson from '../data/dizi.json';
import booksJson from '../data/kitap.json';
import { parseTrDate, parseLooseTrDate, formatLooseTrDate } from './format';
import { fold } from './text';

export type Kind = 'film' | 'dizi' | 'kitap';

export interface BaseEntry {
	id: string;
	slug: string;
	type: Kind;
	title: string;
	originalTitle: string;
	year: string;
	rating: number | null;
	review: string;
	reviewDate: string;
	tags: string;
	poster: string;
	links: Record<string, string>;
}

export interface Film extends BaseEntry {
	type: 'film';
	prefix: string;
	fullTitle: string;
	director: string;
	cast: { name: string; role: string }[];
	genre: string;
	mainTheme: string;
	language: string;
	screenplay: string;
	story: string;
	sourceAuthor: string;
	sourceWork: string;
	discovery: string;
	reason: string;
	firstCity: string;
	watchDate: string;
	watchDateISO: string;
	platform: string;
	seriesOrder: string;
	country: string;
	directorCountry: string;
	color: string;
	homeOrder: number | null;
	rewatchCount: number | null;
}

export interface Dizi extends BaseEntry {
	type: 'dizi';
	yearRange: string;
	startedYear: string;
	cast: { name: string; role: string }[];
	genre: string;
	mainLabel: string;
	language: string;
	discovery: string;
	reason: string;
	favoriteSeason: string;
	firstCity: string;
	status: string;
	format: string;
	watched: string;
	network: string;
	medium: string;
	creator: string;
	platform: string;
	finished: string;
	finishCount: number | null;
	country: string;
	sourceAuthor: string;
	sourceWork: string;
}

export interface Kitap extends BaseEntry {
	type: 'kitap';
	author: string;
	authorName: string;
	isbn: string;
	publisher: string;
	translator: string;
	series: string;
	authorRating: number | null;
	mainTheme: string;
	access: string;
	readYear: string;
	reason: string;
	discovery: string;
	protagonist: string;
	workType: string;
	format: string;
	mainGenre: string;
	subGenre: string;
	country: string;
	owned: string;
	city: string;
	readLanguage: string;
	originalLanguage: string;
	pages: number | null;
	wouldReread: string;
	authorBirthYear: string;
	originalYear: string;
	originalYearRaw: string;
	readCount: number | null;
}

export type Entry = Film | Dizi | Kitap;

export const films = filmsJson as unknown as Film[];
export const series = seriesJson as unknown as Dizi[];
export const books = booksJson as unknown as Kitap[];

export const allEntries: Entry[] = [...films, ...series, ...books];

export const byKind: Record<Kind, Entry[]> = {
	film: films,
	dizi: series,
	kitap: books,
};

export const KIND_LABEL: Record<Kind, string> = {
	film: 'Film',
	dizi: 'Dizi',
	kitap: 'Kitap',
};

export const KIND_PLURAL: Record<Kind, string> = {
	film: 'Filmler',
	dizi: 'Diziler',
	kitap: 'Kitaplar',
};

/** Detay sayfası yolu. /film/matrix-1999 */
export function href(entry: Entry): string {
	return `/${entry.type}/${entry.slug}`;
}

/** Liste sayfası yolu. */
export function listHref(kind: Kind): string {
	return `/${kind}`;
}

/** İnceleme/güncelleme tarihini sıralanabilir sayıya çevirir. */
export function reviewTime(entry: Entry): number {
	return parseTrDate(entry.reviewDate)?.getTime() ?? 0;
}

/** İzleme/okuma tarihini sıralanabilir sayıya çevirir.
 *  Sadece yıl verilen alanlarda (dizi başlangıç yılı, okuma yılı) yıl ortası kullanılır;
 *  böylece "31 Aralık" gibi bir varsayım filmleri haksız yere geriye atmaz. */
export function watchedTime(entry: Entry): number {
	const midYear = (y: number) => new Date(y, 6, 1).getTime();
	if (entry.type === 'film') {
		return parseTrDate(entry.watchDate)?.getTime() ?? 0;
	}
	if (entry.type === 'dizi') {
		const y = Number(entry.startedYear);
		return y ? midYear(y) : reviewTime(entry);
	}
	return parseLooseTrDate(entry.readYear)?.getTime() ?? reviewTime(entry);
}

/** İzleme/okuma tarihinin gösterilecek hâli. */
export function watchedLabel(entry: Entry): string {
	if (entry.type === 'film') return entry.watchDate;
	if (entry.type === 'dizi') return entry.startedYear ? String(entry.startedYear) : '';
	return entry.readYear ? formatLooseTrDate(entry.readYear) : '';
}

/** Son yorum yapılanlar (tüm türler). */
export function latestReviewed(limit = 6): Entry[] {
	return [...allEntries].sort((a, b) => reviewTime(b) - reviewTime(a)).slice(0, limit);
}

/** Son izlenenler (film + dizi). */
export function latestWatched(limit = 6): Entry[] {
	return [...films, ...series].sort((a, b) => watchedTime(b) - watchedTime(a)).slice(0, limit);
}

/** Son okunanlar. */
export function latestRead(limit = 6): Kitap[] {
	return [...books].sort((a, b) => watchedTime(b) - watchedTime(a)).slice(0, limit);
}

/** Yüksek puanlılar. */
export function topRated(kind?: Kind, limit = 6): Entry[] {
	const pool = kind ? byKind[kind] : allEntries;
	return [...pool]
		.filter((e) => (e.rating ?? 0) > 0)
		.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
		.slice(0, limit);
}

/** Bir kaydın tüm etiketlerini (tür + etiket + tema) dizi olarak döner. */
export function tagList(entry: Entry): string[] {
	const out = new Set<string>();
	const push = (v?: string) => {
		if (!v) return;
		v.split(',').forEach((s) => {
			const t = s.trim();
			if (t && t !== '-') out.add(t);
		});
	};
	push(entry.tags);
	if (entry.type === 'film') {
		push(entry.genre);
		push(entry.mainTheme);
	} else if (entry.type === 'dizi') {
		push(entry.genre);
		push(entry.mainLabel);
	} else {
		push(entry.mainGenre);
		push(entry.subGenre);
		push(entry.mainTheme);
	}
	return [...out];
}

/** Bir tür için filtre panelinde kullanılacak değerleri toplar. */
export interface Facets {
	genres: string[];
	tags: string[];
	years: string[];
}

export function facets(kind: Kind): Facets {
	const items = byKind[kind];
	const genres = new Set<string>();
	const tags = new Set<string>();
	const years = new Set<string>();

	for (const it of items) {
		if (it.type === 'film') {
			(it.genre || '').split(',').forEach((g) => g.trim() && genres.add(g.trim()));
			(it.tags || '').split(',').forEach((g) => g.trim() && tags.add(g.trim()));
		} else if (it.type === 'dizi') {
			(it.genre || '').split(',').forEach((g) => g.trim() && genres.add(g.trim()));
			(it.tags || '').split(',').forEach((g) => g.trim() && tags.add(g.trim()));
		} else {
			(it.mainGenre || '').split(',').forEach((g) => g.trim() && genres.add(g.trim()));
			(it.subGenre || '').split(',').forEach((g) => g.trim() && tags.add(g.trim().replace(/\/+/g, ' ')));
		}
		if (it.year) years.add(it.year);
	}

	return {
		genres: [...genres].sort((a, b) => a.localeCompare(b, 'tr')),
		tags: [...tags].sort((a, b) => a.localeCompare(b, 'tr')),
		years: [...years].sort((a, b) => Number(b) - Number(a)),
	};
}

/** Detay sayfası için künye satırları (boş olanlar atlanır). */
export interface Fact {
	label: string;
	value?: string;
	href?: string;
	/** Virgülle ayrılmış alanların her biri için ayrı bağlantı. */
	values?: { value: string; href: string }[];
}

export function facts(entry: Entry): Fact[] {
	const f: Fact[] = [];
	// Tıklanabilir alanlar global aramaya gider (/ara?q=...), böylece bir kişi
	// hem kitap yazarı hem kaynak yazarsa her iki kayıt da sonuçta çıkar.
	const q = (val?: string | number | null) => {
		const v = String(val ?? '').trim();
		return v && v !== '-' ? `/ara?q=${encodeURIComponent(v)}` : undefined;
	};
	const add = (label: string, value?: string | number | null, href?: string) => {
		const v = value === 0 ? '0' : String(value ?? '').trim();
		if (!v || v === '-') return;
		// Virgülle ayrılan değerleri tek tek tıklanabilir hâle getir.
		if (href && v.includes(',')) {
			const parts = v
				.split(',')
				.map((s) => s.trim())
				.filter((s) => s && s !== '-');
			if (parts.length > 1) {
				f.push({ label, values: parts.map((p) => ({ value: p, href: q(p) as string })) });
				return;
			}
		}
		f.push({ label, value: v, href });
	};

	if (entry.type === 'film') {
		add('Yönetmen', entry.director, q(entry.director));
		add('Senaryo', entry.screenplay, q(entry.screenplay));
		add('Tür', entry.genre, q(entry.genre));
		add('Ana Tema', entry.mainTheme, q(entry.mainTheme));
		add('Dil', entry.language, q(entry.language));
		add('Ülke', entry.country, q(entry.country));
		add('Yapım Yılı', entry.year);
		add('İzleme Tarihi', entry.watchDate);
		add('İlk İzlediğim Şehir', entry.firstCity);
		add('Platform', entry.platform);
		add('Kaç Kez İzledim', entry.rewatchCount);
		add('Kaynak Eser', entry.sourceWork, q(entry.sourceWork));
		add('Kaynak Yazar', entry.sourceAuthor, q(entry.sourceAuthor));
		add('Nasıl Keşfettim', entry.discovery);
		add('İzleme Sebebim', entry.reason);
	} else if (entry.type === 'dizi') {
		add('Creator', entry.creator, q(entry.creator));
		add('Tür', entry.genre, q(entry.genre));
		add('Ana Etiket', entry.mainLabel, q(entry.mainLabel));
		add('Dil', entry.language, q(entry.language));
		add('Ülke', entry.country, q(entry.country));
		add('Yıllar', entry.yearRange);
		add('Durumu', entry.status, q(entry.status));
		add('Format', entry.format, q(entry.format));
		add('İzlenen', entry.watched);
		add('Network', entry.network, q(entry.network));
		add('Medium', entry.medium, q(entry.medium));
		add('Favori Sezon', entry.favoriteSeason);
		add('İlk İzlediğim Şehir', entry.firstCity, q(entry.firstCity));
		add('Platform', entry.platform, q(entry.platform));
		add('Bitirdim mi', entry.finished);
		add('Kaç Kez Bitirdim', entry.finishCount);
		add('Kaynak Eser', entry.sourceWork, q(entry.sourceWork));
		add('Kaynak Yazar', entry.sourceAuthor, q(entry.sourceAuthor));
	} else {
		add('Yazar', entry.author, q(entry.author));
		add('Çevirmen', entry.translator, q(entry.translator));
		add('Yayınevi', entry.publisher, q(entry.publisher));
		add('Ana Tür', entry.mainGenre, q(entry.mainGenre));
		add('Alt Tür', entry.subGenre, q(entry.subGenre));
		add('Ana Tema', entry.mainTheme, q(entry.mainTheme));
		add('Eser Türü', entry.workType, q(entry.workType));
		add('Orijinal Dil', entry.originalLanguage, q(entry.originalLanguage));
		add('Ülke', entry.country);
		add('Sayfa', entry.pages);
		add('Orijinal Basım Yılı', entry.originalYear);
		add('Okuduğum Yıl', formatLooseTrDate(entry.readYear));
		add('Okuduğum Şehir', entry.city, q(entry.city));
		add('Format', entry.format, q(entry.format));
		add('Erişim Şeklim', entry.access, q(entry.access));
		add('Kaç Kez Okudum', entry.readCount);
		add('Tekrar Okur muyum', entry.wouldReread);
	}

	if (entry.reviewDate) add('Yorum Tarihi', entry.reviewDate);

	return f;
}

/** Dış bağlantı listesi. */
export const LINK_LABELS: Record<string, string> = {
	tmdb: 'TMDB',
	imdb: 'IMDb',
	letterboxd: 'Letterboxd',
	tvmaze: 'TVmaze',
	goodreads: 'Goodreads',
};

export function externalLinks(entry: Entry): { label: string; href: string }[] {
	return Object.entries(entry.links || {})
		.filter(([, url]) => url)
		.map(([key, url]) => ({ label: LINK_LABELS[key] ?? key, href: url }));
}

/** Aynı türden, ortak etiketi olan benzer kayıtlar. */
export function related(entry: Entry, limit = 6): Entry[] {
	const mine = new Set(tagList(entry).map((t) => t.toLocaleLowerCase('tr')));
	return byKind[entry.type]
		.filter((e) => e.id !== entry.id)
		.map((e) => ({
			entry: e,
			score: tagList(e).filter((t) => mine.has(t.toLocaleLowerCase('tr'))).length,
		}))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || (b.entry.rating ?? 0) - (a.entry.rating ?? 0))
		.slice(0, limit)
		.map((x) => x.entry);
}

/** Global arama için bir kaydın tüm aranabilir alanlarını birleştirir. */
/** Arama metnine katılacak en fazla oyuncu sayısı (uzun kadrolarda kuyruğu atlar). */
const CAST_SEARCH_LIMIT = 12;

/**
 * Kadronun ilk `CAST_SEARCH_LIMIT` farklı oyuncusunu döndürür.
 * Aynı oyuncu birden çok rolde görünebileceği için ada göre tekilleştirilir;
 * böylece "ilk 12 oyuncu" gerçekten 12 kişiyi kapsar.
 */
function topCast(cast: { name: string; role: string }[]): { name: string; role: string }[] {
	const seen = new Set<string>();
	const out: { name: string; role: string }[] = [];
	for (const c of cast) {
		const key = (c.name || '').toLowerCase().trim();
		if (key && seen.has(key)) continue;
		if (key) seen.add(key);
		out.push(c);
		if (out.length >= CAST_SEARCH_LIMIT) break;
	}
	return out;
}

export function searchText(e: Entry): string {
	const parts: (string | undefined)[] = [
		e.title,
		e.originalTitle,
		e.year,
		KIND_LABEL[e.type],
		e.review,
		e.tags,
	];
	if (e.type === 'film') {
		parts.push(
			e.fullTitle,
			e.director,
			e.screenplay,
			e.story,
			e.genre,
			e.mainTheme,
			e.language,
			e.country,
			e.directorCountry,
			e.sourceAuthor,
			e.sourceWork,
			e.firstCity,
			e.platform,
			e.discovery,
			e.reason,
			...topCast(e.cast).map((c) => c.name),
			...topCast(e.cast).map((c) => c.role),
		);
	} else if (e.type === 'dizi') {
		parts.push(
			e.creator,
			e.genre,
			e.mainLabel,
			e.language,
			e.country,
			e.network,
			e.medium,
			e.platform,
			e.status,
			e.format,
			e.sourceAuthor,
			e.sourceWork,
			e.favoriteSeason,
			e.firstCity,
			e.discovery,
			...topCast(e.cast).map((c) => c.name),
			...topCast(e.cast).map((c) => c.role),
		);
	} else {
		parts.push(
			e.author,
			e.authorName,
			e.translator,
			e.publisher,
			e.mainGenre,
			e.subGenre,
			e.mainTheme,
			e.workType,
			e.originalLanguage,
			e.readLanguage,
			e.country,
			e.city,
			e.access,
			e.format,
			e.series,
			e.protagonist,
			e.isbn,
			e.discovery,
		);
	}
	return fold(parts.filter(Boolean).join(' '));
}
