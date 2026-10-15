// ============================================================================
// Harici profiller / hesaplar
// ----------------------------------------------------------------------------
// Anasayfadaki "Buralarda da varım" kutusunda bunların arasından RASTGELE biri
// gösterilir; "Başka bir yer" düğmesiyle değiştirilebilir.
//
// Yeni satır ekle:  { name, slug, url, note }
//   name : görünen ad          (örn. 'Letterboxd')
//   slug : ikon için simple-icons slug'ı (örn. 'letterboxd'); ikon istemezsen boş bırak
//   url  : profil adresin      ← BURAYI DOLDUR (https:// ile)
//   note : kısa açıklama        (opsiyonel, örn. 'film günlüğüm')
//
// url'i boş olan satırlar hiç gösterilmez. Sıralama önemli değil.
// ============================================================================

export interface Profile {
	name: string;
	slug?: string;
	url: string;
	note?: string;
}

export const profiles: Profile[] = [
	// --- Arşivlerim (izlediklerim / okuduklarım / dinlediklerim) ---
	{ name: 'Letterboxd', slug: 'letterboxd', url: '', note: 'film günlüğüm' },
	{ name: 'Goodreads', slug: 'goodreads', url: '', note: 'kitap rafım' },
	{ name: 'Last.fm', slug: 'lastdotfm', url: '', note: 'dinleme geçmişim' },

	// --- Üretimlerim ---
	{ name: 'Bandcamp (sanatçı)', slug: 'bandcamp', url: '', note: 'yayınlarım' },
	{ name: 'Spotify (sanatçı)', slug: 'spotify', url: '', note: 'müziklerim' },
	{ name: 'SoundCloud', slug: 'soundcloud', url: '', note: 'kayıtlarım' },

	// --- Koleksiyon ---
	{ name: 'Çalma listelerim', url: '', note: 'spotify koleksiyonum' },

	// --- Dinleyici profilleri ---
	{ name: 'Bandcamp (dinleyici)', slug: 'bandcamp', url: '', note: 'koleksiyonum' },
	{ name: 'Spotify (dinleyici)', slug: 'spotify', url: '', note: 'profilim' },

	// --- Sosyal ---
	{ name: 'Instagram', slug: 'instagram', url: '' },
	{ name: 'Tumblr', slug: 'tumblr', url: '' },
	{ name: 'X (Twitter)', slug: 'x', url: '' },
];
