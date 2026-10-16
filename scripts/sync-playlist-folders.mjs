#!/usr/bin/env node
/**
 * Spotify masaüstü istemcisinin yerel LevelDB önbelleğindeki "rootlist"ten
 * playlist → klasör eşlemesini çıkarır → src/data/playlist-folders.json
 *
 * Kök liste (rootlist) yalnızca masaüstü istemcinin yerel önbelleğinde bulunur;
 * Spotify Web API klasörleri hiçbir şekilde açığa çıkarmaz. Bu yüzden klasör
 * bilgisi buradan üretilir ve depoya (repo'ya) işlenir.
 *
 * Eşleme ÇOKTAN-ÇOĞADIR: bir playlist aynı anda birden fazla klasörde yer
 * alabilir (playlistFolders[id] = [klasörId, ...]).
 *
 * Yalnızca WHITELIST_NAMES'te sayılan klasörler siteye alınır; geri kalanı
 * hem burada hem de fetch/prune betiklerinde dışlanır.
 *
 * Kullanım:
 *   npm run spotify:folders
 *   SPOTIFY_DB_DIR=/yol/primary.ldb npm run spotify:folders   (elle dizin)
 *
 * Not: En doğru sonuç için Spotify'ı bir kez açıp kapatmak (rootlist'i tazelemiş
 * olmak) yeterlidir; veri sürekli güncelleniyor olsa da WAL'de bulunur.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/playlist-folders.json');
const PLAYLISTS = path.join(ROOT, 'src/data/spotify-playlists.json');

// Sitede görünür/tıklanabilir olacak klasörler — verilen sıra korunur.
const WHITELIST_NAMES = [
  '₀₁. 𝖵𝖤𝖱𝖲𝖴𝖢𝖧𝖤𝖱',
  '₀₂. 𝖵𝖤𝖱𝖲𝖴𝖢𝖧𝖤𝖱 𝖨𝖨',
  '₀₃. 𝖵𝖤𝖱𝖲𝖴𝖢𝖧𝖤𝖱 𝖨𝖨𝖨',
  '₀₂. 𝖦𝖤𝖭𝖱𝖤',
  '₀₃. 𝖬𝖮𝖮𝖣',
  '₀₃. 𝖠𝖱𝖳𝖨𝖲𝖳',
  '₀₄. 𝖠𝖫𝖡𝖴𝖬',
];

// ---------------------------------------------------------------- LevelDB okuma

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let p = pos;
  while (true) {
    const b = buf[p++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, p];
}

/** LevelDB blokları ham snappy ile sıkıştırılmış olabilir. */
function snappyUncompress(input) {
  let p = 0;
  let ulen;
  [ulen, p] = readVarint(input, p);
  const out = Buffer.allocUnsafe(ulen);
  let o = 0;
  while (p < input.length) {
    const tag = input[p++];
    const type = tag & 0x03;
    if (type === 0) {
      let len = tag >>> 2;
      if (len >= 60) {
        const extra = len - 59;
        len = 0;
        for (let i = 0; i < extra; i++) len |= input[p++] << (8 * i);
        len = (len + 1) >>> 0;
      } else {
        len = (len + 1) >>> 0;
      }
      input.copy(out, o, p, p + len);
      p += len;
      o += len;
    } else {
      let len, offset;
      if (type === 1) {
        len = ((tag >>> 2) & 0x07) + 4;
        offset = ((tag >>> 5) << 8) | input[p++];
      } else if (type === 2) {
        len = (tag >>> 2) + 1;
        offset = input[p] | (input[p + 1] << 8);
        p += 2;
      } else {
        len = (tag >>> 2) + 1;
        offset = input[p] | (input[p + 1] << 8) | (input[p + 2] << 16) | (input[p + 3] << 24);
        p += 4;
      }
      for (let i = 0; i < len; i++) {
        out[o] = out[o - offset];
        o++;
      }
    }
  }
  return out;
}

function readBlock(buf, offset, size) {
  const type = buf[offset + size];
  const raw = buf.subarray(offset, offset + size);
  if (type === 1) return snappyUncompress(raw);
  return Buffer.from(raw);
}

function parseBlockEntries(block) {
  const entries = [];
  let pos = 0;
  let key = Buffer.alloc(0);
  while (pos < block.length - 4) {
    let shared, nonShared, valueLen;
    [shared, pos] = readVarint(block, pos);
    [nonShared, pos] = readVarint(block, pos);
    [valueLen, pos] = readVarint(block, pos);
    if (pos + nonShared + valueLen > block.length) break;
    const keyDelta = block.subarray(pos, pos + nonShared);
    pos += nonShared;
    const value = block.subarray(pos, pos + valueLen);
    pos += valueLen;
    key = Buffer.concat([key.subarray(0, shared), keyDelta]);
    entries.push([Buffer.from(key), Buffer.from(value)]);
  }
  return entries;
}

/** Tek bir .ldb (SSTable) dosyasını okur. Footer bu kurulumda kompakt. */
function readSSTable(buf) {
  if (buf.length < 48) return [];
  if (buf.readBigUInt64LE(buf.length - 8) !== 0xdb4775248b80fb57n) return [];
  const footer = buf.subarray(buf.length - 48, buf.length - 8);

  const readIndexEntries = (handleRegion) => {
    const [off, p0] = readVarint(handleRegion, 0);
    const [size] = readVarint(handleRegion, p0);
    if (!size) return [];
    return parseBlockEntries(readBlock(buf, off, size));
  };

  // Önce standart (20 bayta dolgulu) footer'ı, olmazsa kompakt düzeni dene.
  let indexEntries = [];
  try {
    indexEntries = readIndexEntries(footer.subarray(20, 40));
  } catch {
    indexEntries = [];
  }
  if (!indexEntries.length) {
    try {
      let p = 0;
      let p1, p2, p3;
      [, p1] = readVarint(footer, p);
      [, p2] = readVarint(footer, p1);
      [, p3] = readVarint(footer, p2);
      const [off, p4] = readVarint(footer, p3);
      const [size] = readVarint(footer, p4);
      indexEntries = parseBlockEntries(readBlock(buf, off, size));
    } catch {
      indexEntries = [];
    }
  }

  const out = [];
  for (const [, handle] of indexEntries) {
    try {
      let hp = 0;
      let doff, dsize;
      [doff, hp] = readVarint(handle, hp);
      [dsize, hp] = readVarint(handle, hp);
      if (!dsize || doff + dsize + 5 > buf.length) continue;
      for (const [k, v] of parseBlockEntries(readBlock(buf, doff, dsize))) out.push([k, v]);
    } catch {
      /* bozuk blok — atla */
    }
  }
  return out;
}

/** Write-ahead log (.log) dosyasını okur; put kayıtlarını döndürür. */
function readWAL(buf) {
  const puts = [];
  let fragments = [];
  const flush = () => {
    if (!fragments.length) return;
    const rec = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
    fragments = [];
    if (rec.length >= 12) {
      const count = rec.readUInt32LE(8);
      let p = 12;
      for (let i = 0; i < count && p < rec.length; i++) {
        const t = rec[p++];
        let klen;
        [klen, p] = readVarint(rec, p);
        const key = rec.subarray(p, p + klen);
        p += klen;
        if (t === 1) {
          let vlen;
          [vlen, p] = readVarint(rec, p);
          const value = rec.subarray(p, p + vlen);
          p += vlen;
          puts.push([Buffer.from(key), Buffer.from(value)]);
        }
      }
    }
  };
  const BLOCK = 32768;
  for (let b = 0; b + 7 <= buf.length; b += BLOCK) {
    const end = Math.min(b + BLOCK, buf.length);
    let p = b;
    while (p + 7 <= end) {
      const len = buf.readUInt16LE(p + 4);
      const type = buf[p + 6];
      const ds = p + 7;
      if (type === 0 && len === 0) break;
      if (ds + len > end) break;
      const data = buf.subarray(ds, ds + len);
      if (type === 1) {
        flush();
        fragments = [Buffer.from(data)];
        flush();
      } else if (type === 2) {
        flush();
        fragments = [Buffer.from(data)];
      } else if (type === 3) {
        fragments.push(Buffer.from(data));
      } else if (type === 4) {
        fragments.push(Buffer.from(data));
        flush();
      }
      p = ds + len;
    }
  }
  flush();
  return puts;
}

function findDbDir() {
  if (process.env.SPOTIFY_DB_DIR) return process.env.SPOTIFY_DB_DIR;
  const candidates = [];
  const usersDir = path.join(os.homedir(), '.cache/spotify/Users');
  if (existsSync(usersDir)) {
    for (const u of readdirSync(usersDir)) {
      candidates.push(path.join(usersDir, u, 'primary.ldb'));
      candidates.push(path.join(usersDir, u, 'Cache'));
    }
  }
  candidates.push(path.join(os.homedir(), 'Library/Application Support/Spotify/PersistentCache/Users'));
  for (const c of candidates) {
    if (existsSync(path.join(c, 'CURRENT'))) return c;
  }
  return null;
}

/** Kök listedeki (rootlist) tüm metni bulur. */
async function readRootlist(dbDir) {
  const files = await readdir(dbDir);
  const puts = [];

  // 1) WAL (en taze veri burada)
  for (const f of files.filter((f) => f.endsWith('.log')).sort()) {
    try {
      for (const [k, v] of readWAL(await readFile(path.join(dbDir, f)))) puts.push([k, v]);
    } catch {
      /* atla */
    }
  }
  // 2) SSTable'lar (yedek)
  for (const f of files.filter((f) => f.endsWith('.ldb')).sort()) {
    try {
      for (const [k, v] of readSSTable(await readFile(path.join(dbDir, f)))) puts.push([k, v]);
    } catch {
      /* atla */
    }
  }

  // rootlist anahtarını taşıyan en büyük değeri seç
  let bestKey = null;
  let best = Buffer.alloc(0);
  for (const [k, v] of puts) {
    if (v.length > best.length && k.toString('latin1').includes('rootlist')) {
      best = v;
      bestKey = k.toString('latin1');
    }
  }
  if (!best.length) {
    throw new Error(
      'rootlist bulunamadı. Spotify\'ı bir kez açıp kapat ve tekrar dene, ya da SPOTIFY_DB_DIR ile dizini ver.',
    );
  }
  console.log(`🔎 rootlist: ${best.length} bayt (${JSON.stringify(bestKey.slice(0, 48))})`);
  return best;
}

/** Rootlist metnini klasör ağacına ve playlist→klasör eşlemesine çözer. */
function decodeRootlist(buf) {
  const text = buf.toString('latin1');
  const re = /spotify:(playlist:[A-Za-z0-9]{22}|start-group:[0-9a-f]{16}:[!-~]*|end-group:[0-9a-f]{16})/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text))) tokens.push(m[1]);

  const decode = (s) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
      return s;
    }
  };

  const folders = new Map(); // id -> { id, name, parent }
  const playlistFolders = new Map(); // playlistId -> Set(folderId)
  const stack = [];
  const stats = { start: 0, end: 0, playlist: 0, unfiled: 0, maxDepth: 0 };

  for (const t of tokens) {
    if (t.startsWith('start-group:')) {
      stats.start++;
      const rest = t.slice('start-group:'.length);
      const i = rest.indexOf(':');
      const id = rest.slice(0, i);
      const name = decode(rest.slice(i + 1));
      const parent = stack.length ? stack[stack.length - 1] : null;
      folders.set(id, { id, name, parent });
      stack.push(id);
      if (stack.length > stats.maxDepth) stats.maxDepth = stack.length;
    } else if (t.startsWith('end-group:')) {
      stats.end++;
      const id = t.slice('end-group:'.length);
      const idx = stack.lastIndexOf(id);
      if (idx >= 0) stack.length = idx;
      else if (stack.length) stack.pop();
    } else if (t.startsWith('playlist:')) {
      stats.playlist++;
      const id = t.slice('playlist:'.length);
      // Yalnızca DOĞRUDAN klasör (elenme kararı bunu kullanır). Çip gösteriminde
      // bu klasörün whitelist alt klasörleri ayrıca hesaba katılır.
      const fid = stack.length ? stack[stack.length - 1] : null;
      if (fid) {
        if (!playlistFolders.has(id)) playlistFolders.set(id, new Set());
        playlistFolders.get(id).add(fid);
      } else {
        stats.unfiled++;
      }
    }
  }
  return { folders, playlistFolders, stats };
}

async function main() {
  const dbDir = findDbDir();
  if (!dbDir) {
    console.error('❌ Spotify yerel veritabanı bulunamadı. SPOTIFY_DB_DIR ile belirt.');
    process.exit(1);
  }
  console.log(`📂 DB: ${dbDir}`);

  const rootlist = await readRootlist(dbDir);
  const { folders, playlistFolders, stats } = decodeRootlist(rootlist);
  console.log(
    `🗂️  ${folders.size} klasör, ${playlistFolders.size} playlist eşlendi ` +
      `(start ${stats.start}, end ${stats.end}, playlist ${stats.playlist}, kök ${stats.unfiled}, derinlik ${stats.maxDepth})`,
  );

  // whitelist klasörleri isimden çöz
  const whitelist = [];
  const missing = [];
  for (const name of WHITELIST_NAMES) {
    const found = [...folders.values()].find((f) => f.name === name);
    if (found) whitelist.push(found.id);
    else missing.push(name);
  }
  if (missing.length) {
    console.warn(`⚠️  Bulunamayan whitelist klasörü: ${missing.map((n) => JSON.stringify(n)).join(', ')}`);
  }
  console.log(`✅ whitelist: ${whitelist.length}/${WHITELIST_NAMES.length} klasör çözüldü`);

  const folderObj = {};
  for (const [id, f] of folders) folderObj[id] = { name: f.name, parent: f.parent };

  const playlistFolderObj = {};
  for (const [id, set] of playlistFolders) playlistFolderObj[id] = [...set];

  const out = {
    syncedAt: new Date().toISOString(),
    source: 'spotify-local-rootlist',
    whitelist,
    whitelistNames: WHITELIST_NAMES,
    folders: folderObj,
    playlistFolders: playlistFolderObj,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`💾 ${OUT}`);

  // site verisiyle karşılaştır
  try {
    const site = JSON.parse(await readFile(PLAYLISTS, 'utf8'));
    const wl = new Set(whitelist);
    const byFolder = new Map();
    let keep = 0;
    let drop = 0;
    const dropNames = [];
    for (const p of site.playlists) {
      const fs = playlistFolderObj[p.id] || [];
      const im = fs.length ? fs.map((f) => folderObj[f]?.name || f).join(' + ') : '(kök)';
      byFolder.set(im, (byFolder.get(im) || 0) + 1);
      if (fs.some((f) => wl.has(f))) keep++;
      else {
        drop++;
        dropNames.push(p.name || p.id);
      }
    }
    console.log('\n📊 site playlistlerinin doğrudan klasör dağılımı:');
    for (const [n, c] of [...byFolder.entries()].sort((a, b) => b[1] - a[1])) {
      const isWl = [...folders.values()].some((f) => f.name === n && wl.has(f.id));
      console.log(`   ${String(c).padStart(3)}  ${n}${isWl ? '  ✅' : ''}`);
    }
    console.log(`\n📊 site: ${site.playlists.length} playlist → kalan ${keep}, çıkacak ${drop}`);
    if (drop) console.log(`   çıkacaklar: ${dropNames.map((n) => JSON.stringify(n)).join(', ')}`);
  } catch {
    /* site verisi yoksa geç */
  }
}

main().catch((e) => {
  console.error('❌ Hata:', e.message || e);
  process.exit(1);
});
