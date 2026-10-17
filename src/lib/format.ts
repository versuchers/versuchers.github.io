/** Biçimlendirme yardımcıları. */

/** '18.11.2017' | '07.10.2026 17:30' -> Date (yoksa null). */
export function parseTrDate(value?: string | null): Date | null {
	if (!value) return null;
	const m = String(value).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
	if (!m) return null;
	const [, d, mo, y, h, mi] = m;
	return new Date(
		Number(y),
		Number(mo) - 1,
		Number(d),
		h ? Number(h) : 0,
		mi ? Number(mi) : 0,
	);
}

const TR_MONTHS = [
	'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
	'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/** '18.11.2017' -> '18 Kasım 2017'. Sadece yıl varsa yılı döner. */
export function formatTrDate(value?: string | null): string {
	if (!value) return '';
	const m = String(value).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
	if (!m) return String(value);
	const [, d, mo, y] = m;
	const month = TR_MONTHS[Number(mo) - 1] ?? mo;
	return `${Number(d)} ${month} ${y}`;
}

/**
 * Bir Date'i Türkçe "18 Kasım 2017" olarak biçimlendirir.
 * `timeZone: 'UTC'` sayesinde build sunucusunun saat dilimi tarihi kaydırmaz.
 */
const DATE_FMT = new Intl.DateTimeFormat('tr-TR', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC',
});

export function formatDate(date: Date): string {
	return DATE_FMT.format(date);
}

const TR_MONTHS_LOWER = TR_MONTHS.map((m) => m.toLocaleLowerCase('tr'));

/**
 * Gevşek tarih: '2025', 'Aralık 2025', '2026 Ağustos', '20.01.2026'.
 * Yalnız yıl varsa yıl ortası (1 Temmuz) kullanılır; çözülemezse null.
 */
export function parseLooseTrDate(value?: string | null): Date | null {
	const raw = String(value ?? '').trim();
	if (!raw) return null;
	const exact = parseTrDate(raw);
	if (exact) return exact;
	const lower = raw.toLocaleLowerCase('tr');
	const year = raw.match(/\d{4}/);
	const month = TR_MONTHS_LOWER.findIndex((m) => lower.includes(m));
	if (year && month >= 0) return new Date(Number(year[0]), month, 1);
	if (year) return new Date(Number(year[0]), 6, 1);
	return null;
}

/** Gevşek tarihin görünümü (gün/ay/yıl sırasıyla): '20 Ocak 2026' | 'Ağustos 2026' | '2025'. */
export function formatLooseTrDate(value?: string | null): string {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	const d = parseLooseTrDate(raw);
	if (!d) return raw;
	if (parseTrDate(raw)) return `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	const lower = raw.toLocaleLowerCase('tr');
	if (TR_MONTHS_LOWER.some((m) => lower.includes(m)))
		return `${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	return String(d.getFullYear());
}

/** '2004-2005' -> '2004–2005', '2013-' -> '2013–', '1999' -> '1999'. */
export function formatYearRange(value?: string | null, fallback = ''): string {
	const raw = String(value ?? '').trim();
	if (!raw) return fallback;
	return raw.replace(/-/g, '–');
}
