/**
 * Harici görsel URL'lerini "log" deposuna ayna (mirror) eder:
 *   indir → webp'ye çevir → <klon>/music/... altına yaz → git push →
 *   https://versucher.com/log/music/... adresi döndürülür.
 *
 * Ortam değişkenleri (opsiyonel):
 *   LOG_REPO_DIR   log deposunun yerel klonu; yoksa ~/versuchers-log denenir
 *   LOG_REPO_TOKEN GitHub PAT — yalnızca klon yoksa klonlamak/CI'da push için
 *   LOG_BASE       varsayılan: https://versucher.com/log
 *
 * Klon yoksa ve token yoksa her şey sessizce devre dışı kalır; çağıran betik
 * özgün (harici) URL'yi kullanır. Böylece CI'da bile site asla kırık görsel
 * göstermez.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export const LOG_BASE = process.env.LOG_BASE || 'https://versucher.com/log';
export const logUrl = (rel) => `${LOG_BASE}/${String(rel).replace(/^\/+/, '')}`;

const TOKEN = process.env.LOG_REPO_TOKEN || '';
let dir = process.env.LOG_REPO_DIR || '';
const pending = new Set();
let commitMsg = 'görsel aynası';

// Token'ı argv'ye ya da klonun .git/config'ine yazmak yerine git'e ortam
// değişkeni üzerinden HTTP başlığı verilir (process listesinde görünmez).
const gitEnv = TOKEN
	? {
			...process.env,
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
			GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`,
		}
	: process.env;

const run = (cmd, args, cwd) =>
	new Promise((res) => {
		const p = spawn(cmd, args, { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		p.stdout.on('data', (d) => (out += d));
		p.stderr.on('data', (d) => (out += d));
		p.on('close', (code) => res({ code, out }));
		p.on('error', (e) => res({ code: 1, out: String(e) }));
	});

const resolveDir = () => {
	if (!dir) {
		const home = path.join(homedir(), 'versuchers-log');
		if (existsSync(home)) dir = home;
	}
	return dir;
};

async function ensureDir() {
	const d = resolveDir();
	if (d) return d;
	if (!TOKEN) return '';
	const dest = path.join(tmpdir(), 'versuchers-log');
	const r = await run('git', ['clone', '--depth', '1', 'https://github.com/versuchers/log.git', dest]);
	if (r.code === 0) {
		dir = dest;
		return dest;
	}
	console.error('[mirror] klonlanamadı:', r.out.trim().slice(0, 200));
	return '';
}

// python3 + PIL ile indir ve webp'ye çevir (Node'ta yerleşik webp kodlayıcı yok)
const PY = `
import os, sys, tempfile, urllib.request
from PIL import Image
url, dest = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(dest), exist_ok=True)
req = urllib.request.Request(url, headers={'User-Agent': 'versucher.com image mirror/1.0'})
with urllib.request.urlopen(req, timeout=45) as r:
    data = r.read()
with tempfile.NamedTemporaryFile(delete=False, suffix='.src') as f:
    f.write(data)
    src = f.name
try:
    Image.open(src).convert('RGB').save(dest, 'WEBP', quality=80, method=4)
finally:
    try:
        os.unlink(src)
    except OSError:
        pass
`;

async function toWebp(url, dest) {
	const r = await run('python3', ['-c', PY, url, dest]);
	return r.code === 0 && existsSync(dest);
}

/** Görseli klonun içine yazar. true = kuyruğa alındı, false = yayınlamadık. */
export async function mirror(url, rel, msg) {
	const d = await ensureDir();
	if (!d) return false;
	if (msg) commitMsg = msg;
	const dest = path.join(d, ...rel.split('/'));
	if (!existsSync(dest) && !(await toWebp(url, dest))) return false;
	pending.add(rel);
	return true;
}

/** Kuyruktaki dosyaları commit'leyip push eder. true = sonuç güvenilir. */
export async function flush() {
	if (!dir || pending.size === 0) return false;
	const r1 = await run('git', ['add', '-A'], dir);
	if (r1.code !== 0) return false;
	const c = await run('git', ['commit', '-m', commitMsg], dir);
	// "nothing to commit" → zaten yayında demektir
	const nothing = /nothing to commit|no changes added|nothing added/i.test(c.out);
	if (c.code !== 0 && !nothing) return false;
	if (nothing) return true;
	const p = await run('git', ['push'], dir);
	if (p.code !== 0) console.error('[mirror] push başarısız:', p.out.trim().slice(-200));
	pending.clear();
	return p.code === 0;
}

/** Dosya yayında mı? Yayında ise log adresini döndürür, değilse null. */
export async function hosted(rel) {
	try {
		const res = await fetch(logUrl(rel), { method: 'HEAD', redirect: 'follow' });
		const ct = res.headers.get('content-type') || '';
		return res.ok && ct.includes('image') ? logUrl(rel) : null;
	} catch {
		return null;
	}
}
