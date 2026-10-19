/**
 * /sayilar/ istatistik sayfaları için build-zamanı hesaplama modülü.
 *
 * Tüm sayılar burada, derleme anında, src/lib/data.ts'in türetilmiş
 * girişlerinden hesaplanır. Ham JSON / Sheets'e dokunulmaz.
 *
 * Kurallar:
 *  1. Birim = kayıt. Dizide sezon değil dizi sayılır. Tekrar (yeniden izleme /
 *     bitirme / okuma) toplamı değiştirmez; ayrı bir rakamdır.
 *  2. Çok değerli alanlarda bir kayıt her değer için 1 kez sayılır; yüzde
 *     kayıt sayısına bölünür ve "bir kayıt birden fazla yerde sayılabilir"
 *     notu eklenir.
 *  3. Eksik değer "Bilinmiyor" kovasında görünür; kayıt sessizce düşürülmez.
 *  4. Kişi bölümleri rol bazlı ayrıdır. Filmde kaynak yazar (sourceAuthor)
 *     hiçbir kişi listesine karışmaz.
 */
import { films, series, books, peopleIndex, type Entry, type Kind } from './data';
import { tagSlug } from './text';
import { TAXONOMY_BY_NS, taxonomyValues } from './taxonomy';
import { ROLES, type RoleId } from './people';

/** Rol bazlı kişi üreticisi (ROLES tek kaynak). */
function roleGet(id: RoleId): (e: Entry) => string[] {
	const r = ROLES.find((x) => x.id === id);
	if (!r) throw new Error(`Bilinmeyen rol: ${id}`);
	return r.get;
}

/* ------------------------------------------------------------------ tipler */

export interface CountItem {
	label: string;
	count: number;
	/** Sayfa yoksa undefined → satır düz metin kalır. */
	href: string | undefined;
}

export interface Box {
	label: string;
	value: string;
	sub?: string;
}

export interface CountsSection {
	kind: 'counts';
	id: string;
	title: string;
	/** Çok değerli alan notu. */
	note?: string;
	items: CountItem[];
	/** Üstte gösterilecek satır sayısı (gerisi "Tümünü gör"). */
	top: number;
	unknown: number;
	total: number;
}

export interface PersonSection {
	kind: 'person';
	id: string;
	title: string;
	items: CountItem[];
	/** Tekrarlı (>= 2) kişilerden ilk 10. */
	ranked: CountItem[];
	unknown: number;
	total: number;
}

export interface DecadesSection {
	kind: 'decades';
	id: string;
	title: string;
	buckets: { label: string; count: number }[];
	topYear: { label: string; count: number } | null;
	unknown: number;
	total: number;
}

export interface YearsSection {
	kind: 'years';
	id: string;
	title: string;
	rows: { label: string; count: number; pct: number }[];
	withDate: number;
	total: number;
}

export interface RatingsSection {
	kind: 'ratings';
	id: string;
	title: string;
	avg: string;
	rated: number;
	buckets: { label: string; count: number; pct: number }[];
	total: number;
}

export interface TextSection {
	kind: 'text';
	id: string;
	title: string;
	lines: { label: string; value: string }[];
}

export interface TableSection {
	kind: 'table';
	id: string;
	title: string;
	note?: string;
	head: string[];
	rows: { label: string; href: string | undefined; cells: string[] }[];
}

export type SayilarSection =
	| CountsSection
	| PersonSection
	| DecadesSection
	| YearsSection
	| RatingsSection
	| TextSection
	| TableSection;

export interface SayilarPage {
	slug: string;
	title: string;
	description: string;
	kinds: Kind[];
	boxes: Box[];
	sections: SayilarSection[];
}

/* ------------------------------------------------------------- yardımcılar */

const KINDS: Record<Kind, { label: string; href: string; entries: Entry[] }> = {
	film: { label: 'Film', href: '/film', entries: films },
	dizi: { label: 'Dizi', href: '/dizi', entries: series },
	kitap: { label: 'Kitap', href: '/kitap', entries: books },
};

/** "3", "3+", 3 → 3; boş/açıklama → null. */
function int(v: string | number | null | undefined): number | null {
	if (v === null || v === undefined) return null;
	const m = String(v).match(/\d+/);
	return m ? Number(m[0]) : null;
}

function fmt(n: number): string {
	return n.toLocaleString('tr-TR');
}

function avgRating(entries: Entry[]): { avg: string; rated: number } {
	const rs = entries
		.map((e) => e.rating)
		.filter((r): r is number => typeof r === 'number' && !Number.isNaN(r));
	if (!rs.length) return { avg: '–', rated: 0 };
	const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
	return { avg: avg.toFixed(1).replace('.', ','), rated: rs.length };
}

/** Tekrar: film = yeniden izleme, dizi = bitirme, kitap = okuma sayısı. */
function rewatchOf(e: Entry): number | null {
	if (e.type === 'film') return int(e.rewatchCount);
	if (e.type === 'dizi') return int(e.finishCount);
	return int(e.readCount);
}

/** Yapım/basım yılı (dört haneli). */
function productionYearOf(e: Entry): string {
	return e.type === 'kitap' ? e.originalYear : e.year;
}

/** İzleme/okuma yılı (türetilmiş sayısal alan). */
function watchedYearOf(e: Entry): number | null {
	return e.type === 'kitap' ? e.okunmaYili : e.izlenmeYili;
}

/* ------------------------------------------------------- bölüm hesaplayıcı */

interface Src {
	ns: string;
	get: (e: Entry) => string[];
}

function nsSrc(ns: string): Src {
	const def = TAXONOMY_BY_NS.get(ns);
	return { ns, get: (e) => (def ? taxonomyValues(def, e) : []) };
}

/** Çok değerli sayı sayımı (bir kayıt bir değerde 1 kez). */
function collectCounts(entries: Entry[], srcs: Src[]): {
	items: CountItem[];
	covered: number;
	unknown: number;
} {
	const counts = new Map<string, { label: string; count: number; ns: string }>();
	let covered = 0;
	for (const e of entries) {
		const seen = new Set<string>();
		const nsFor = new Map<string, string>();
		for (const s of srcs) {
			for (const v of s.get(e)) {
				seen.add(v);
				if (!nsFor.has(v)) nsFor.set(v, s.ns);
			}
		}
		if (seen.size) covered++;
		for (const v of seen) {
			const cur = counts.get(v);
			if (cur) cur.count++;
			else counts.set(v, { label: v, count: 1, ns: nsFor.get(v) ?? 'tur' });
		}
	}
	const items = [...counts.values()]
		.map((c) => ({
			label: c.label,
			count: c.count,
			href: `/${c.ns}/${tagSlug(c.label)}`,
		}))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr'));
	return { items, covered, unknown: entries.length - covered };
}

/** Kişi sayımı (rol bazlı). Sayfası olmayan kişi href'siz kalır. */
function collectPeople(
	entries: Entry[],
	role: RoleId | undefined,
	get: (e: Entry) => string[],
): { items: CountItem[]; covered: number; unknown: number } {
	const counts = new Map<string, number>();
	let covered = 0;
	for (const e of entries) {
		const names = new Set(get(e).map((n) => n.trim()).filter(Boolean));
		if (names.size) covered++;
		for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
	}
	const items = [...counts.entries()]
		.map(([label, count]) => ({ label, count, href: kisiHref(label, role) }))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr'));
	return { items, covered, unknown: entries.length - covered };
}

/** Sayfası varsa (/kisi/<slug>), yoksa undefined. */
function kisiHref(name: string, role?: RoleId): string | undefined {
	const person = peopleIndex.bySlug.get(tagSlug(name));
	if (person && person.works.length >= peopleIndex.minWorks) {
		return `/kisi/${person.slug}${role ? `?rol=${role}` : ''}`;
	}
	return undefined;
}

function countsSection(
	id: string,
	title: string,
	entries: Entry[],
	srcs: Src[],
	top: number,
	multi = false,
): CountsSection {
	const { items, unknown } = collectCounts(entries, srcs);
	return {
		kind: 'counts',
		id,
		title,
		note: multi ? 'Bir kayıt birden fazla yerde sayılabilir.' : undefined,
		items,
		top,
		unknown,
		total: entries.length,
	};
}

function personSection(
	id: string,
	title: string,
	entries: Entry[],
	role: RoleId | undefined,
	get: (e: Entry) => string[],
): PersonSection {
	const { items, unknown } = collectPeople(entries, role, get);
	return {
		kind: 'person',
		id,
		title,
		items,
		// Tekrarlı kişiler sıralamada; tek kayıtlılar yalnızca tam listede.
		ranked: items.filter((i) => i.count >= 2).slice(0, 10),
		unknown,
		total: entries.length,
	};
}

function decadesSection(id: string, title: string, entries: Entry[]): DecadesSection {
	const buckets = new Map<number, number>();
	const years = new Map<number, number>();
	let unknown = 0;
	for (const e of entries) {
		const y = int(productionYearOf(e));
		if (y === null) {
			unknown++;
			continue;
		}
		const d = Math.floor(y / 10) * 10;
		buckets.set(d, (buckets.get(d) ?? 0) + 1);
		years.set(y, (years.get(y) ?? 0) + 1);
	}
	const top = [...years.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
	return {
		kind: 'decades',
		id,
		title,
		buckets: [...buckets.entries()]
			.sort((a, b) => b[0] - a[0])
			.map(([d, count]) => ({ label: `${d}'lar`, count })),
		topYear: top ? { label: String(top[0]), count: top[1] } : null,
		unknown,
		total: entries.length,
	};
}

function yearsSection(id: string, title: string, entries: Entry[]): YearsSection {
	const rows = new Map<number, number>();
	let withDate = 0;
	for (const e of entries) {
		const y = watchedYearOf(e);
		if (y === null) continue;
		withDate++;
		rows.set(y, (rows.get(y) ?? 0) + 1);
	}
	const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0]);
	const max = sorted.reduce((m, [, c]) => Math.max(m, c), 0);
	return {
		kind: 'years',
		id,
		title: `${title} — ${entries.length} kayıttan ${withDate} tanesinde tarih var`,
		rows: sorted.map(([y, count]) => ({
			label: String(y),
			count,
			pct: max ? Math.round((count / max) * 100) : 0,
		})),
		withDate,
		total: entries.length,
	};
}

function ratingsSection(id: string, title: string, entries: Entry[]): RatingsSection {
	const { avg, rated } = avgRating(entries);
	const buckets = new Map<number, number>();
	for (let r = 1; r <= 10; r++) buckets.set(r, 0);
	for (const e of entries) {
		const r = e.rating;
		if (typeof r === 'number' && !Number.isNaN(r)) {
			buckets.set(r, (buckets.get(r) ?? 0) + 1);
		}
	}
	const max = [...buckets.values()].reduce((m, c) => Math.max(m, c), 0);
	return {
		kind: 'ratings',
		id,
		title,
		avg,
		rated,
		buckets: [...buckets.entries()].map(([r, count]) => ({
			label: String(r),
			count,
			pct: max ? Math.round((count / max) * 100) : 0,
		})),
		total: entries.length,
	};
}

function textSection(id: string, title: string, lines: { label: string; value: string }[]): TextSection {
	return { kind: 'text', id, title, lines };
}

/* ------------------------------------------------------------ sayfa kurma */

interface PageDef {
	kinds: Kind[];
	title: string;
	description: (n: Record<Kind, number>) => string;
}

const PAGE_DEFS: Record<string, PageDef> = {
	'': {
		kinds: ['film', 'dizi', 'kitap'],
		title: 'Sayılar',
		description: (n) =>
			`Arşivimin sayıları: ${n.film} film, ${n.dizi} dizi ve ${n.kitap} kitap — türler, ülkeler, yıllar ve puanlar.`,
	},
	izleme: {
		kinds: ['film', 'dizi'],
		title: 'İzleme Sayıları',
		description: (n) =>
			`İzlediklerimin sayıları: ${n.film} film ve ${n.dizi} dizi — türler, ülkeler, izleme yılları ve puanlar.`,
	},
	film: {
		kinds: ['film'],
		title: 'Film Sayıları',
		description: (n) => `İzlediğim ${n.film} film üzerine sayılar: türler, yönetmenler, ülkeler, izleme yılları ve puanlar.`,
	},
	dizi: {
		kinds: ['dizi'],
		title: 'Dizi Sayıları',
		description: (n) => `İzlediğim ${n.dizi} dizi üzerine sayılar: türler, oyuncular, ülkeler, izleme yılları ve puanlar.`,
	},
	kitap: {
		kinds: ['kitap'],
		title: 'Kitap Sayıları',
		description: (n) => `Okuduğum ${n.kitap} kitap üzerine sayılar: türler, yazarlar, ülkeler, okuma yılları ve puanlar.`,
	},
};

export const SAYILAR_LINKS: { label: string; href: string }[] = [
	{ label: 'Toplu', href: '/sayilar/' },
	{ label: 'İzleme', href: '/sayilar/izleme/' },
	{ label: 'Film', href: '/sayilar/film/' },
	{ label: 'Dizi', href: '/sayilar/dizi/' },
	{ label: 'Kitap', href: '/sayilar/kitap/' },
];

export function sayilarPage(slug: string): SayilarPage {
	const def = PAGE_DEFS[slug];
	if (!def) throw new Error(`Bilinmeyen sayilar sayfası: ${slug}`);
	const kinds = def.kinds;
	const byKind = new Map<Kind, Entry[]>(
		kinds.map((k) => [k, KINDS[k].entries as Entry[]]),
	);
	const entries = kinds.flatMap((k) => KINDS[k].entries);
	const counts: Record<string, number> = { film: films.length, dizi: series.length, kitap: books.length };

	/* ---- kutular ---- */
	const { avg, rated } = avgRating(entries);
	const rewatchSums = kinds.map((k) => ({
		label: KINDS[k].label,
		sum: KINDS[k].entries.reduce((s, e) => s + (rewatchOf(e) ?? 0), 0),
	}));
	const boxes: Box[] = [
		{ label: 'Toplam kayıt', value: fmt(entries.length) },
		...kinds
			.filter(() => kinds.length > 1)
			.map((k) => ({ label: KINDS[k].label, value: fmt(counts[k]) })),
		{
			label: 'Ortalama puan',
			value: avg,
			sub: `${fmt(rated)} kayıt puanlı (10 üzerinden)`,
		},
		{
			label: 'Toplam tekrar',
			value: fmt(rewatchSums.reduce((s, r) => s + r.sum, 0)),
			sub: rewatchSums.map((r) => `${r.label} ${fmt(r.sum)}`).join(' · '),
		},
	];

	/* ---- bölümler ---- */
	const sections: SayilarSection[] = [];

	// Türler arası karşılaştırma (toplu sayfalar)
	if (kinds.length > 1) {
		sections.push({
			kind: 'table',
			id: 'karsilastirma',
			title: 'Türler arası karşılaştırma',
			head: ['Tür', 'Kayıt', 'Ortalama puan', 'Toplam tekrar'],
			rows: kinds.map((k) => {
				const kEntries = KINDS[k].entries;
				const kAvg = avgRating(kEntries);
				const kRewatch = kEntries.reduce((s, e) => s + (rewatchOf(e) ?? 0), 0);
				return {
					label: KINDS[k].label,
					href: `/sayilar/${k}/`,
					cells: [fmt(kEntries.length), `${kAvg.avg} (${fmt(kAvg.rated)} puanlı)`, fmt(kRewatch)],
				};
			}),
		});
	}

	// Tür: her türde genre + (kitapta ayrıca) kategori
	const turSrcs: Src[] = [nsSrc('tur')];
	if (kinds.includes('kitap')) {
		turSrcs.push(nsSrc('kategori'));
	}
	sections.push(countsSection('tur', 'Tür', entries, turSrcs, 10, true));

	// Ana tema (dizide mainLabel)
	sections.push(countsSection('ana-tema', 'Ana tema', entries, [nsSrc('ana-tema')], 15, true));

	// Kişi bölümleri (yalnızca türe özel sayfalarda; toplu sayfalarda yok)
	if (kinds.length === 1 && kinds[0] === 'film') {
		const f = byKind.get('film')!;
		sections.push(personSection('yonetmen', 'Yönetmen', f, 'yonetmen', roleGet('yonetmen')));
		sections.push(personSection('senarist', 'Senarist', f, 'senaryo', roleGet('senaryo')));
		sections.push(personSection('oyuncu-film', 'Oyuncu', f, 'oyuncu', roleGet('oyuncu')));
	}
	if (kinds.length === 1 && kinds[0] === 'dizi') {
		const d = byKind.get('dizi')!;
		// Dizide "yönetmen" alanı yok; yalnızca "oyuncu" (cast) var.
		sections.push(personSection('oyuncu-dizi', 'Oyuncu', d, 'oyuncu', roleGet('oyuncu')));
	}
	if (kinds.length === 1 && kinds[0] === 'kitap') {
		const k = byKind.get('kitap')!;
		sections.push(personSection('yazar', 'Yazar', k, 'yazar', roleGet('yazar')));
		sections.push(personSection('cevirmen', 'Çevirmen', k, 'cevirmen', roleGet('cevirmen')));
		// Yayınevi kişi değil; rol parametresi yok.
		const yay = collectCounts(k, [nsSrc('yayinevi')]);
		sections.push({
			kind: 'person',
			id: 'yayinevi',
			title: 'Yayınevi',
			items: yay.items,
			ranked: yay.items.filter((i) => i.count >= 2).slice(0, 10),
			unknown: yay.unknown,
			total: k.length,
		});
	}

	// Ülke + orijinal dil
	sections.push(countsSection('ulke', 'Ülke', entries, [nsSrc('ulke')], 10, true));
	sections.push(countsSection('dil', 'Orijinal dil', entries, [nsSrc('orijinal-dil')], 10));

	// Erişim şekli (tam dağılım)
	sections.push(countsSection('erisim', 'Erişim şekli', entries, [nsSrc('erisim-seklim')], 999));

	// Format (yalnızca kitap sayfasında; toplu sayfalarda türe özel alan yok)
	if (kinds.length === 1 && kinds[0] === 'kitap') {
		sections.push(countsSection('format', 'Format', byKind.get('kitap')!, [nsSrc('format')], 999, true));
	}

	// Yapım/basım yılı on yıl dağılımı
	sections.push(
		decadesSection('yapim-yili', kinds.length > 1 ? 'Yapım/basım yılı' : kinds[0] === 'kitap' ? 'Basım yılı' : 'Yapım yılı', entries),
	);

	// İzleme/okuma yılı (yalnızca tarihli kayıtlar)
	sections.push(
		yearsSection('izleme-yili', kinds.length > 1 ? 'İzleme/okuma yılı' : kinds[0] === 'kitap' ? 'Okunduğu yıl' : 'İzlendiği yıl', entries),
	);

	// Puan dağılımı
	sections.push(ratingsSection('puan', 'Puan dağılımı (10 üzerinden)', entries));

	// Kitap ekleri (yalnızca kitap sayfasında)
	if (kinds.length === 1 && kinds[0] === 'kitap') {
		const k = byKind.get('kitap')!;
		const wt = collectCounts(k, [nsSrc('eser-turu')]);
		const wtTotal = k.length;
		const wtPct = (n: number) => (wtTotal ? `(%${((n / wtTotal) * 100).toFixed(1).replace('.', ',')})` : '');
		const withPages = k
			.map((e) => (e.type === 'kitap' ? int(e.pages) : null))
			.filter((p): p is number => p !== null);
		const pageSum = withPages.reduce((a, b) => a + b, 0);
		sections.push(
			textSection('kitap-ek', 'Kitap ekleri', [
				...wt.items.map((i) => ({ label: i.label, value: `${fmt(i.count)} kayıt ${wtPct(i.count)}` })),
				{ label: 'Bilinmiyor', value: `${fmt(wt.unknown)} kayıt` },
				{ label: 'Toplam sayfa', value: fmt(pageSum) },
				{
					label: 'Ortalama sayfa',
					value: `${(pageSum / (withPages.length || 1)).toFixed(1).replace('.', ',')} — ${k.length} kayıttan ${withPages.length}'inde sayfa bilgisi var`,
				},
			]),
		);
	}

	const kindCounts: Record<Kind, number> = { film: films.length, dizi: series.length, kitap: books.length };
	return {
		slug,
		title: def.title,
		description: def.description(kindCounts),
		kinds,
		boxes,
		sections,
	};
}

export const SAYILAR_SLUGS = Object.keys(PAGE_DEFS);
