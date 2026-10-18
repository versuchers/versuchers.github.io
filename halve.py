#!/usr/bin/env python3
"""Belirli sanatçıların her şarkısının dinleme sayısını yarıya indirir.

Kural: eşleşen (sanatçı, şarkı) çiftinde N ham kayıttan ceil(N/2) kayıt kalır.
Eşleşme: büyük/küçük harf + aksan + boşluk duyarsız TAM eşleşme.
Her değiştirilen dosyaya yanına .bak yedeği yazılır.
"""
import json
import math
import os
import re
import unicodedata
from collections import defaultdict

HIST = "/home/versucher/Downloads/Spotify Extended Streaming History"
TARGETS = ["Teoman", "Ghost", "Hayko Cepkin", "Mode XL"]


def norm(s):
    s = (s or "").casefold()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.split())


def track_key(s):
    return " ".join(norm(s).split())


TSET = {norm(a) for a in TARGETS}
FILES = sorted(
    f for f in os.listdir(HIST)
    if re.match(r"Streaming_History_(Audio|Video)_.*\.json$", f)
)

# (artistKey, trackKey) -> [(dosya sırası, satır indeksi)]
pairs = defaultdict(list)
spellings = defaultdict(set)
artist_songs = defaultdict(set)
before_ms = defaultdict(int)
after = 0

for fi, fname in enumerate(FILES):
    with open(os.path.join(HIST, fname), encoding="utf-8") as fh:
        rows = json.load(fh)
    for i, r in enumerate(rows):
        track = r.get("master_metadata_track_name")
        artist = r.get("master_metadata_album_artist_name")
        if not track or not artist:
            continue
        akey = norm(artist)
        if akey not in TSET:
            continue
        spellings[akey].add(artist)
        artist_songs[akey].add(track_key(track))
        before_ms[akey] += 1
        pairs[(akey, track_key(track))].append((fi, i))

# her çift için ceil(N/2) kayıt bırak (zaman içinde eşit aralıklı seçim)
keep = set()  # (fi, i)
for key, recs in pairs.items():
    n = len(recs)
    k = math.ceil(n / 2)
    if k >= n:
        chosen = list(range(n))
    elif k == 1:
        chosen = [0]
    else:
        chosen = sorted({int(round(j * (n - 1) / (k - 1))) for j in range(k)})
        while len(chosen) < k:  # yuvarlama çakışması: en küçük boşlukları doldur
            for idx in range(n):
                if idx not in chosen:
                    chosen.append(idx)
                    break
            chosen.sort()
    for j in chosen:
        keep.add(recs[j])

drops = defaultdict(set)
for key, recs in pairs.items():
    for rec in recs:
        if rec not in keep:
            drops[rec[0]].add(rec[1])

written = []
for fi, fname in enumerate(FILES):
    if fi not in drops:
        continue
    path = os.path.join(HIST, fname)
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)
    after_ms_rows = [r for i, r in enumerate(rows) if i not in drops[fi]]
    bak = path + ".bak"
    if not os.path.exists(bak):
        os.replace(path, bak)          # özgün yedek (.bak)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(after_ms_rows, fh, ensure_ascii=False)
    else:
        # .bak zaten özgün veriyi tutuyorsa üzerine yazma, sadece uygula
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(after_ms_rows, fh, ensure_ascii=False)
    written.append((fname, len(drops[fi])))

print(f"sanatçı   : {', '.join(sorted(T)) if (T := [TARGETS[i] for i in range(len(TARGETS))]) else ''}")
for orig in TARGETS:
    k = norm(orig)
    songs = len(artist_songs.get(k, ()))
    b = before_ms.get(k, 0)
    a = sum(1 for key, recs in pairs.items() if key[0] == k for _ in recs) - sum(
        1 for key, recs in pairs.items() if key[0] == k for rec in recs if rec not in keep)
    print(f"  {orig:15} yazımlar: {', '.join(sorted(spellings.get(k, []))) or '—':28} "
          f"şarkı {songs:3}   kayıt {b} → {a}")
tot_b = sum(before_ms.values())
kept_total = len(keep)
print(f"TOPLAM dinleme kaydı : {tot_b} → {kept_total}  (silinen {tot_b - kept_total})")
print("değişen dosyalar:")
for fname, c in written:
    print(f"  {fname:44} -{c}   .bak: {fname}.bak")
