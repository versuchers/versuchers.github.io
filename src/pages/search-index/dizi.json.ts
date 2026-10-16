import type { APIRoute } from 'astro';
import { searchIndex } from '../../lib/searchIndex';

/** /dizi sayfasının arama indeksi. */
export const GET: APIRoute = () =>
	new Response(JSON.stringify(searchIndex('dizi')), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
