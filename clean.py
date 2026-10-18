#!/usr/bin/env python3
"""Spotify extended streaming history temizliği.

  python3 clean.py --dry-run   # sadece özet tablo (dosyalar değişmez)
  python3 clean.py --apply     # dosyaları yeniden yazar (yedek: <arşiv>/data_backup/)

1) ORANLAMA: listelenen sanatçıların şarkı bazında (ms>=30s, tekrarsız)
   dinleme sayısı N -> max(1, round(N/3)); fazlası yıllara orantılı silinir.
2) TAM SİLME: Miracle Tones, Massive Attack, Birol Giray (BeeGee)
   (tüm yıllar/tüm kayıtlar) + Limp Bizkit - "Hot Dog" (Hotdog yazımı dahil).
"""
import json
import math
import os
import re
import sys
import unicodedata
from collections import defaultdict

HIST = "/home/versucher/Downloads/Spotify Extended Streaming History"
MIN_MS = 30_000

RATIO_ARTISTS = [
    "Ceza", "Gojira", "Malt", "Ezhel", "iPhonedo", "Peyk", "Çilekeş",
    "Knife Party", "Limp Bizkit", "Can Gox", "Kurban", "Rotting Christ",
    "Birol Giray (BeeGee)",
]
FULL_DELETE_ARTISTS = ["Miracle Tones", "Massive Attack", "Birol Giray (BeeGee)"]


def norm(s):
    """casefold -> NFD -> birleşik işaretleri at -> boşlukları sadeleştir."""
    s = (s or "").casefold()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.split())


def track_key(s):
    """'Hot Dog' / 'Hotdog' aynı anahtar."""
    return re.sub(r"[^0-9a-zığşçöüâîû]+", "", norm(s))


def year_of(ts):
    """UTC+3 yerel yıl."""
    return int(ts[:4]) + (1 if int(ts[11:13]) + 3 >= 24 else 0)


RATIO_SET = {norm(a): a for a in RATIO_ARTISTS}
FULL_SET = {norm(a): a for a in FULL_DELETE_ARTISTS}
HOTDOG = (norm("Limp Bizkit"), track_key("Hot Dog"))

FILES = sorted(
    f for f in os.listdir(HIST)
    if re.match(r"Streaming_History_(Audio|Video)_.*\.json$", f)
)

spellings = defaultdict(set)       # oranlama sanatçısı -> orijinal yazımlar
full_spellings = defaultdict(set)  # tam silme hedefi -> orijinal yazımlar
deleted = defaultdict(dict)        # dosya -> {satır indeksi: sebep}
song_buckets = defaultdict(list)   # (artistKey, trackKey) -> [(year, dedupkey, dosya, idx)]
seen = set()
stats = {"records": 0, "music": 0}

# --- tek geçiş: oku, işaretle ------------------------------------------------------------
for fname in FILES:
    with open(os.path.join(HIST, fname), encoding="utf-8") as fh:
        rows = json.load(fh)
    marks = deleted[fname]
    for i, r in enumerate(rows):
        stats["records"] += 1
        track = r.get("master_metadata_track_name")
        artist = r.get("master_metadata_album_artist_name")
        if not track or not artist:
            continue
        stats["music"] += 1
        akey = norm(artist)
        tkey = track_key(track)

        # --- 2) TAM SİLME ---
        label = None
        if akey in FULL_SET:
            label = FULL_SET[akey]
        elif (akey, tkey) == HOTDOG:
            label = "Limp Bizkit – Hot Dog"
        if label:
            full_spellings[label].add(artist if label != "Limp Bizkit – Hot Dog"
                                      else f"{artist} – {track}")
            marks[i] = f"full:{label}"
            continue

        # --- 1) ORANLAMA: eşleşen yazımları raporla ---
        if akey in RATIO_SET:
            spellings[RATIO_SET[akey]].add(artist)

        # scrobble adayı mı? (ms>=30s + tekrarsız)
        if (r.get("ms_played") or 0) < MIN_MS:
            continue
        ts = r.get("ts")
        if not ts:
            continue
        uri = r.get("spotify_track_uri") or f"{artist}\0{track}"
        key = f"{ts}|{uri}"
        if key in seen:
            continue
        seen.add(key)
        if i in marks:
            continue  # zaten tam silindi
        if akey in RATIO_SET:
            song_buckets[(akey, tkey)].append((year_of(ts), key, fname, i))


# --- 1) oranlama: hedef + yıllara orantılı dağıtım --------------------------------------
def distribute(counts, total_target):
    """Her yılın payı korunarak toplam `total_target` kayıt bırak."""
    years = sorted(counts)
    n = len(years)
    if total_target >= n:  # her boş yıl en az 1 kayıt
        rem = total_target - n
        s = [counts[y] for y in years]
        tot = sum(s)
        ideals = [rem * x / tot for x in s]
        base = [int(math.floor(v)) for v in ideals]
        extra = rem - sum(base)
        order = sorted(range(n), key=lambda i: -(ideals[i] - base[i]))
        for j in range(extra):
            base[order[j]] += 1
        return {y: 1 + base[i] for i, y in enumerate(years)}
    # hedef < yıl sayısı: en çok dinlenen yıllarda 1'er bırak (kaçınılmaz)
    order = sorted(years, key=lambda y: -counts[y])
    return {y: (1 if y in order[:total_target] else 0) for y in years}


ratio_songs = defaultdict(lambda: [0, 0])  # artistKey -> [şarkı, silinecek kayıt]
ratio_year_drop = defaultdict(lambda: defaultdict(int))
for (akey, tkey), recs in song_buckets.items():
    n = len(recs)
    target = max(1, round(n / 3))
    if target >= n:
        ratio_songs[akey][0] += 1
        continue
    by_year = defaultdict(list)
    for year, key, fname, idx in recs:
        by_year[year].append((key, fname, idx))
    keep_counts = distribute({y: len(v) for y, v in by_year.items()}, target)
    for year, items in by_year.items():
        k = keep_counts[year]
        items = sorted(items, key=lambda t: t[0])  # ts'ye göre sırala
        if k == 0:
            keep_ids = set()
        elif k >= len(items):
            keep_ids = {id(x) for x in items}
        else:  # yıl içinde eşit aralıklı seçim
            last = len(items) - 1
            keep_ids = {id(items[int(round(j * last / max(1, k - 1)))])
                        for j in range(k)}
        for it in items:
            if id(it) in keep_ids:
                continue
            _key, fname, idx = it
            if "full" in deleted[fname].get(idx, ""):
                continue
            deleted[fname][idx] = "ratio"
            ratio_year_drop[akey][year] += 1

# net sayım: her şarkı için N - hedef
ratio_songs = defaultdict(lambda: [0, 0])
for (akey, tkey), recs in song_buckets.items():
    n = len(recs)
    target = max(1, round(n / 3))
    if n > target:
        ratio_songs[akey][0] += 1
    ratio_songs[akey][1] += max(0, n - target)


# --- özet tablo --------------------------------------------------------------------------
APPLY = "--apply" in sys.argv
print("=" * 96)
print("TEMİZLİK ÖZETİ — DRY-RUN (dosyalar DEĞİŞMEDİ)" if not APPLY
      else "TEMİZLİK ÖZETİ — UYGULANIYOR")
print("=" * 96)
print(f"dosya {len(FILES)} | toplam kayıt {stats['records']} | müzik kaydı {stats['music']} "
      f"| tekrarsız scrobble adayı {len(seen)}")

print("\n1) ORANLAMA  (N -> max(1, round(N/3)), yıllara orantılı)")
print(f"  {'sanatçı':22} {'eşleşen yazımlar':40} {'şarkı':>5} {'silinen':>7}")
for orig in RATIO_ARTISTS:
    k = norm(orig)
    sp = ", ".join(sorted(spellings.get(orig, []))) or ("(tümü tam silindi)" if orig == "Birol Giray (BeeGee)" else "—")
    songs, drop = ratio_songs.get(k, [0, 0])
    print(f"  {orig:22} {sp[:40]:40} {songs:>5} {drop:>7}")
print(f"  {'TOPLAM':22} {'':40} {sum(v[0] for v in ratio_songs.values()):>5} "
      f"{sum(v[1] for v in ratio_songs.values()):>7}")

print("\n2) TAM SİLME")
for label in ["Limp Bizkit – Hot Dog", "Miracle Tones", "Massive Attack",
              "Birol Giray (BeeGee)"]:
    cnt = sum(1 for f in deleted.values() for why in f.values() if why == f"full:{label}")
    sp = ", ".join(sorted(full_spellings.get(label, []))) or "(kayıt yok)"
    print(f"  {label:24} {cnt:6} kayıt   yazımlar: {sp[:46]}")

print("\n3) DOSYA BAZINDA SİLİNECEK")
total = 0
for fname in FILES:
    c = len(deleted[fname])
    total += c
    if c:
        fr = sum(1 for w in deleted[fname].values() if w == "ratio")
        print(f"  {fname:44} {c:6}  (oran {fr} / tam {c - fr})")
print(f"  {'TOPLAM':44} {total:6}")

if APPLY:
    for fname in FILES:
        marks = deleted[fname]
        if not marks:
            continue
        path = os.path.join(HIST, fname)
        with open(path, encoding="utf-8") as fh:
            rows = json.load(fh)
        kept = [r for i, r in enumerate(rows) if i not in marks]
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(kept, fh, ensure_ascii=False)
    print("\n✓ dosyalar yazıldı (yedek: <arşiv>/data_backup/)")
