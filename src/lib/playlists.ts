/**
 * Spotify public playlist'ler verisi.
 */
import playlistsJson from '../data/spotify-playlists.json';
import overridesJson from '../data/playlist-overrides.json';
import { flattenName, cleanPlaylistName } from './playlist-title.mjs';
import foldersJson from '../data/playlist-folders.json';

export interface SpotifyArtistCount {
  name: string;
  count: number;
}

export interface SpotifyGenreCount {
  name: string;
  count: number;
}

export interface SpotifyTrack {
  name: string;
  artists: { name: string; id?: string }[];
  album: string;
  durationMs: number;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  url: string;
  cover: string | null;
  owner: string | null;
  trackCount: number;
  durationMs: number;
  artistCount: number;
  albumCount: number;
  folder?: string;
  /** Playlistin oluşturulma tarihi (en eski şarkı ekleme tarihinden), ISO. */
  createdAt?: string | null;
  artists: SpotifyArtistCount[];
  genres: SpotifyGenreCount[];
  tracks: SpotifyTrack[];
}

export interface SpotifyPlaylistsData {
  fetchedAt: string | null;
  playlists: SpotifyPlaylist[];
}

// ------------------------------------------- ad düzleştirme & başlık override
// Başlık hattı src/lib/playlist-title.mjs'dedir (site ile sync paylaşır):
// ham ad -> Unicode normalize -> playlist-overrides.json'da id override'ı
// varsa o (kural asla ezmez) -> yoksa kural tabanlı Title Case.

/**
 * Elle başlık düzeltmeleri ve sitede gösterilmeyenler (src/data/playlist-overrides.json):
 *  - titles: playlist id -> doğru başlık; kural tabanlı biçimlendirme bunu asla ezmez.
 *  - exclude: playlist id listesi; yalnızca siteyi filtreler, sync verisinden silinmez.
 * Yeni düzeltmeler koda değil bu dosyaya eklenir.
 */
const overrides = overridesJson as { titles?: Record<string, string>; exclude?: string[] };
const titleOverrides: Record<string, string> = overrides.titles ?? {};
const excludedIds = new Set<string>(overrides.exclude ?? []);

export const spotifyPlaylists: SpotifyPlaylistsData = {
  ...(playlistsJson as SpotifyPlaylistsData),
  playlists: (playlistsJson as SpotifyPlaylistsData).playlists
    .filter((p) => !excludedIds.has(p.id))
    .map((p) => ({
      ...p,
      name: cleanPlaylistName(p.name, p.id, titleOverrides),
    })),
};

export function getPlaylistById(id: string): SpotifyPlaylist | undefined {
  return spotifyPlaylists.playlists.find((p) => p.id === id);
}

// ------------------------------------------------------------------ klasörler

export interface PlaylistFolderInfo {
  name: string;
  parent: string | null;
}

export interface PlaylistFoldersMap {
  syncedAt: string | null;
  source: string;
  /** Sitede gösterilen klasör id'leri (verilen sırada). */
  whitelist: string[];
  whitelistNames: string[];
  folders: Record<string, PlaylistFolderInfo>;
  /** playlistId -> doğrudan bulunduğu klasör id'leri (çoktan-çoğa). */
  playlistFolders: Record<string, string[]>;
}

export const playlistFolders = foldersJson as PlaylistFoldersMap;

/**
 * Spotify klasör adı -> sitede görünen ad (TEK eşleme noktası).
 * Anahtar, ham Spotify adının numara öneki düşürülmüş düzleştirilmiş hâlidir;
 * ham adlar değişmez, eşleme sync'den sonra da display katmanında uygulanır.
 * Değerler site adıdır; sunumda mevcut çip stili (büyük harf) korunur.
 */
export const FOLDER_NAME_MAP: Record<string, string> = {
  versucher: 'sun',
  'versucher ii': 'moon',
  'versucher iii': 'eclipse',
  genre: 'spectrum',
  artist: 'orbit',
};

/** Klasör adının başındaki numarayı (₀₁. / 1. vb.) sitede gizle, eşleme varsa uygula. */
export function folderDisplayName(name: string): string {
  const flat = flattenName(name);
  const stripped = flat.replace(/^\s*[0-9\u2080-\u2089]+\s*[.·]\s*/, '').trim() || flat || name;
  const mapped = FOLDER_NAME_MAP[stripped.toLowerCase()];
  return mapped ? mapped.toUpperCase() : stripped;
}

/** Sitede gösterilecek klasörler (whitelist), verilen sırada. */
export function folderChips(): { id: string; name: string }[] {
  return playlistFolders.whitelist.map((id) => ({
    id,
    name: folderDisplayName(playlistFolders.folders[id]?.name ?? id),
  }));
}

/** Playlist'in doğrudan (whitelist) klasör id'leri. */
export function getPlaylistFolderIds(id: string): string[] {
  const wl = new Set(playlistFolders.whitelist);
  return (playlistFolders.playlistFolders[id] ?? []).filter((f) => wl.has(f));
}

/**
 * Klasör süzgeci aktif mi? (whitelist boşsa süzgeç uygulanmaz.)
 * Süzgeç aktifken yalnızca whitelist bir klasöre doğrudan ait playlistler
 * gösterilir; başka klasörlerin altındakiler hiçbir zaman görünmez.
 */
export const folderFilterActive = playlistFolders.whitelist.length > 0;

export function isListedPlaylist(p: SpotifyPlaylist): boolean {
  return !folderFilterActive || getPlaylistFolderIds(p.id).length > 0;
}

/** Sitede gösterilecek playlistler (sıralı, süzgeçli). */
export function listedPlaylists(): SpotifyPlaylist[] {
  return spotifyPlaylists.playlists
    .filter(isListedPlaylist)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Bir klasörün listelenen playlistleri (alfabetik). '__all' → tümü. */
export function playlistsInFolder(folder: string): SpotifyPlaylist[] {
  const all = listedPlaylists();
  if (folder === '__all') return all;
  return all.filter((p) => getPlaylistFolderIds(p.id).includes(folder));
}
