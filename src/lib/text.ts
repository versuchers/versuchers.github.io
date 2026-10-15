/**
 * Başlık biçimlendirme yardımcıları.
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
