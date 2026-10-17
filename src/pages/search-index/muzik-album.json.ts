import type { APIRoute } from 'astro';
import { musicSearchIndex } from '../../lib/musicSearchIndex';

/** /muzik/albumler sayfasının arama indeksi. */
export const GET: APIRoute = () =>
	new Response(JSON.stringify(musicSearchIndex('album')), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
