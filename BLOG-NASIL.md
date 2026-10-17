# Blog Nasıl Kullanılır?

Bu site Astro ile üretiliyor. Blog yazıları **tek tek dosya** hâlinde durur; veritabanı yok.

```
src/content/blog/<slug>.md
```

`<slug>` = dosya adı = adres. Yani:

```
src/content/blog/deneme-bir.md   →   https://versucher.com/blog/deneme-bir
```

> `_` ile başlayan dosyalar (ör. `_sablon.md`, `_taslak.md`) **yayımlanmaz**.

---

## 1) Yeni yazı yazmak

1. `src/content/blog/_sablon.md` dosyasını kopyala.
2. Kopyaya anlamlı bir ad ver: `yeni-bir-yazi.md`
   - Küçük harf, Türkçe karaktersiz, kelimeler arası `-`.
3. Baştaki **frontmatter**'ı doldur, altına markdown gövdeni yaz.
4. Kaydet. (Dev sunucusu açıksa sayfa anında oluşur.)

### Frontmatter alanları

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `title` | ✅ | Yazının başlığı |
| `pubDate` | ✅ | Yayın tarihi, `YYYY-AA-GG` |
| `description` | – | Tek cümlelik özet (kartlar + meta) |
| `updatedDate` | – | Güncelleme tarihi |
| `tags` | – | Etiket dizisi, ör. `['deneme', 'kişisel']` |
| `draft` | – | `true` → listelerde gizlenir |
| `cover` | – | Kapak görseli yolu, ör. `/gorseller/x.jpg` |
| `contentHtml` | – | Yalnızca Blogger'dan aktarılan HTML yazılar için |

### Örnek

```md
---
title: 'Yeni bir yazı'
description: 'Kısa özet.'
pubDate: 2026-10-15
tags: ['deneme']
---

Giriş paragrafı.

## Ara başlık

**Kalın**, *italik*, `kod`, [bağlantı](https://ornek.com).

> Alıntı.
```

Markdown destekler: başlıklar (`##`), kalın/eğik, listeler, alıntı (`>`), kod blokları, bağlantılar, yatay çizgi (`---`).

---

## 2) Var olan yazıyı düzeltmek

- **Elle yazılmış yazı:** `src/content/blog/<slug>.md` dosyasını aç, düzenle.
- **Blogger'dan aktarılmış yazı:** içerik `contentHtml:` alanında **HTML** olarak durur. Dosyayı açıp o HTML'i düzenleyebilirsin. İstersen `updatedDate` ekle.

Her iki durumda da kaydettiğinde değişiklik anında yansır.

---

## 3) Önizleme (yerel sunucu)

```bash
./node_modules/.bin/astro dev --background   # başlat
./node_modules/.bin/astro dev status         # çalışıyor mu?
./node_modules/.bin/astro dev logs           # loglar
./node_modules/.bin/astro dev stop           # durdur
```

Adres: <http://localhost:4321>

**Bayat içerik sorunu:** Frontmatter/şema değişikliğinden veya toplu içe aktarma sonrası eski içerik görünürse:

```bash
./node_modules/.bin/astro dev stop
rm -f .astro/data-store.json node_modules/.astro/data-store.json
./node_modules/.bin/astro dev --background
```

---

## 4) Yayınlamak (build)

```bash
npm run build      # çıktı: dist/
```

`dist/` klasörünü bir statik hosting'e (Netlify, Vercel, Cloudflare Pages, GitHub Pages…) yükle.

---

## 5) Şifreli yazılar

Blogger'daki şifreli (`sp-enc`) yazılar `encrypted: true` + `encPayload` alanlarıyla gelir. Sayfada parola girilen bir kutu çıkar. Elle yeni şifreli yazı üretmek için ayrı bir şifreleme aracı gerekir (istenirse eklenebilir).

---

## Kısa özet

| İş | Yapılacak |
|---|---|
| Yeni yazı | `_sablon.md`'yi kopyala → yeni ad → frontmatter + gövde |
| Düzeltme | İlgili `.md` dosyasını (veya `contentHtml`'i) düzenle |
| Önizleme | `astro dev --background` → localhost:4321 |
| Yayınlama | `npm run build` → `dist/` |
