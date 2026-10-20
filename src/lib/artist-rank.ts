/**
 * Sanatçı sıralaması: tüm zamanlar çalma sayısına göre.
 *
 * `artists` dizisi zaten çalmaya göre azalan sıralıdır (scripts/build-music.mjs);
 * burada tek gerçeklik noktası olarak konumdan sıra numarası türetilir. Hem
 * sanatçı sayfası başlığındaki "#N" hem arama sonucu için ortak kullanılır.
 */
import { artists } from './music';

/** Sanatçı slug'ından tüm zamanlar sırası (1 tabanlı); yoksa null. */
export const artistRank: Map<string, number> = (() => {
	const map = new Map<string, number>();
	artists.forEach((a, i) => map.set(a.slug, i + 1));
	return map;
})();

/** Sanatçı toplam sayısı (sıralamanın paydası). */
export const artistTotal = artists.length;
