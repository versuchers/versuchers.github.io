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
 *   sq=kare kapak (sanatçı, playlist), tc=şarkı sayısı (playlist sıralaması),
 *   ac=playlistteki sanatçı başına şarkı sayısı [sözlük indeksi, adet].
 * Türler: film | dizi | kitap | sanatci | playlist | muzik-tur.
 *
 * Yanıt `{ ad, af, items }`: `ad`/`af` playlist sanatçı sözlüğüdür (görünen ve
 * katlanmış ad); `ac` bu sözlüğe indeksle referans verir.
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

/* Playlistlerin sanatçı adları ortak bir sözlükte tutulur: aynı ad yüzlerce
   playlistte geçtiği için sözlük indeksiyle referans vermek indeksi küçültür.
   `ad` = görünen ad, `af` = katlanmış ad (karşılaştırma için). */
const artistDict: string[] = [];
const artistDictFolded: string[] = [];
const artistIndex = new Map<string, number>();
function artistKey(name: string): number {
	const folded = fold(name);
	let i = artistIndex.get(folded);
	if (i === undefined) {
		i = artistDict.length;
		artistDict.push(name);
		artistDictFolded.push(folded);
		artistIndex.set(folded, i);
	}
	return i;
}

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
	/* Ad + açıklama + playlistteki sanatçı adları. "marduk" gibi bir sanatçı
	   arandığında içinde o sanatçının şarkısı olan playlistler de çıkar. */
	q: fold(`${p.name} ${(p.description || '').replace(/<[^>]*>/g, ' ')} ${p.artists.map((x) => x.name).join(' ')}`),
	idx: nextIdx++,
	/** Şarkı sayısı: playlist sonuçları en çoktan en aza sıralanır. */
	tc: p.trackCount,
	/** Sanatçı başına şarkı sayısı: [sözlük indeksi, parça sayısı]. */
	ac: p.artists.map((x) => [artistKey(x.name), x.count] as [number, number]),
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

/* Yanıt: kayıt listesi + playlist sanatçı sözlüğü. */
const payload = { ad: artistDict, af: artistDictFolded, items: data };

export const GET: APIRoute = () =>
	new Response(JSON.stringify(payload), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
