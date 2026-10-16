import type { APIRoute } from 'astro';
import { searchIndex } from '../../lib/searchIndex';

/** /film sayfasının arama indeksi. */
export const GET: APIRoute = () =>
	new Response(JSON.stringify(searchIndex('film')), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
