/**
 * /ara ve Browse sayfalarının istemci-taraflı arama indeksi.
 *
 * Arama metni sayfaya gömülmez; sayfa boyutunu küçük tutmak için burada
 * üretilip ayrı bir JSON olarak sunulur: `/search-index/<kind>.json`.
 * İstemci bu dosyayı yalnız ilk aramada (veya `?q=` ile gelindiğinde) indirir.
 */
import { books, films, series, type Entry, type Kind } from './data';
import { searchText } from './data';

const SOURCES: Record<Kind, Entry[]> = { film: films, dizi: series, kitap: books };

/** Verilen küme için (sayfa sırasıyla birebir) arama metinleri. */
export function searchIndex(kind: Kind): string[] {
	const entries = SOURCES[kind];
	return entries.map(searchText);
}
