/**
 * Tüm içerik verisi tek noktadan: film / dizi / kitap.
 * JSON dosyaları scripts/fetch-sheets.mjs tarafından üretilir (npm run fetch).
 */
import filmsJson from '../data/film.json';
import seriesJson from '../data/dizi.json';
import booksJson from '../data/kitap.json';
import { parseTrDate, parseLooseTrDate, formatLooseTrDate, formatYearRange } from './format';
import { fold, splitMulti, tagSlug } from './text';
import {
	buildPeople,
	personHrefFrom,
	ROLES,
	ROLE_LABEL,
	ROLE_ORDER,
	type PeopleIndex,
	type Person,
	type PersonWork,
	type RoleId,
} from './people';

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
	category: string;
	genre: string;
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

/* --------------------------------------------------------------------------
   Kişi indeksi.
   Film/dizi/kitap künyelerindeki tüm roller (yönetmen, senarist, oyuncu,
   yazar, çevirmen…) kişi bazında toplanır. En az MIN_PERSON_WORKS yapımı olan
   kişiler `/kisi/<slug>` sayfası alır; altındakiler aramaya bağlanır.
   -------------------------------------------------------------------------- */
export const peopleIndex: PeopleIndex = buildPeople(allEntries);

/** Bir ismi kişi sayfasına (eşik altıysa aramaya) bağlar. */
export function personHref(name: string, role?: RoleId): string {
	return personHrefFrom(peopleIndex, name, role);
}

export { ROLES, ROLE_LABEL, ROLE_ORDER };
export type { PeopleIndex, Person, PersonWork, RoleId };

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

/** Son yorum yapılanlar (tüm türler). */

/** Kart alt satırı: film→yıl, dizi→yıl aralığı/yıl, kitap→yazar. */
export function cardText(e: Entry): string {
	if (e.type === 'film') return formatYearRange(e.year);
	if (e.type === 'dizi') return formatYearRange(e.yearRange, e.year);
	return e.type === 'kitap' ? e.author : '';
}

/* --------------------------------------------------------------------------
   Kalabalık kişi listeleri.
   Kitap detay sayfası ile film detay sayfası tüm adları gösterir; liste/kart
   gibi diğer gösterimlerde 3 ve üzeri kişi tek bir özet etikete indirilir.
   -------------------------------------------------------------------------- */
export const MANY_AUTHORS_LABEL = 'çok yazarlı';
export const MANY_DIRECTORS_LABEL = 'çok yönetmenli';

/** Kart/liste için yazar satırı: 3+ yazar → "çok yazarlı", aksi hâlde adlar. */
export function authorLine(entry: Entry): string {
	if (entry.type !== 'kitap') return '';
	return splitMulti(entry.author).length > 2 ? MANY_AUTHORS_LABEL : entry.author;
}

/** Kart/liste için yönetmen satırı: 3+ yönetmen → "çok yönetmenli", aksi hâlde adlar. */
export function directorLine(entry: Entry): string {
	if (entry.type !== 'film') return '';
	return splitMulti(entry.director).length > 2 ? MANY_DIRECTORS_LABEL : entry.director;
}


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
		push(entry.category);
		push(entry.genre);
		push(entry.mainTheme);
	}
	return [...out];
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
	const q = (val?: string | number | null) => {
		const v = String(val ?? '').trim();
		return v && v !== '-' ? `/ara?q=${encodeURIComponent(v)}` : undefined;
	};
	const tax = (ns: string, val?: string | number | null) => {
		const v = String(val ?? '').trim();
		if (!v || v === '-') return undefined;
		return `/${ns}/${tagSlug(v)}`;
	};
	const add = (
		label: string,
		value?: string | number | null,
		ns?: string,
		opts?: { plain?: boolean },
	) => {
		const v = value === 0 ? '0' : String(value ?? '').trim();
		if (!v || v === '-') return;
		// Ayraçlı değerleri ("," ve/veya "//") tek tek tıklanabilir hâle getir.
		const parts = splitMulti(v);
		if (parts.length > 1) {
			f.push({
				label,
				values: parts.map((p) => ({
					value: p,
					href: ns ? (tax(ns, p) as string) : (q(p) as string),
				})),
			});
			return;
		}
		if (opts?.plain) {
			f.push({ label, value: v });
			return;
		}
		f.push({ label, value: v, href: ns ? tax(ns, v) : q(v) });
	};
	/** Kişi alanları: her ad kişi sayfasına (eşik altıysa aramaya) bağlanır. */
	const addPeople = (label: string, value: string | undefined | null, role: RoleId) => {
		const v = String(value ?? '').trim();
		if (!v || v === '-') return;
		const parts = splitMulti(v);
		if (!parts.length) return;
		f.push({ label, values: parts.map((p) => ({ value: p, href: personHref(p, role) })) });
	};

	if (entry.type === 'film') {
		addPeople('Yönetmen', entry.director, 'yonetmen');
		addPeople('Senaryo', entry.screenplay, 'senaryo');
		addPeople('Hikâye', entry.story, 'hikaye');
		add('Tür', entry.genre, 'tur');
		add('Ana Tema', entry.mainTheme, 'ana-tema');
		add('Dil', entry.language, 'orijinal-dil');
		add('Ülke', entry.country, 'ulke');
		add('Yapım Yılı', entry.year, undefined, { plain: true });
		add('İzleme Tarihi', entry.watchDate, undefined, { plain: true });
		add('İlk İzlediğim Şehir', entry.firstCity, 'sehir');
		add('Platform', entry.platform, 'erisim-seklim');
		add('Kaç Kez İzledim', entry.rewatchCount, undefined, { plain: true });
		add('Kaynak Eser', entry.sourceWork);
		addPeople('Kaynak Yazar', entry.sourceAuthor, 'kaynak-yazar');
		add('Nasıl Keşfettim', entry.discovery, undefined, { plain: true });
		add('İzleme Sebebim', entry.reason, undefined, { plain: true });
	} else if (entry.type === 'dizi') {
		addPeople('Creator', entry.creator, 'yaratici');
		add('Tür', entry.genre, 'tur');
		add('Ana Etiket', entry.mainLabel, 'ana-tema');
		add('Dil', entry.language, 'orijinal-dil');
		add('Ülke', entry.country, 'ulke');
		add('Yıllar', entry.yearRange, undefined, { plain: true });
		add('Durumu', entry.status);
		add('Format', entry.format, 'format');
		add('İzlenen', entry.watched, undefined, { plain: true });
		add('Network', entry.network);
		add('Medium', entry.medium);
		add('Favori Sezon', entry.favoriteSeason, undefined, { plain: true });
		add('İlk İzlediğim Şehir', entry.firstCity, 'sehir');
		add('Platform', entry.platform, 'erisim-seklim');
		add('Bitirdim mi', entry.finished, undefined, { plain: true });
		add('Kaç Kez Bitirdim', entry.finishCount, undefined, { plain: true });
		add('Kaynak Eser', entry.sourceWork);
		addPeople('Kaynak Yazar', entry.sourceAuthor, 'kaynak-yazar');
	} else {
		addPeople('Yazar', entry.author, 'yazar');
		addPeople('Çevirmen', entry.translator, 'cevirmen');
		add('Yayınevi', entry.publisher, 'yayinevi');
		add('Kategori', entry.category, 'kategori');
		add('Tür', entry.genre, 'tur');
		add('Ana Tema', entry.mainTheme, 'ana-tema');
		add('Eser Türü', entry.workType, 'eser-turu');
		add('Orijinal Dil', entry.originalLanguage, 'orijinal-dil');
		add('Ülke', entry.country, 'ulke');
		add('Sayfa', entry.pages, undefined, { plain: true });
		add('Orijinal Basım Yılı', entry.originalYear, undefined, { plain: true });
		add('Okuduğum Yıl', formatLooseTrDate(entry.readYear), undefined, { plain: true });
		add('Okuduğum Şehir', entry.city, 'sehir');
		add('Format', entry.format, 'format');
		add('Erişim Şeklim', entry.access, 'erisim-seklim');
		add('Kaç Kez Okudum', entry.readCount, undefined, { plain: true });
		add('Tekrar Okur muyum', entry.wouldReread, undefined, { plain: true });
	}

	if (entry.reviewDate) add('Yorum Tarihi', entry.reviewDate, undefined, { plain: true });

	return f;
}

/** Dış bağlantı listesi. */
const LINK_LABELS: Record<string, string> = {
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
			e.category,
			e.genre,
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
