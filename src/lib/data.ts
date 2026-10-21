/**
 * Tüm içerik verisi tek noktadan: film / dizi / kitap.
 * JSON dosyaları scripts/fetch-sheets.mjs tarafından üretilir (npm run fetch).
 */
import filmsJson from '../data/film.json';
import seriesJson from '../data/dizi.json';
import booksJson from '../data/kitap.json';
import { parseTrDate, parseLooseTrDate, parseYearOnly, formatLooseTrDate, formatYearRange } from './format';
import { fold, splitMulti, tagSlug, foldAccents } from './text';
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
	/** Türetilmiş: watchDate'den çıkarılan sayısal izleme yılı (yoksa null). */
	izlenmeYili: number | null;
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
	/** Türetilmiş: startedYear'den çıkarılan sayısal izleme yılı (yoksa null). */
	izlenmeYili: number | null;
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
	/** Türetilmiş: readYear'den çıkarılan sayısal okuma yılı (yoksa null). */
	okunmaYili: number | null;
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

/* --------------------------------------------------------------------------
   Türetilmiş alanlar: yıl filtreleri için ham metin tarih/yıl değerlerinden
   sayısal yıl çıkarılır (bkz. parseYearOnly). Ham JSON dosyalarına yazılmaz;
   alan yalnızca bu bellek içi zenginleştirmede bulunur. Ayrıştırılamayan
   değer null kalır ve yıl filtresinde "Hepsi" açıkken görünür.
   -------------------------------------------------------------------------- */
export const films = (filmsJson as unknown as Film[]).map((e) => ({
	...e,
	izlenmeYili: parseYearOnly(e.watchDate),
}));
export const series = (seriesJson as unknown as Dizi[]).map((e) => ({
	...e,
	izlenmeYili: parseYearOnly(e.startedYear),
}));
export const books = (booksJson as unknown as Kitap[]).map((e) => ({
	...e,
	okunmaYili: parseYearOnly(e.readYear),
}));

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
   Kaynak eser ↔ kitap eşleştirmesi.
   Film/dizi künyesindeki "Kaynak Eser" + "Kaynak Yazar", arşivdeki kitapların
   başlık/orijinal başlık + yazarıyla normalize edilerek karşılaştırılır.
   Eşleşme bir kez hesaplanır ve iki yönde kullanılır: film/dizi sayfasında
   "Kaynak Eser" kitaba bağlanır, kitap sayfasında "Uyarlamalar" bölümü çıkar.
   -------------------------------------------------------------------------- */

/** Normalize: küçük harf + aksan sadeleştirme + noktalama temizliği. */
function adaptationKey(input: string): string {
	return foldAccents(input || '')
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

interface AdaptationBook {
	slug: string;
	/** Normalize başlık ve orijinal başlık. */
	keys: string[];
	author: string;
}

const adaptationBooks: AdaptationBook[] = books.map((b) => ({
	slug: b.slug,
	keys: [...new Set([adaptationKey(b.title), adaptationKey(b.originalTitle)].filter(Boolean))],
	author: adaptationKey(b.authorName || b.author),
}));

/**
 * Kaynak eseri kitaba çevirir. Başlık tam eşleşmeli (kısmi eşleşme "It" gibi
 * kısa adları yanlış kitaba bağlardı). İki tarafta da yazar varsa uyum aranır;
 * yoksa yalnız başlık yeter. Birden çok eşleşmede arşiv sırasındaki ilk kitap.
 */
function matchAdaptation(sourceWork: string, sourceAuthor: string): AdaptationBook | null {
	const work = adaptationKey(sourceWork);
	if (!work) return null;
	const author = adaptationKey(sourceAuthor);
	const found = adaptationBooks.filter((b) => b.keys.includes(work));
	if (!found.length) return null;
	if (author) {
		const withAuthor = found.find(
			(b) => !b.author || b.author.includes(author) || author.includes(b.author),
		);
		if (withAuthor) return withAuthor;
	}
	return found[0];
}

/** Film/dizi id → kaynak kitabın slug'ı. */
const sourceBookByEntry = new Map<string, string>();
/** Kitap slug'ı → o kitabı kaynak alan film/diziler. */
const adaptationsByBook = new Map<string, Entry[]>();

{
	const unmatched: string[] = [];
	for (const e of [...films, ...series]) {
		const work = (e.sourceWork || '').trim();
		if (!work || work === '-') continue;
		const book = matchAdaptation(work, e.sourceAuthor || '');
		if (!book) {
			unmatched.push(`[${e.type}] ${e.title} — "${work}"`);
			continue;
		}
		sourceBookByEntry.set(e.id, book.slug);
		const list = adaptationsByBook.get(book.slug);
		if (list) list.push(e);
		else adaptationsByBook.set(book.slug, [e]);
	}
	// Eşleşmeyenler build sırasında bir kez listelenir (veri düzeltmesi için).
	if (unmatched.length) {
		console.log(
			`[adaptations] ${unmatched.length} kaynak eser kitaba bağlanamadı:\n` +
				unmatched.map((u) => `  ${u}`).join('\n'),
		);
	}
}

/** Bir kitabı kaynak alan film/diziler (yoksa boş dizi). */
export function adaptationsOf(bookSlug: string): Entry[] {
	return adaptationsByBook.get(bookSlug) ?? [];
}

/** Film/dizinin kaynak kitabının slug'ı (eşleşme yoksa undefined). */
export function sourceBookSlug(entry: Entry): string | undefined {
	return sourceBookByEntry.get(entry.id);
}

/* --------------------------------------------------------------------------
   Kitap serileri.
   Sheet'te tek alan var: `series` = "Seri Adı #Sıra" (ör. "Dune #2").
   Ayrı bir seri-sırası alanı yok; sıra bu alandan ayrıştırılır.
   Ayrıştırılamayan değer seri sayılmaz (yanlış sıralama üretmemek için).
   -------------------------------------------------------------------------- */

/** "Dune #2" → { name: "Dune", order: 2 }. Format tutmuyorsa null. */
function parseSeries(value: string): { name: string; order: number } | null {
	const v = String(value ?? '').trim();
	if (!v || v === '-') return null;
	const m = v.match(/^(.*?)\s*#\s*(\d+(?:\.\d+)?)\s*$/);
	if (!m) return null;
	const name = m[1].trim();
	if (!name) return null;
	return { name, order: Number(m[2]) };
}

interface BookSeriesInfo {
	name: string;
	slug: string;
	order: number;
}

const seriesByBookId = new Map<string, BookSeriesInfo>();
const seriesMembers = new Map<string, Kitap[]>();

for (const b of books) {
	const parsed = parseSeries(b.series);
	if (!parsed) continue;
	const slug = tagSlug(parsed.name);
	seriesByBookId.set(b.id, { ...parsed, slug });
	const list = seriesMembers.get(slug);
	if (list) list.push(b);
	else seriesMembers.set(slug, [b]);
}

/**
 * Seri üyeleri okuma/yayın sırasına göre (küçük sıra önce).
 * Aynı sırayı paylaşanlar başlığa göre sıralanır ki liste deterministik olsun.
 */
function sortSeries(list: Kitap[]): Kitap[] {
	return [...list].sort((a, b) => {
		const oa = seriesByBookId.get(a.id)?.order ?? Number.MAX_SAFE_INTEGER;
		const ob = seriesByBookId.get(b.id)?.order ?? Number.MAX_SAFE_INTEGER;
		if (oa !== ob) return oa - ob;
		return a.title.localeCompare(b.title, 'tr');
	});
}

for (const [slug, list] of seriesMembers) seriesMembers.set(slug, sortSeries(list));

/** Kitabın seri bilgisi (seride değilse undefined). */
export function bookSeries(entry: Entry): BookSeriesInfo | undefined {
	return seriesByBookId.get(entry.id);
}

/** Serideki kitaplar, okuma/yayın sırasıyla (yoksa boş dizi). */
export function seriesBooks(slug: string): Kitap[] {
	return seriesMembers.get(slug) ?? [];
}

/** Sayfası olan tüm seriler: slug → görünen ad. */
export const seriesCatalog: Map<string, string> = new Map(
	[...seriesMembers.entries()].map(([slug, list]) => [slug, parseSeries(list[0].series)?.name ?? slug]),
);

/**
 * Kitabın serideki önceki/sonraki kitabı.
 * Sıralı liste üzerinden yürünür; komşunun sırası farklıysa (aynı kitabın
 * Kısım I/II gibi bölünmüş ciltleri aynı numarayı paylaşır) atlanır, aynı
 * sıradaysa liste konumu izlenir — böylece Kısım I → Kısım II bağlanır.
 */
export function seriesNeighbours(entry: Entry): { prev?: Kitap; next?: Kitap; index: number; total: number } {
	const info = seriesByBookId.get(entry.id);
	if (!info) return { index: -1, total: 0 };
	const list = seriesMembers.get(info.slug) ?? [];
	const i = list.findIndex((b) => b.id === entry.id);
	if (i < 0) return { index: -1, total: list.length };

	const orderOf = (b?: Kitap) => (b ? seriesByBookId.get(b.id)?.order ?? NaN : NaN);
	/** Verilen yönde, sırası aynı olan ilk komşuya kadar ilerler. */
	const step = (dir: 1 | -1): Kitap | undefined => {
		for (let j = i + dir; j >= 0 && j < list.length; j += dir) {
			const o = orderOf(list[j]);
			if (o === info.order) return list[j];
			if (dir === 1 ? o > info.order : o < info.order) return list[j];
		}
		return undefined;
	};

	return { prev: step(-1), next: step(1), index: i, total: list.length };
}

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

/**
 * Yalnızca sheet'teki "Etiketler" sütununu döner; tür/ana tema/kategori gibi
 * alanlardan etiket türetmez. Sayfada "Etiketler" bölümü bunu kullanır:
 * sheet'te ne yazıyorsa o gösterilir, boşsa hiçbir şey gösterilmez.
 */
export function sheetTags(entry: Entry): string[] {
	const out = new Set<string>();
	(entry.tags || '').split(',').forEach((s) => {
		const t = s.trim();
		if (t && t !== '-') out.add(t);
	});
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
		opts?: { plain?: boolean; href?: string | null },
	) => {
		const v = value === 0 ? '0' : String(value ?? '').trim();
		if (!v || v === '-') return;
		/* `href` verilmişse kararı o verir: eşleşen bir sayfa varsa ona bağlan,
		   yoksa (null) düz metin göster — aramaya düşme. */
		if (opts && 'href' in opts) {
			f.push(opts.href ? { label, value: v, href: opts.href } : { label, value: v });
			return;
		}
		if (opts?.plain) {
			f.push({ label, value: v });
			return;
		}
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
		add('Kaynak Eser', entry.sourceWork, undefined, {
			href: sourceBookSlug(entry) ? `/kitap/${sourceBookSlug(entry)}` : null,
		});
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
		add('Kaynak Eser', entry.sourceWork, undefined, {
			href: sourceBookSlug(entry) ? `/kitap/${sourceBookSlug(entry)}` : null,
		});
		addPeople('Kaynak Yazar', entry.sourceAuthor, 'kaynak-yazar');
	} else {
		addPeople('Yazar', entry.author, 'yazar');
		addPeople('Çevirmen', entry.translator, 'cevirmen');
		add('Yayınevi', entry.publisher, 'yayinevi');
		// Seri: "Dune #2" → seri sayfasına bağlı "Dune #2".
		const seri = bookSeries(entry);
		{
			const ad = seri ? `${seri.name} #${seri.order}` : String(entry.series ?? '').trim();
			if (ad && ad !== '-') {
				f.push({
					label: 'Seri',
					value: ad,
					href: seri ? `/seri/${seri.slug}` : undefined,
				});
			}
		}
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
	/** Çoklu alanları ("A, B" / "A // B") küçük harfli kümeye çevirir. */
	const set = (v?: string) =>
		new Set(splitMulti(v).map((s) => s.toLocaleLowerCase('tr')));
	const intersects = (a: Set<string>, b: Set<string>) => {
		for (const x of a) if (b.has(x)) return true;
		return false;
	};

	const mineTheme = set('mainTheme' in entry ? entry.mainTheme : undefined);
	const mineDirector = entry.type === 'film' ? set(entry.director) : new Set<string>();
	const mineAuthor =
		entry.type === 'kitap' ? set(entry.authorName || entry.author) : new Set<string>();
	const mySeries = entry.type === 'kitap' ? seriesByBookId.get(entry.id)?.slug : undefined;

	/** İki kümenin kesişim sayısı (katman içi sıralama için). */
	const shared = (a: Set<string>, b: Set<string>) => {
		let n = 0;
		for (const x of a) if (b.has(x)) n++;
		return n;
	};

	/* Kitap bir seriye aitse havuz daralır: yalnızca o serinin diğer kitapları
	   ve aynı yazarın diğer kitapları. Tema/tür eşleşmesi burada devreye
	   girmez — seri bağlamı varken alakasız "benzer" istenmiyor. */
	if (mySeries) {
		const sameSeries = seriesBooks(mySeries).filter((e) => e.id !== entry.id) as Entry[];
		const sameAuthor = mineAuthor.size
			? (books.filter(
					(e) =>
						e.id !== entry.id &&
						seriesByBookId.get(e.id)?.slug !== mySeries &&
						intersects(mineAuthor, set(e.authorName || e.author)),
				) as Entry[])
			: [];
		// Seri üyeleri (okuma sırası) önce, sonra yazarın diğer kitapları.
		return [...sameSeries, ...sameAuthor].slice(0, limit);
	}

	/* Öncelik katmanları (büyük olan önce gelir). Etiket/tür örtüşmesi en alt
	   katman: yalnızca onunla gelen sonuçlar listenin sonuna düşer. */
	const score = (e: Entry): { tier: number; near: number } => {
		const themeHit = mineTheme.size
			? shared(mineTheme, set('mainTheme' in e ? e.mainTheme : undefined))
			: 0;
		const dirHit = mineDirector.size && e.type === 'film' ? shared(mineDirector, set(e.director)) : 0;
		// Tema ya da yönetmen tutuyorsa üst katman; kaç ortak değer varsa o kadar öne.
		if (themeHit > 0 || dirHit > 0) return { tier: 4, near: themeHit + dirHit * 2 };
		if (mineAuthor.size && e.type === 'kitap' && intersects(mineAuthor, set(e.authorName || e.author)))
			return { tier: 3, near: 0 };
		const overlap = tagList(e).filter((x) => mine.has(x.toLocaleLowerCase('tr'))).length;
		return overlap > 0 ? { tier: 1, near: overlap } : { tier: 0, near: 0 };
	};

	return byKind[entry.type]
		.filter((e) => e.id !== entry.id)
		.map((e) => ({ entry: e, ...score(e) }))
		.filter((x) => x.tier > 0)
		.sort((a, b) => b.tier - a.tier || b.near - a.near || (b.entry.rating ?? 0) - (a.entry.rating ?? 0))
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
