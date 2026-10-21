/**
 * Slug üretimi — tek kaynak.
 *
 * Site (src/lib/*.ts) ve sync script'leri (scripts/*.mjs) bu dosyayı paylaşır;
 * aksi hâlde iki taraf farklı slug üretip iç linkler kırılır.
 *
 * Sıra önemli:
 *   1. Türkçe harfleri haritala (ğ→g, ü→u, ş→s, ı→i, ö→o, ç→c, İ→i)
 *   2. NFKD normalize et, birleştirici işaretleri sil (é→e, å→a, ø→o, ñ→n…)
 *   3. Alfanümerik olmayanları tireye çevir
 *   4. Art arda tireleri teke indir, uçlardaki tireleri kırp
 */

/** Türkçe (ve komşu) harf eşlemesi — NFKD bunları çözmez, elle haritalanır. */
const TR_MAP = {
	ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
	â: 'a', î: 'i', û: 'u',
	Ç: 'c', Ğ: 'g', İ: 'i', I: 'i', Ö: 'o', Ş: 's', Ü: 'u',
	Â: 'a', Î: 'i', Û: 'u',
};

/**
 * Metni URL-güvenli slug'a çevirir.
 * @param {string} input
 * @param {number} [maxLength] en fazla uzunluk (varsayılan 80)
 * @returns {string}
 */
export function slugify(input, maxLength = 80) {
	const s = String(input ?? '')
		// 0) Kesme işaretleri: "O'Brien" -> "obrien", tire üretmesin.
		.replace(/['’‘´`]/g, '')
		// 1) Türkçe harfler
		.replace(/[çğıöşüâîûÇĞİIÖŞÜÂÎÛ]/g, (c) => TR_MAP[c] ?? c)
		// 2) Diğer aksanlar (é→e, å→a, ø→o, ñ→n, ß→ss…)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ß/g, 'ss')
		.replace(/[øØ]/g, 'o')
		.replace(/[æÆ]/g, 'ae')
		.replace(/[œŒ]/g, 'oe')
		.replace(/[đĐ]/g, 'd')
		.replace(/[łŁ]/g, 'l')
		.toLowerCase()
		// 3) Alfanümerik olmayanlar → tire
		.replace(/[^a-z0-9]+/g, '-')
		// 4) Kenar ve art arda tireler
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
	return maxLength > 0 ? s.slice(0, maxLength).replace(/-+$/, '') : s;
}
