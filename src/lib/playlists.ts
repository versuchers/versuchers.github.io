/**
 * Spotify public playlist'ler verisi.
 */
import playlistsJson from '../data/spotify-playlists.json';

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
  artists: SpotifyArtistCount[];
  genres: SpotifyGenreCount[];
  tracks: SpotifyTrack[];
}

export interface SpotifyPlaylistsData {
  fetchedAt: string | null;
  playlists: SpotifyPlaylist[];
}

export const spotifyPlaylists: SpotifyPlaylistsData = playlistsJson as SpotifyPlaylistsData;

export function getPlaylistById(id: string): SpotifyPlaylist | undefined {
  return spotifyPlaylists.playlists.find((p) => p.id === id);
}
