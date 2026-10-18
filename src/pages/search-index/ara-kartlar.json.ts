import type { APIRoute } from 'astro';
import { allEntries, authorLine, cardText, href, reviewTime, searchText, type Entry } from '../../lib/data';
import { fold } from '../../lib/text';

/**
 * /ara sayfasının istemci-taraflı kart indeksi.
 *
 * Sayfa HTML'i kartları içermez; istemci bu dosyayı yalnız ilk aramada indirir.
 * Alanlar GlobalSearch.astro'nun beklediği kısa adlardır:
 *   u=url, t=başlık, ty=tür, p=poster, a=yazar satırı, s=alt satır (yıl),
 *   r=puan, y=yıl, rt=yorum zamanı, ft=katlanmış başlık, q=arama metni, idx=sıra.
 */

function displayTitle(e: Entry): string {
	return e.type === 'film' ? e.fullTitle || e.title : e.title;
}

/** Kart alt satırı: yalnız film/dizi (kitapta yazar `a` alanında gösterilir). */
function subText(e: Entry): string {
	return e.type === 'film' || e.type === 'dizi' ? cardText(e) : '';
}

const data = allEntries.map((e, idx) => ({
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

export const GET: APIRoute = () =>
	new Response(JSON.stringify(data), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
