/**
 * Müzik liste sayfalarının arama indeksleri.
 * Sayfa sırasıyla birebir eşleşen, sadeleştirilmiş metinler; `/search-index/*.json`
 * olarak servis edilir ve yalnızca arama yapıldığında tarayıcıya çekilir.
 */
import { artists, albums, tracks } from './music';
import { fold } from './text';

export type MusicKind = 'sanatci' | 'album' | 'sarki';

/** Verilen müzik türü için (sayfa sırasıyla birebir) arama metinleri. */
export function musicSearchIndex(kind: MusicKind): string[] {
	if (kind === 'sanatci') return artists.map((a) => fold(a.name));
	if (kind === 'album') return albums.map((al) => fold(`${al.name} ${al.artist}`));
	return tracks.map((t) => fold(`${t.name} ${t.artist} ${t.album}`));
}
