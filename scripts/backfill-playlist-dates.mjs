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
import { createThrottle, createSpotifyApi, hasSpotifyCreds } from './lib/spotify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/spotify-playlists.json');

const FORCE = process.argv.includes('--force');

const throttle = createThrottle();
const { api } = createSpotifyApi({ retries: 4, throttle });

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
  if (!hasSpotifyCreds()) {
    console.error('❌ Eksik env: SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN (.env)');
    process.exit(1);
  }

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
