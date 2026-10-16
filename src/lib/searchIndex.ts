/**
 * /ara ve Browse sayfalarının istemci-taraflı arama indeksi.
 *
 * Arama metni sayfaya gömülmez; sayfa boyutunu küçük tutmak için burada
 * üretilip ayrı bir JSON olarak sunulur: `/search-index/<kind>.json`.
 * İstemci bu dosyayı yalnız ilk aramada (veya `?q=` ile gelindiğinde) indirir.
 */
import { allEntries, books, films, searchText, series, type Entry, type Kind } from './data';

const SOURCES: Record<Kind, Entry[]> = { film: films, dizi: series, kitap: books };

/** Verilen küme için (sayfa sırasıyla birebir) arama metinleri. */
export function searchIndex(kind: 'ara' | Kind): string[] {
	const entries = kind === 'ara' ? allEntries : SOURCES[kind];
	return entries.map(searchText);
}
