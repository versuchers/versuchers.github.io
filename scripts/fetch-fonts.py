#!/usr/bin/env python3
"""Google Fonts -> yerel woff2 + @font-face uretir.

Kullanim:  python3 scripts/fetch-fonts.py
Cikti:     public/fonts/*.woff2  +  src/styles/fonts.css

Neden: fontlar Google'dan cekilince her acilista fonts.googleapis.com'a
render-blocking CSS istegi + fonts.gstatic.com'a yeni baglanti (DNS/TLS)
gerekiyordu. Yerelden sununca bu tamamen kalkiyor.

Sadece latin + latin-ext alt kumeleri indirilir; Turkce icin yeterli
(c/o/u latin'de, g/i-noktasiz/I-noktali latin-ext'te).
Italik dosyalari da inilir ama kullanilmadikca tarayici hic indirmez.
"""
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'public', 'fonts')
CSS_OUT = os.path.join(ROOT, 'src', 'styles', 'fonts.css')

# Site genelde bu dort fontu kullanir (bkz. src/styles/global.css);
# blog yazi govdesi istisna olarak Cormorant Garamond kullanir.
FAMILIES = [
    'Manufacturing+Consent',
    'Alegreya:ital,wght@0,400..900;1,400..900',
    'Manrope:wght@200..800',
    'Bitter:ital,wght@0,100..900;1,100..900',
    'Cormorant+Garamond:ital,wght@0,300..700;1,300..700',
]
KEEP = ('latin', 'latin-ext')
UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    url = 'https://fonts.googleapis.com/css2?' + '&'.join(
        f'family={f}' for f in FAMILIES
    ) + '&display=swap'
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode('utf-8')

    blocks = re.findall(r'/\*\s*([a-z-]+)\s*\*/\s*(@font-face\s*\{.*?\})', raw, re.S)

    out = [
        "/* Yerel fontlar — Google Fonts'tan indirildi (latin + latin-ext).",
        '   Elle duzenlemeyin: scripts/fetch-fonts.py ile uretilir. */',
        '',
    ]
    downloaded = total = 0

    for subset, block in blocks:
        if subset not in KEEP:
            continue
        family = re.search(r"font-family:\s*'([^']+)'", block).group(1)
        style = re.search(r'font-style:\s*(\w+)', block).group(1)
        weight = re.search(r'font-weight:\s*([\d ]+)', block).group(1).strip()
        src = re.search(r'url\((https://[^)]+)\)', block).group(1)
        rng = re.search(r'unicode-range:\s*([^;]+);', block).group(1).strip()

        slug = re.sub(r'[^a-z0-9]+', '-', family.lower()).strip('-')
        name = f'{slug}-{style}-{subset}.woff2'
        dest = os.path.join(OUT_DIR, name)

        if not os.path.exists(dest):
            freq = urllib.request.Request(src, headers={'User-Agent': UA})
            with urllib.request.urlopen(freq, timeout=60) as r:
                data = r.read()
            with open(dest, 'wb') as fh:
                fh.write(data)
            downloaded += 1
        total += os.path.getsize(dest)

        out.append(
            f"/* {family} {style} {weight} — {subset} */\n"
            '@font-face {\n'
            f"  font-family: '{family}';\n"
            f'  font-style: {style};\n'
            f'  font-weight: {weight};\n'
            '  font-display: swap;\n'
            f"  src: url('/fonts/{name}') format('woff2');\n"
            f'  unicode-range: {rng};\n'
            '}'
        )

    with open(CSS_OUT, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(out) + '\n')

    print(f'yeni indirilen: {downloaded}, toplam {total / 1024:.1f} KB, '
          f'{len(os.listdir(OUT_DIR))} dosya')


if __name__ == '__main__':
    main()
