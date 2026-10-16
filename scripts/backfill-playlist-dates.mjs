#!/usr/bin/env node
/**
 * Her playlist için `createdAt` alanını doldurur.
 *
 * Spotify Web API playlist oluşturulma tarihini doğrudan vermez. En yakın
 * gösterge, playlist öğelerinin `added_at` alanlarının EN ERKENİdir: listenin
 * ilk şarkısı (neredeyse her zaman) oluşturulma anında eklenir. Bu betik tüm
 * öğeleri sayfa sayfa çekip en eski `added_at`i `createdAt` olarak yazar.
 *
 * Var olan veriyi KORUR; yalnızca `createdAt` ekler. Zaten tarihi olanları
 * atlar (--force ile yeniden çeker).
 *
 * Kullanım:
 *   npm run spotify:dates
 *   npm run spotify:dates -- --force
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/spotify-playlists.json');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN || '';
const FORCE = process.argv.includes('--force');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString('base64');

let token = '';
let lastWindow = [];

/** Kaba hız sınırı: 30 sn'lik pencerede 170 isteği geçme. */
async function throttle() {
  const now = Date.now();
  lastWindow = lastWindow.filter((t) => now - t < 30000);
  if (lastWindow.length >= 170) {
    const wait = 30000 - (now - lastWindow[0]) + 50;
    if (wait > 0) await sleep(wait);
  }
  lastWindow.push(Date.now());
}

async function api(u, { retries = 4 } = {}) {
  for (let i = 0; i <= retries; i++) {
    await throttle();
    const res = await fetch(`https://api.spotify.com/v1${u}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 3);
      console.warn(`   ⏳ 429 — ${retry}s bekleniyor`);
      await sleep(retry * 1000);
      continue;
    }
    return res;
  }
  throw new Error(`Üst üste 429: ${u}`);
}

async function getAccessToken() {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${b64(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }).toString(),
  });
  if (!res.ok) throw new Error(`Token alınamadı: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Bir playlistteki en eski `added_at` (ISO) — bulunamazsa null. */
async function earliestAddedAt(id) {
  let next = `/playlists/${id}/items?limit=100&fields=items(added_at),next`;
  let earliest = null;
  while (next) {
    const res = await api(next);
    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`HTTP ${res.status} ${body.slice(0, 120)}`), { status: res.status });
    }
    const json = await res.json();
    for (const it of json.items || []) {
      const a = it?.added_at;
      if (a && (earliest === null || a < earliest)) earliest = a;
    }
    next = json.next ? json.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return earliest;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('❌ Eksik env: SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN (.env)');
    process.exit(1);
  }
  token = await getAccessToken();

  const data = JSON.parse(await readFile(OUT, 'utf8'));
  const playlists = data.playlists || [];
  console.log(`📋 ${playlists.length} playlist — createdAt ${FORCE ? 'yeniden' : 'eksik olanlar'} doldurulacak`);

  let filled = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < playlists.length; i++) {
    const p = playlists[i];
    if (!FORCE && p.createdAt) {
      skipped++;
      continue;
    }
    try {
      const earliest = await earliestAddedAt(p.id);
      p.createdAt = earliest || null;
      if (earliest) filled++;
      else console.warn(`   ⚠️ tarih yok: ${p.name}`);
    } catch (e) {
      failed++;
      p.createdAt = p.createdAt ?? null;
      console.warn(`   ⚠️ atlandı (${e.status || 'hata'}): ${p.name}`);
    }
    if ((i + 1) % 25 === 0) console.log(`   ... ${i + 1}/${playlists.length}`);
  }

  await writeFile(OUT, JSON.stringify(data, null, 2));
  console.log(`✅ createdAt: ${filled} dolduruldu, ${skipped} zaten vardı, ${failed} başarısız`);
}

main().catch((e) => {
  console.error('❌ Hata:', e.message || e);
  process.exit(1);
});
