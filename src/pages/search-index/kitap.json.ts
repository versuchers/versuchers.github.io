import type { APIRoute } from 'astro';
import { searchIndex } from '../../lib/searchIndex';

/** /kitap sayfasının arama indeksi. */
export const GET: APIRoute = () =>
	new Response(JSON.stringify(searchIndex('kitap')), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
