import type { APIRoute } from 'astro';
import { allEntries, peopleIndex, ROLE_LABEL, ROLE_ORDER, type RoleId } from '../../lib/data';

/**
 * /ara sonuçlarında "aranan kişi bu yapımda hangi rolde?" sorusunu yanıtlayan
 * küçük istemci indeksi. Yalnız ilk aramada indirilir.
 *
 * Yapı:
 *   labels: rol kısa harfi → görünen ad (ör. "y" → "Yönetmen")
 *   people: kişi slug'ı → [[yapım sırası, rol maskesi], ...]
 *           (yapım sırası = allEntries içindeki idx; maske ROLE_ORDER sırasında)
 */
const idxById = new Map(allEntries.map((e, i) => [e.id, i] as const));

const ROLE_CHAR: Record<RoleId, string> = {
	yonetmen: 'y',
	senaryo: 's',
	hikaye: 'h',
	oyuncu: 'o',
	yaratici: 'c',
	'kaynak-yazar': 'k',
	yazar: 'a',
	cevirmen: 'e',
};

const labels = Object.fromEntries(ROLE_ORDER.map((r) => [ROLE_CHAR[r], ROLE_LABEL[r]]));

const people: Record<string, [number, string][]> = {};
for (const p of peopleIndex.bySlug.values()) {
	const credits: [number, string][] = [];
	for (const w of p.works) {
		const idx = idxById.get(w.entry.id);
		if (idx === undefined) continue;
		const mask = ROLE_ORDER.filter((r) => w.roles.includes(r))
			.map((r) => ROLE_CHAR[r])
			.join('');
		credits.push([idx, mask]);
	}
	credits.sort((a, b) => a[0] - b[0]);
	people[p.slug] = credits;
}

export const GET: APIRoute = () =>
	new Response(JSON.stringify({ labels, people }), {
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
