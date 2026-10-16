import type { APIRoute } from 'astro';
import { searchIndex } from '../../lib/searchIndex';

/** /ara sayfasının arama indeksi (tüm kayıtlar). */
export const GET: APIRoute = () =>
	new Response(JSON.stringify(searchIndex('ara')), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
