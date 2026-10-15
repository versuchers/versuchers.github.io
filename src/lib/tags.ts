/** Etiket adlarını URL-güvenli slug'a çevirir (Türkçe karakterler sadeleştirilir). */

const TR_MAP: Record<string, string> = {
	ç: 'c', Ç: 'c',
	ğ: 'g', Ğ: 'g',
	ı: 'i', İ: 'i',
	ö: 'o', Ö: 'o',
	ş: 's', Ş: 's',
	ü: 'u', Ü: 'u',
	â: 'a', î: 'i', û: 'u',
};

export function tagSlug(input: string): string {
	return (
		input
			.trim()
			.replace(/[çÇğĞıİöÖşŞüÜâîû]/g, (c) => TR_MAP[c] ?? c)
			.toLowerCase()
			.replace(/['"’]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80) || 'etiket'
	);
}
