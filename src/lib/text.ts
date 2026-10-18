/**
 * Metin yardımcıları: başlık biçimlendirme ve Türkçe karakter sadeleştirme.
 * Tek kaynak — sunucu bileşenleri ve tarayıcı betikleri buradaki fonksiyonları kullanır.
 */

/**
 * İngilizce sözcüklerde baş harf `i` → `I`, Türkçede `i` → `İ`.
 * Yalnızca `i` ile başlayan sözcükler için gerekir.
 */
const EN_I_WORDS = new Set([
	'i', "i'd", "i'll", "i'm", "i've", 'is', "isn't", 'it', "it's", 'its', 'if', 'in',
	'into', 'ill', 'ignore', 'ignorance', 'ist', 'idea', 'ideal', 'id', 'image', 'imagine',
	'iron', 'ice', 'inner', 'infinite', 'impossible', 'important', 'interesting',
]);

const LETTER = /[A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû]/;

/**
 * Her sözcüğün ilk harfini büyütür (Türkçe kurallarıyla).
 * Sözcük İngilizce ise ve ilk harfi `i` ise `I` yapılır.
 * Geri kalan harflere dokunulmaz.
 */
export function titleCaseTr(input: string): string {
	return input
		.split(/(\s+)/)
		.map((token) => {
			if (!token || /^\s+$/.test(token)) return token;
			const first = token[0];
			if (!LETTER.test(first)) return token;

			const lower = first.toLocaleLowerCase('tr-TR');
			let upper: string;
			if (lower === 'i') {
				const bare = token.toLowerCase().replace(/[^a-z0-9'’]/g, '');
				upper = EN_I_WORDS.has(bare) ? 'I' : 'İ';
			} else if (lower === 'ı') {
				upper = 'I';
			} else {
				upper = first.toLocaleUpperCase('tr-TR');
			}
			return upper + token.slice(1);
		})
		.join('');
}

const TR_FOLD: Record<string, string> = {
	ç: 'c',
	ğ: 'g',
	ı: 'i',
	ö: 'o',
	ş: 's',
	ü: 'u',
	â: 'a',
	î: 'i',
	û: 'u',
};

/** Türkçe karakterleri sadeleştirip küçük harfe çevirir (arama için). */
export function fold(input: string): string {
	return (
		(input || '')
			.toLowerCase()
			// 'İ'.toLowerCase() birleşik nokta (U+0307) üretir ("i̇"); onu sadele.
			.replace(/i\u0307/g, 'i')
			.replace(/[çğıöşüâîû]/g, (c) => TR_FOLD[c] ?? c)
	);
}

/** Etiket adlarını URL-güvenli slug'a çevirir. */
export function tagSlug(input: string): string {
	return (
		fold(input)
			.trim()
			.replace(/['"’]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80) || 'etiket'
	);
}

/**
 * Çoklu alan değerlerini tek tek ayraçlara böler.
 *
 * Sheet'te iki ayrı ayraç kullanılıyor: film/dizi türleri virgülle
 * (`Suç, Drama`), kitap türleri ise çoğunlukla `//` ile (`Suç // Gizem`) yazılı.
 * Global etiketlerin kitap ile film/dizi tarafında aynı havuzda buluşması için
 * ikisini de kırmak şart; aksi hâlde `/tur/suc` kitapları kaçırır.
 */
export function splitMulti(value?: string | null): string[] {
	const v = String(value ?? '').trim();
	if (!v || v === '-' || v === '—') return [];
	return v
		.split(/\s*\/\/\s*|,/g)
		.map((s) => s.trim())
		.filter(Boolean);
}
