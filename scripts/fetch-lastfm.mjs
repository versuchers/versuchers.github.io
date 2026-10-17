#!/usr/bin/env node
/**
 * Last.fm scrobble'larını (7 Ekim 2026 sonrası) veriye ekler.
 * Toplam dinleme sayıları, son tarih ve istatistikler güncellenir.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATS = path.join(ROOT, 'src/data/music/stats.json');
const ARTISTS = path.join(ROOT, 'src/data/music/artists.json');
const ALBUMS = path.join(ROOT, 'src/data/music/albums.json');
const TRACKS = path.join(ROOT, 'src/data/music/tracks.json');

const KEY = process.env.LASTFM_API_KEY || process.env.LASTFM_APIKEY;
if (!KEY) { console.error('LASTFM_API_KEY eksik'); process.exit(1); }
const USER = process.env.LASTFM_USER || 'versucher666';

async function fetchRecent(fromTs, limit = 200) {
	const params = new URLSearchParams({ method:'user.getrecenttracks', user:USER, api_key:KEY, format:'json', limit:String(limit) });
	if (fromTs != null) params.set('from', String(fromTs));
	const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, { headers:{'user-agent':'versucher.com'} });
	if (!res.ok) throw new Error(`lastfm ${res.status}`);
	const j = await res.json();
	if (j.error) throw new Error(`lastfm ${j.error}`);
	return j.recenttracks?.track || [];
}

const lk = s => String(s||'').toLowerCase().trim();
const tsKey = s => lk(s).replace(/\s+/g,' ');

async function main() {
	const stats = JSON.parse(await readFile(STATS,'utf8'));
	const artists = JSON.parse(await readFile(ARTISTS,'utf8'));
	const albums = JSON.parse(await readFile(ALBUMS,'utf8'));
	const tracks = JSON.parse(await readFile(TRACKS,'utf8'));

	const lastTsDate = stats.range?.last ? new Date(stats.range.last) : null;
	let fromTs = null;
	if (lastTsDate) fromTs = Math.floor(lastTsDate.getTime()/1000) + 5;

	const recent = await fetchRecent(fromTs, 200);

	let added = 0;
	const trackByKey = new Map();
	for (const t of tracks) {
		trackByKey.set(`${tsKey(t.artist)}||${tsKey(t.album)}||${tsKey(t.name)}`, t);
	}
	for (const r of recent) {
		const uts = r.date?.uts ? Number(r.date.uts) : null;
		if (!uts) continue;
		const k1 = `${tsKey(r.artist?.['#text']||r.artist)}||${tsKey(r.album?.['#text']||r.album)}||${tsKey(r.name)}`;
		let found = trackByKey.get(k1);
		if (!found) {
			for (const [k,t] of trackByKey) {
				if (k.startsWith(tsKey(r.artist?.['#text']||r.artist)+'||') && k.endsWith('||'+tsKey(r.name))) { found = t; break; }
			}
		}
		if (!found) continue;
		const before = found.plays || 0;
		const avg = before > 0 ? Math.round(found.ms / before) : (found.ms || 0);
		found.plays += 1;
		found.ms += avg || 0;
		const iso = new Date(uts*1000).toISOString();
		if (!found.last || iso > found.last) found.last = iso;
		added++;
	}
	if (added === 0) { console.log('0 yeni scrobble'); return; }
	// recompute aggregates
	const totalsScrobbles = tracks.reduce((s,t)=>s+(t.plays||0),0);
	const totalsMs = tracks.reduce((s,t)=>s+(t.ms||0),0);
	stats.totals.scrobbles = totalsScrobbles;
	stats.totals.ms = totalsMs;
	stats.totals.hours = Math.round(totalsMs / 3600000);
	stats.range.last = tracks.reduce((max,t)=>{ if (!t.last) return max; if (!max) return t.last; return t.last > max ? t.last : max; }, stats.range.last);
	// days: append today's count
	const today = new Date().toISOString().slice(0,10);
	const lastDay = stats.days[stats.days.length-1]?.d;
	if (!lastDay || lastDay !== today) {
		const cnt = tracks.reduce((s,t)=>{ const d=t.last?.slice(0,10); if (d===today) return s+1; return s; }, 0); // rough
		stats.days.push({d:today, plays:0, ms:0});
	}
	// mostPlayedTrack
	let mT = null;
	for (const t of tracks) if (!mT || (t.plays||0)>(mT.plays||0)) mT = t;
	if (mT) stats.milestones.mostPlayedTrack = { name:mT.name, artist:mT.artist, slug:mT.slug, plays:mT.plays };
	// mostPlayedArtist
	for (const a of artists) {
		const p = tracks.filter(t=>lk(t.artist)===lk(a.name)).reduce((s,t)=>s+(t.plays||0),0);
		if (p>=0) a.plays = p;
	}
	let mA=null; for (const a of artists) if (!mA||(a.plays||0)>(mA.plays||0)) mA=a;
	if (mA) stats.milestones.mostPlayedArtist = { name:mA.name, slug:mA.slug, plays:mA.plays };
	// albums
	for (const al of albums) {
		const p = tracks.filter(t=>lk(t.artist)===lk(al.artist)&&lk(t.album)===lk(al.name)).reduce((s,t)=>s+(t.plays||0),0);
		const ms = tracks.filter(t=>lk(t.artist)===lk(al.artist)&&lk(t.album)===lk(al.name)).reduce((s,t)=>s+(t.ms||0),0);
		al.plays = p; al.ms = ms;
	}
	let mAl=null; for (const al of albums) if (!mAl||(al.plays||0)>(mAl.plays||0)) mAl=al;
	if (mAl) stats.milestones.mostPlayedAlbum = { name:mAl.name, artist:mAl.artist, slug:mAl.slug, plays:mAl.plays };

	await writeFile(TRACKS, JSON.stringify(tracks,null,2)+'\n');
	await writeFile(ARTISTS, JSON.stringify(artists,null,2)+'\n');
	await writeFile(ALBUMS, JSON.stringify(albums,null,2)+'\n');
	await writeFile(STATS, JSON.stringify(stats,null,2)+'\n');
	console.log(`✓ ${added} scrobble eklendi`);
}
main().catch(e=>{console.error('HATA', e);process.exit(1);});
