/**
 * Tür etiketi süzgeç mantığı — sitede ve rapor betiğinde ortak kullanılır.
 *
 * Kural 1 (siyah liste): non-genre-tags.json içindeki etiketler TAM eşleşmeyle
 *   (küçük harfe duyarsız, baş/son boşluksuz) elenir. Örn. "german" elenir ama
 *   "german metal" kalır; mikro-türler ("bimbocore") kalır.
 * Kural 2 (eşik): Bir tür bir playlistte ancak en az GENRE_MIN_COUNT şarkıda
 *   görünüyorsa (count >= 2) o playlist için gösterilir.
 * Kural 3 (tek tür): Playlist tür sayımı sanatçı başına TEK türle yapılır
 *   (bkz. primaryGenre). Sanatçının en ağırlıklı geçerli etiketi alınır;
 *   böylece bir sanatçı hem "black metal" hem "atmospheric black metal"
 *   sayımını şişirmez.
 *
 * Saf fonksiyonlar; JSON içe aktarımı çağıran tarafta.
 */

/** Bir playlistte türün görünmesi için gereken minimum şarkı sayısı. */
export const GENRE_MIN_COUNT = 2;

/** Etiket normalizasyonu: trim + küçük harf (birleştiren nokta dahil). */
export function normTag(name) {
	return String(name ?? '')
		.trim()
		.toLowerCase()
		.replace(/\u0307/g, '');
}

/** Siyah liste listesinden Set üretir. */
export function makeNonGenreSet(list) {
	return new Set((list ?? []).map(normTag).filter(Boolean));
}

/**
 * Bir playlistin tür listesini süzer.
 * @returns {{kept: {name: string, count: number}[],
 *            droppedNonGenre: {name: string, count: number}[],
 *            droppedThreshold: {name: string, count: number}[]}}
 */
export function filterGenres(genres, nonGenreSet) {
	const kept = [];
	const droppedNonGenre = [];
	const droppedThreshold = [];
	for (const g of genres ?? []) {
		if (nonGenreSet.has(normTag(g.name))) {
			droppedNonGenre.push(g);
			continue;
		}
		if ((g.count ?? 0) < GENRE_MIN_COUNT) {
			droppedThreshold.push(g);
			continue;
		}
		kept.push(g);
	}
	return { kept, droppedNonGenre, droppedThreshold };
}

/**
 * Sanatçı başına TEK gerçek tür seçer.
 *
 * Last.fm `artist.getTopTags` ağırlığa göre sıralı döner; listede ülke/milliyet
 * ("german"), vokal ("female vocalists") gibi tür olmayan etiketler de bulunur.
 * Siyah listedekiler atlanır ve ilk geçerli etiket döner; hiçbiri yoksa null.
 * Böylece bir sanatçı playlist tür sayımına en fazla bir türle katkı verir.
 *
 * @param {{name: string, count?: number}[]|string[]|undefined} tags
 * @param {Set<string>} nonGenreSet
 * @returns {{name: string, count?: number}|null}
 */
export function primaryGenre(tags, nonGenreSet) {
	for (const t of tags ?? []) {
		const name = typeof t === 'string' ? t : t?.name;
		const norm = normTag(name);
		if (!norm || nonGenreSet.has(norm)) continue;
		return typeof t === 'string' ? { name: t } : t;
	}
	return null;
}

