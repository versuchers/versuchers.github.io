/**
 * Last.fm "son dinlenenler" — build zamanı çekimi (nearly live).
 *
 *   LASTFM_API_KEY zorunlu (https://www.last.fm/api/account/create).
 *   LASTFM_USER     varsayılan: versucher666
 *   LASTFM_LIMIT    varsayılan: 50
 *
 * Çıktı: src/data/music/lastfm.json
 * Gizlilik: yalnızca sanatçı / şarkı / albüm / tarih / kapak yazılır;
 * ip_addr, kullanıcı adı, platform gibi alanlar asla saklanmaz.
 * Anahtar repoya yazılmaz; anahtarsız betik sessizce çıkar.
 *
 * Kapaklar mümkünse log deposuna aynalanır (indir → webp → push) ve
 * https://versucher.com/log/music/son/<ad>.webp adresi yazılır.
 * Aynalama yoksa (CI'da klon/PAT yoksa) daha önce aynalanmış görseller yine
 * log adresinden, yeni görseller Last.fm CDN'inden gelir — asla kırık olmaz.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mirror, flush, hosted, logUrl } from './lib/mirror.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/music/lastfm.json');

const KEY = process.env.LASTFM_API_KEY;
if (!KEY) {
	// Anahtar yoksa mevcut dosyayı olduğu gibi bırak, sessiz çık.
	process.exit(0);
}

const USER = process.env.LASTFM_USER || 'versucher666';
const LIMIT = Math.min(200, Math.max(1, Number(process.env.LASTFM_LIMIT) || 50));

// Last.fm'in yer tutucu (placeholder) kapak görseli.
const PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';

// Görsel adı: Last.fm URL'inin kendi hash'i (kararlı, okunabilir, benzersiz).
const sonName = (u) => {
	const tail = String(u).split('/').pop().replace(/\.(jpe?g|png|gif|webp)$/i, '');
	return /^[a-f0-9]{32}$/i.test(tail) ? `${tail}.webp` : null;
};

const url =
	'https://ws.audioscrobbler.com/2.0/?method=user.getRecentTracks' +
	`&user=${encodeURIComponent(USER)}` +
	`&api_key=${encodeURIComponent(KEY)}` +
	`&limit=${LIMIT}&format=json`;

const res = await fetch(url, { headers: { 'user-agent': 'versucher.com music archive' } });
if (!res.ok) {
	console.error(`Last.fm HTTP ${res.status}`);
	process.exit(1);
}
const json = await res.json();
if (json.error) {
	console.error(`Last.fm hata ${json.error}: ${json.message}`);
	process.exit(1);
}

const recent = json?.recenttracks?.track ?? [];
const tracks = [];
for (const t of Array.isArray(recent) ? recent : [recent]) {
	const img = (t.image || [])
		.find((i) => i.size === 'large' && i['#text'] && !i['#text'].includes(PLACEHOLDER))?.['#text']
		|| (t.image || [])
			.find((i) => i.size === 'medium' && i['#text'] && !i['#text'].includes(PLACEHOLDER))?.['#text']
		|| null;
	const nm = img ? sonName(img) : null;
	tracks.push({
		artist: String(t.artist?.['#text'] ?? '').trim(),
		name: String(t.name ?? '').trim(),
		album: String(t.album?.['#text'] ?? '').trim(),
		date: t.date?.uts ? Number(t.date.uts) : null, // null = şu an çalıyor
		image: img,
		rel: nm ? `music/son/${nm}` : null,
	});
}

// ---- kapakları log deposuna aynala ---------------------------------------
// Kaynak hâlâ canlı mı? (Ölü Last.fm URL'lerini panele taşımamak için.)
const alive = async (u) => {
	try {
		const r = await fetch(u, { method: 'HEAD', redirect: 'follow' });
		return r.ok;
	} catch {
		return false;
	}
};

const planned = tracks.filter((t) => t.rel && t.image);
for (const t of planned) {
	t.orig = t.image;
	t.a = await mirror(t.image, t.rel, 'lastfm: son dinlenenler');
}
const pushed = planned.length ? await flush() : false;
for (const t of planned) {
	// push başarılıysa HEAD sormaya gerek yok; değilse yayında mı diye bak.
	const u = t.a && pushed ? logUrl(t.rel) : await hosted(t.rel);
	if (u) t.image = u;
	// Ne aynalanabildi ne yayında: kaynak da ölüyse denemeye değmez (null →
	// arayüzde panel arşiv kapağına düşer, kırık görsel gösterilmez).
	else if (!(await alive(t.orig))) t.image = null;
}
for (const t of tracks) {
	delete t.rel;
	delete t.a;
	delete t.orig;
}

const out = { fetchedAt: new Date().toISOString(), tracks };
await writeFile(OUT, JSON.stringify(out) + '\n', 'utf-8');
const self = tracks.filter((t) => t.image && String(t.image).includes('/log/')).length;
console.log(
	`lastfm.json: ${tracks.length} kayıt yazıldı (${self} kapak log deposundan, ` +
		`${tracks.length - self} harici CDN)`,
);
