import type { APIRoute } from 'astro';
import { musicSearchIndex } from '../../lib/musicSearchIndex';

/** /muzik/sarkilar sayfasının arama indeksi. */
export const GET: APIRoute = () =>
	new Response(JSON.stringify(musicSearchIndex('sarki')), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
