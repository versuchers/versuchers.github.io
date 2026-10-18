/**
 * Kişi (künye) indeksi — film/dizi/kitap künyelerinden türetilir.
 *
 * Aynı kişi birden çok rolde geçebilir (ör. Ben Affleck: yönetmen + oyuncu).
 * Kişi rol-agnostik tek bir varlık olarak toplanır; rolleri sayfada çip olarak
 * süzülür. Yalnızca en az `MIN_PERSON_WORKS` farklı yapımı olan kişiler kendi
 * sayfasını alır; altındakiler `/ara?q=` ile aranır (zayıf sayfa üretilmez).
 */
import type { Entry } from './data';
import { splitMulti, tagSlug } from './text';

export type RoleId =
	| 'yonetmen'
	| 'senaryo'
	| 'hikaye'
	| 'oyuncu'
	| 'yaratici'
	| 'kaynak-yazar'
	| 'yazar'
	| 'cevirmen';

export interface RoleDef {
	id: RoleId;
	/** Görünen ad. */
	label: string;
	/** Bir kayıttan bu roldeki kişi adlarını döner. */
	get: (e: Entry) => string[];
}

export const ROLES: RoleDef[] = [
	{ id: 'yonetmen', label: 'Yönetmen', get: (e) => (e.type === 'film' ? splitMulti(e.director) : []) },
	{ id: 'senaryo', label: 'Senarist', get: (e) => (e.type === 'film' ? splitMulti(e.screenplay) : []) },
	{ id: 'hikaye', label: 'Hikâye', get: (e) => (e.type === 'film' ? splitMulti(e.story) : []) },
	{
		id: 'oyuncu',
		label: 'Oyuncu',
		get: (e) => (e.type === 'film' || e.type === 'dizi' ? e.cast.map((c) => c.name) : []),
	},
	{ id: 'yaratici', label: 'Yaratıcı', get: (e) => (e.type === 'dizi' ? splitMulti(e.creator) : []) },
	{
		id: 'kaynak-yazar',
		label: 'Kaynak Yazar',
		get: (e) => (e.type === 'film' || e.type === 'dizi' ? splitMulti(e.sourceAuthor) : []),
	},
	{ id: 'yazar', label: 'Yazar', get: (e) => (e.type === 'kitap' ? splitMulti(e.author) : []) },
	{ id: 'cevirmen', label: 'Çevirmen', get: (e) => (e.type === 'kitap' ? splitMulti(e.translator) : []) },
];

/** Çip sırası (sayfada bu sırayla gösterilir). */
export const ROLE_ORDER: RoleId[] = ROLES.map((r) => r.id);

export const ROLE_LABEL: Record<RoleId, string> = ROLES.reduce(
	(acc, r) => {
		acc[r.id] = r.label;
		return acc;
	},
	{} as Record<RoleId, string>,
);

/** Kişi sayfası açılması için gereken en az farklı yapım sayısı. */
export const MIN_PERSON_WORKS = 3;

export interface PersonWork {
	entry: Entry;
	/** Bu kişinin bu yapımdaki rolleri (ROLE_ORDER sırasıyla). */
	roles: RoleId[];
}

export interface Person {
	slug: string;
	/** Görünen isim (verideki en iyi varyant). */
	name: string;
	works: PersonWork[];
	/** Bu kişide geçen roller (ROLE_ORDER sırasıyla). */
	roleIds: RoleId[];
}

export interface PeopleIndex {
	/** Sayfası olan kişiler (>= MIN_PERSON_WORKS), isme göre sıralı. */
	list: Person[];
	/** Tüm kişiler (slug → kişi). */
	bySlug: Map<string, Person>;
	minWorks: number;
}

const UPPER = /[A-ZÇĞİÖŞÜ]/g;
const LOWER = /\p{Ll}/u;

/** Veri girişlerinde "bulunamadı/bilinmiyor" gibi yer tutucular kişi sayılmaz. */
const PLACEHOLDER_NAME = /bulunamad|bilinmiyor|bilinmeyen/i;

/**
 * Görünen isim için en iyi yazım varyantını seçer.
 * Karışık büyük/küçük harfli olan tercih edilir (ALL CAPS ve tamamen küçük
 * yazımdan kaçınılır); eşitlikte büyük harf sayısı, sonra sıklık belirler.
 * Hiç büyük harf yoksa sözcük başları (ve nokta sonrası) büyütülür.
 */
function pickName(variants: Map<string, number>): string {
	let best = '';
	let bestScore = -Infinity;
	for (const [name, freq] of variants) {
		const uppers = (name.match(UPPER) ?? []).length;
		const mixed = uppers > 0 && LOWER.test(name) ? 1 : 0;
		const score = mixed * 1_000_000 + uppers * 1_000 + freq;
		if (score > bestScore) {
			bestScore = score;
			best = name;
		}
	}
	return (best.match(UPPER) ?? []).length > 0 ? best : smartTitle(best);
}

/** Tamamen küçük harfli isimleri düzgün büyütür: "rob tapert" → "Rob Tapert". */
function smartTitle(s: string): string {
	return s.replace(/(^|[\s.\-'’])([a-zçğıöşü])/g, (_, p: string, c: string) =>
		p + c.toLocaleUpperCase('tr'),
	);
}

export function buildPeople(entries: Entry[]): PeopleIndex {
	interface Draft {
		slug: string;
		variants: Map<string, number>;
		works: Map<string, { entry: Entry; roles: Set<RoleId> }>;
	}

	const drafts = new Map<string, Draft>();

	for (const e of entries) {
		for (const role of ROLES) {
			for (const raw of role.get(e)) {
				const name = raw.trim();
				if (!name || PLACEHOLDER_NAME.test(name)) continue;
				const slug = tagSlug(name);
				if (!slug) continue;
				let d = drafts.get(slug);
				if (!d) {
					d = { slug, variants: new Map(), works: new Map() };
					drafts.set(slug, d);
				}
				d.variants.set(name, (d.variants.get(name) ?? 0) + 1);
				let w = d.works.get(e.id);
				if (!w) {
					w = { entry: e, roles: new Set() };
					d.works.set(e.id, w);
				}
				w.roles.add(role.id);
			}
		}
	}

	const all: Person[] = [];
	for (const d of drafts.values()) {
		const works: PersonWork[] = [...d.works.values()].map((w) => ({
			entry: w.entry,
			roles: ROLE_ORDER.filter((r) => w.roles.has(r)),
		}));
		const roleIds = ROLE_ORDER.filter((r) => works.some((w) => w.roles.includes(r)));
		all.push({ slug: d.slug, name: pickName(d.variants), works, roleIds });
	}

	const bySlug = new Map(all.map((p) => [p.slug, p]));
	const list = all
		.filter((p) => p.works.length >= MIN_PERSON_WORKS)
		.sort((a, b) => a.name.localeCompare(b.name, 'tr'));

	return { list, bySlug, minWorks: MIN_PERSON_WORKS };
}

/**
 * Bir ismi kişi sayfasına (veya eşik altındaysa aramaya) bağlar.
 * `role` verilirse sayfa o rol çipiyle açılır.
 */
export function personHrefFrom(index: PeopleIndex, name: string, role?: RoleId): string {
	const clean = name.trim();
	const slug = tagSlug(clean);
	const person = index.bySlug.get(slug);
	if (person && person.works.length >= index.minWorks) {
		return `/kisi/${slug}${role ? `?rol=${role}` : ''}`;
	}
	return `/ara?q=${encodeURIComponent(clean)}`;
}
