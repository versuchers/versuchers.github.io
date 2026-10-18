// Playlist başlık işleme hattı — site (src/lib/playlists.ts) ve sync
// (scripts/fetch-spotify.mjs) AYNI fonksiyonları kullanır.
//
// Sıra: ham başlık -> Unicode normalize (stilli karakterler -> düz harf)
//       -> playlist-overrides.json'da id OVERRIDE'ı varsa o (kural asla ezmez)
//       -> yoksa kural tabanlı Title Case.

/**
 * Küçük-kapital (small-caps) harflerin NFKD karşılığı yoktur; stil isimlerdeki
 * ᴘ, ꜰ, ɴ vb. harfler buradan düz Latin harfe çevrilir.
 */
const SMALL_CAPS = {
  'ᴀ': 'A', 'ʙ': 'B', 'ᴄ': 'C', 'ᴅ': 'D', 'ᴇ': 'E', 'ꜰ': 'F', 'ɢ': 'G',
  'ʜ': 'H', 'ɪ': 'I', 'ᴊ': 'J', 'ᴋ': 'K', 'ʟ': 'L', 'ᴍ': 'M', 'ɴ': 'N',
  'ᴏ': 'O', 'ᴘ': 'P', 'ʀ': 'R', 'ꜱ': 'S', 'ᴛ': 'T', 'ᴜ': 'U', 'ᴠ': 'V',
  'ᴡ': 'W', 'ʏ': 'Y', 'ᴢ': 'Z', 'ǫ': 'Q', 'ғ': 'F',
};

/** Adın tutulacak karakterleri: harf, birleşik işareti, rakam, boşluk, sıradan noktalama. */
const NAME_KEEP = /[\p{L}\p{M}\p{N}\s\-'’.,:/()&!?]/u;

/** Stil bloğunu (math bold/fraktur, small-caps, süs sembolü) düz Latin harfe çevirir;
 *  NFKD + NFC sayesinde ç ğ ı ö ş ü İ aynen korunur. */
export function flattenName(raw) {
  let s = String(raw ?? '').normalize('NFKD');
  s = s.replace(/[\u200B-\u200D\u2060\uFE0E\uFE0F]/g, '');
  s = [...s].map((ch) => SMALL_CAPS[ch] ?? ch).join('');
  s = [...s].map((ch) => (NAME_KEEP.test(ch) ? ch : ' ')).join('');
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

const EN_SMALL_WORDS = new Set(['a','an','the','in','of','on','at','to','for','and','or','but','with','from','by','as','vs']);
const TR_SMALL_WORDS = new Set(['ve','ile','de','da','ki','mi']);

/** Kelime bazında (tam sözcük eşleşmesi, büyük/küçük harf duyarsız) HER ZAMAN büyük
 *  kalan sözcükler. Yeni sözcük eklemek için diziye ekle; başka değişiklik gerekmez. */
export const ALWAYS_UPPER = ['TR', 'DSBM', 'II', 'BDSM', 'EBM'];

/**
 * Türkçe kanıtı: yalnızca açık Türkçe harfler (ç ğ ı ş İ) ya da Türkçe sözcük listesi.
 * ö/ü tek başına kanıt sayılmaz — Latince/Almanca başlıklarda da geçerler ve
 * "Tardıgrada - Emotionale Ödnis" hatasının (i/ı dönüşümü) kaynağı buydu.
 */
const TR_CHARS_RE = /[çğışİÇĞŞ]/;

function looksTurkish(s) {
  if (TR_CHARS_RE.test(s)) return true;
  return s.split(/[^\p{L}]+/u).some((w) => w && TR_SMALL_WORDS.has(w.toLocaleLowerCase('tr')));
}

function capFirst(word, tr) {
  const chars = [...word];
  if (!chars.length) return word;
  const head = tr ? chars[0].toLocaleUpperCase('tr') : chars[0].toUpperCase();
  const tail = chars.slice(1).join('');
  return head + (tr ? tail.toLocaleLowerCase('tr') : tail.toLowerCase());
}

/**
 * Title Case:
 *  - " - " ile ayrılan HER parçanın ilk sözcüğü daima büyük (Agalloch - The Mantle);
 *  - kelime içindeki tire her parçayı ayrı sözcük gibi büyütür (Post-Black Metal);
 *  - ALWAYS_UPPER sözcükleri her konumda büyük kalır (TR, DSBM, II, BDSM, EBM);
 *  - küçük bağlaçlar (the/of/ve/ile…) yalnızca parçanın ilk sözcüğü değilse küçüktür.
 */
export function titleCaseName(name) {
  const tr = looksTurkish(name);
  const small = tr ? TR_SMALL_WORDS : EN_SMALL_WORDS;
  const upper = new Set(ALWAYS_UPPER.map((w) => w.toLowerCase()));
  return name
    .split(' - ')
    .map((part) => {
      let first = true;
      return part
        .split(/(\s+)/)
        .map((tok) => {
          if (!tok || /^\s+$/.test(tok)) return tok;
          const m = tok.match(/^(\p{P}*)(.*?)(\p{P}*)$/u);
          if (!m) return tok;
          const [, lead, core, trail] = m;
          if (!core) return tok;
          const low = tr ? core.toLocaleLowerCase('tr') : core.toLowerCase();
          // Küçük sözcük eşleşmesi büyük/küçük harf duyarsız: "ILE"/"İLE" → "ile".
          const lowPlain = core.toLowerCase();
          let out;
          if (upper.has(lowPlain)) out = core.toUpperCase();
          else if (!first && (small.has(low) || small.has(lowPlain))) out = lowPlain;
          else if (core.includes('-'))
            out = core
              .split('-')
              .map((w) => (w ? (upper.has(w.toLowerCase()) ? w.toUpperCase() : capFirst(w, tr)) : w))
              .join('-');
          else out = capFirst(core, tr);
          first = false;
          return lead + out + trail;
        })
        .join('');
    })
    .join(' - ');
}

/**
 * Playlist adını normalize edip biçimlendirir:
 * ham ad -> Unicode normalize -> id için OVERRIDE varsa onu -> yoksa kurallar.
 * @param {string} raw Spotify'dan gelen ham ad
 * @param {string} id Spotify playlist id (titles eşlemesinin anahtarı)
 * @param {Record<string,string>} titles playlist-overrides.json -> titles
 */
export function cleanPlaylistName(raw, id, titles) {
  const flat = flattenName(raw);
  const override = id && titles ? titles[id] : undefined;
  if (override) return String(override);
  return flat ? titleCaseName(flat) : raw;
}
