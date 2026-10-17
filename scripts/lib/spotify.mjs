/**
 * Spotify Web API yardımcıları — tek kaynak.
 *
 * Kimlik bilgileri ortam değişkenlerinden okunur:
 *   SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN
 *
 * `api()` token'ı tembel yükler; 429 yanıtlarında `retry-after` kadar bekleyip
 * yeniden dener. İsteğe bağlı `throttle` ile kaba hız sınırı uygulanabilir.
 */

export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const API_BASE = 'https://api.spotify.com/v1';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const b64 = (s) => Buffer.from(s).toString('base64');

/** Ortamdaki Spotify kimlik bilgilerini döndürür. */
export function spotifyCreds() {
	return {
		clientId: process.env.SPOTIFY_CLIENT_ID || '',
		clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
		refreshToken: process.env.SPOTIFY_REFRESH_TOKEN || '',
	};
}

/** Üç kimlik bilgisi de tanımlı mı? */
export function hasSpotifyCreds() {
	const { clientId, clientSecret, refreshToken } = spotifyCreds();
	return Boolean(clientId && clientSecret && refreshToken);
}

/** Refresh token ile access token alır. */
export async function fetchAccessToken() {
	const { clientId, clientSecret, refreshToken } = spotifyCreds();
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${b64(`${clientId}:${clientSecret}`)}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
	});
	if (!res.ok) throw new Error(`Token alınamadı: ${res.status} ${await res.text()}`);
	return (await res.json()).access_token;
}

/**
 * Kaba hız sınırı: `windowMs`'lik pencerede en fazla `limit` istek.
 * Dönen fonksiyonu her API çağrısından önce çağırın.
 */
export function createThrottle(limit = 170, windowMs = 30000) {
	let recent = [];
	return async () => {
		const now = Date.now();
		recent = recent.filter((t) => now - t < windowMs);
		if (recent.length >= limit) {
			const wait = windowMs - (now - recent[0]) + 50;
			if (wait > 0) await sleep(wait);
		}
		recent.push(Date.now());
	};
}

/**
 * Oturum açmış bir Spotify istemcisi döndürür.
 * `api(path)` göreli yol (veya tam URL) alır; token tembel yüklenir,
 * 429'da bekleyip yeniden dener. Yanıt `Response` olarak döner (ok kontrolü çağıranda).
 */
export function createSpotifyApi({ retries = 4, throttle = null } = {}) {
	let token = '';
	const api = async (path, opts = {}) => {
		token ||= await fetchAccessToken();
		const tries = opts.retries ?? retries;
		const url = path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`;
		for (let i = 0; i <= tries; i++) {
			if (throttle) await throttle();
			const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
			if (res.status === 429) {
				const wait = Math.min(Number(res.headers.get('retry-after') || 5), 30);
				console.warn(`   ⏳ 429 — ${wait}s bekleniyor`);
				await sleep(wait * 1000);
				continue;
			}
			return res;
		}
		throw new Error(`Üst üste 429: ${path}`);
	};
	return { api };
}
