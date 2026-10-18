/**
 * Etiket (taksonomi) tanımları — tek kaynak.
 *
 * Her tanım bir URL ad alanına (namespace) karşılık gelir ve bir kaydın hangi
 * alanından değer ürettiğini söyler. Değerler virgülle ayrılabilir; her parça
 * ayrı bir etiket sayfası oluşturur. Aynı etiket farklı türlerde (kitap / film /
 * dizi) geçiyorsa sayfa hepsini birlikte gösterir (global etiket).
 *
 * URL yapısı sade: `/sehir/istanbul`, `/tur/bilim-kurgu` — `tag/` ön eki yok.
 * Kişiler (yazar, yönetmen, oyuncu…) burada değil; `people.ts` + `/kisi/<slug>`
 * altında rol-agnostik tek sayfada toplanır.
 */
import type { Entry } from './data';
import { splitMulti, tagSlug } from './text';

export interface TaxonomyDef {
	/** URL ad alanı (ilk segment). */
	ns: string;
	/** İnsan-okur etiket adı (başlık üstü). */
	label: string;
	/** Bir kayıttan değeri (virgülle çoklu olabilir) üretir. */
	get: (e: Entry) => string | undefined;
}

export const TAXONOMIES: TaxonomyDef[] = [
	// Kurum (kişi değil): yayınevi kendi sayfasında kalır.
	{ ns: 'yayinevi', label: 'Yayınevi', get: (e) => (e.type === 'kitap' ? e.publisher : '') },

	// Tür / tema
	{ ns: 'kategori', label: 'Kategori', get: (e) => (e.type === 'kitap' ? e.category : '') },
	{ ns: 'tur', label: 'Tür', get: (e) => e.genre },
	{
		ns: 'ana-tema',
		label: 'Ana Tema',
		get: (e) => (e.type === 'dizi' ? e.mainLabel : e.mainTheme),
	},
	{ ns: 'eser-turu', label: 'Eser Türü', get: (e) => (e.type === 'kitap' ? e.workType : '') },

	// Künye
	{
		ns: 'orijinal-dil',
		label: 'Orijinal Dil',
		get: (e) => (e.type === 'kitap' ? e.originalLanguage : e.language),
	},
	{ ns: 'ulke', label: 'Ülke', get: (e) => e.country },
	{ ns: 'sehir', label: 'Şehir', get: (e) => (e.type === 'kitap' ? e.city : e.firstCity) },
	{
		ns: 'format',
		label: 'Format',
		get: (e) => (e.type === 'kitap' ? e.format : e.type === 'dizi' ? e.format : ''),
	},
	{ ns: 'erisim-seklim', label: 'Erişim Şeklim', get: (e) => (e.type === 'kitap' ? e.access : e.platform) },
];

export const TAXONOMY_BY_NS: Map<string, TaxonomyDef> = new Map(
	TAXONOMIES.map((t) => [t.ns, t]),
);

/** Bir etiket değerini URL'ine çevirir: `/sehir/istanbul`. */
export function taxonomyHref(ns: string, value: string): string {
	return `/${ns}/${tagSlug(value)}`;
}

/** Bir kaydın verilen ad alanındaki değerlerini tek tek döner. */
export function taxonomyValues(def: TaxonomyDef, e: Entry): string[] {
	return splitMulti(def.get(e));
}
