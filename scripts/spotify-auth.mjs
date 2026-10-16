#!/usr/bin/env node
/**
 * Spotify OAuth refresh token helper (tek seferlik)
 *
 * Kullanım:
 * 1. https://developer.spotify.com/dashboard/ > Create app
 *    - Redirect URI: http://127.0.0.1:8888/callback
 * 2. .env'e SPOTIFY_CLIENT_ID ve SPOTIFY_CLIENT_SECRET ekle (veya komut satırından ver)
 * 3. node scripts/spotify-auth.mjs
 * 4. Verilen URL'yi tarayıcıda aç, onayla → refresh token .env'e yazılır.
 */

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = path.join(ROOT, '.env');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const PORT = 8888;

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'playlist-read-private playlist-read-collaborative user-read-private',
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function base64(s) {
  return Buffer.from(s).toString('base64');
}

async function exchange(code) {
  const tokenUrl = 'https://accounts.spotify.com/api/token';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  }).toString();
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${base64(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function updateEnv(refreshToken) {
  let content = '';
  if (existsSync(ENV)) {
    content = await readFile(ENV, 'utf8');
  }
  if (/^SPOTIFY_REFRESH_TOKEN=/m.test(content)) {
    content = content.replace(/^SPOTIFY_REFRESH_TOKEN=.*$/m, `SPOTIFY_REFRESH_TOKEN=${refreshToken}`);
  } else {
    if (content && !content.endsWith('\n')) content += '\n';
    content += `SPOTIFY_REFRESH_TOKEN=${refreshToken}\n`;
  }
  await writeFile(ENV, content);
  console.log(`✅ Refresh token yazıldı: ${ENV}`);
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ SPOTIFY_CLIENT_ID ve SPOTIFY_CLIENT_SECRET gerekli.');
    console.error('   .env içine ekle veya CLI ile: SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... node scripts/spotify-auth.mjs');
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.statusCode = 400;
        res.end('code parametresi eksik');
        return;
      }
      const tokens = await exchange(code);
      const refresh = tokens.refresh_token;
      if (!refresh) {
        res.statusCode = 500;
        res.end('refresh_token dönmedi');
        return;
      }
      await updateEnv(refresh);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>OK</h2><p>Refresh token .env\'e yazıldı. Bu pencereyi kapatabilirsin.</p></body></html>');
      console.log('✅ Başarılı. Refresh token alındı.');
      server.close(() => process.exit(0));
    } catch (e) {
      console.error('❌ Hata:', e);
      res.statusCode = 500;
      res.end('Hata');
      server.close(() => process.exit(1));
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`✅ Local server çalışıyor: http://127.0.0.1:${PORT}`);
    console.log('Tarayıcıda bu URL\'yi aç:');
    console.log(`  ${buildAuthUrl()}`);
    console.log('Onayladıktan sonra token otomatik .env\'e yazılacak.');
  });
}

main();
