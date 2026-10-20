import type { APIRoute } from 'astro';
import { allEntries, authorLine, cardText, href, reviewTime, searchText, type Entry } from '../../lib/data';
import { fold } from '../../lib/text';
import { artists, cover, durationText, integer } from '../../lib/music';
import { artistRank } from '../../lib/artist-rank';
import { listedPlaylists } from '../../lib/playlists';
import { genrePages } from '../../lib/artist-info';

/**
 * /ara sayfasının istemci-taraflı kart indeksi.
 *
 * Sayfa HTML'i kartları içermez; istemci bu dosyayı yalnız ilk aramada indirir.
 * Alanlar GlobalSearch.astro'nun beklediği kısa adlardır:
 *   u=url, t=başlık, ty=tür, p=poster, a=yazar satırı, s=alt satır (yıl),
 *   r=puan, y=yıl, rt=yorum zamanı, ft=katlanmış başlık, q=arama metni, idx=sıra,
 *   rk=tüm zamanlar sırası (yalnız sanatçı; "#N" rozeti için), rd=yuvarlak kapak,
 *   sq=kare kapak (sanatçı, playlist).
 * Türler: film | dizi | kitap | sanatci | playlist | muzik-tur.
 */

function displayTitle(e: Entry): string {
	return e.type === 'film' ? e.fullTitle || e.title : e.title;
}

/** Kart alt satırı: yalnız film/dizi (kitapta yazar `a` alanında gösterilir). */
function subText(e: Entry): string {
	return e.type === 'film' || e.type === 'dizi' ? cardText(e) : '';
}

const entries = allEntries.map((e, idx) => ({
	u: href(e),
	t: displayTitle(e),
	ty: e.type,
	p: e.poster,
	a: authorLine(e),
	s: subText(e),
	r: e.rating ?? 0,
	y: e.year || '',
	rt: reviewTime(e),
	ft: fold(displayTitle(e)),
	q: searchText(e),
	idx,
}));

/* Müzik bölümünden eklenen kayıtlar: sanatçı, playlist ve müzik türü.
   `idx` yalnız ilgi sıralamasında eşitlik bozucudur; müzik kayıtları kitap/
   film/dizi kayıtlarından sonra gelir ki varsayılan sırada altta kalsınlar. */
let nextIdx = entries.length;

const artistItems = artists.map((a) => ({
	u: `/muzik/sanatci/${a.slug}`,
	t: a.name,
	ty: 'sanatci' as const,
	p: cover('artist', a.slug) ?? '',
	a: '',
	s: `${integer(a.plays)} çalma · ${durationText(a.ms)}`,
	r: 0,
	y: '',
	rt: 0,
	ft: fold(a.name),
	q: fold(a.name),
	idx: nextIdx++,
	rk: artistRank.get(a.slug) ?? 0,
	rd: true,
	sq: true,
}));

const playlistItems = listedPlaylists().map((p) => ({
	u: `/playlist/${p.id}`,
	t: p.name,
	ty: 'playlist' as const,
	p: p.cover ?? '',
	a: `${p.artistCount} sanatçı`,
	s: `${integer(p.trackCount)} şarkı · ${durationText(p.durationMs)}`,
	r: 0,
	y: '',
	rt: 0,
	ft: fold(p.name),
	q: fold(`${p.name} ${(p.description || '').replace(/<[^>]*>/g, ' ')}`),
	idx: nextIdx++,
	/** Spotify kapakları kare; 2:3 poster çerçevesi kırpıyordu. */
	sq: true,
}));

const genreItems = genrePages.map((g) => ({
	u: g.href,
	t: g.name,
	ty: 'muzik-tur' as const,
	p: '',
	a: `${g.artists.length} sanatçı`,
	s: '',
	r: 0,
	y: '',
	rt: 0,
	ft: fold(g.name),
	q: fold(g.name),
	idx: nextIdx++,
}));

const data = [...entries, ...artistItems, ...playlistItems, ...genreItems];

export const GET: APIRoute = () =>
	new Response(JSON.stringify(data), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
