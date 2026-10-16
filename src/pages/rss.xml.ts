import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// XML metinlerinde kaçış gereken karakterler.
const xml = (s: string) =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');

/**
 * Blog akışı (RSS 2.0).
 * Anasayfayla aynı kural: taslaklar ve şifreli (sphinx) yazılar dışarıda tutulur.
 */
export const GET: APIRoute = async ({ site }) => {
	const base = site ?? new URL('https://versucher.com');

	const posts = (
		await getCollection(
			'blog',
			({ data }) => !data.draft && !data.tags.includes('sphinx'),
		)
	).sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

	const items = posts
		.map((post) => {
			const url = new URL(`/blog/${post.id}`, base).href;
			const lines = [
				'    <item>',
				`      <title>${xml(post.data.title)}</title>`,
				`      <link>${url}</link>`,
				`      <guid isPermaLink="true">${url}</guid>`,
				`      <pubDate>${post.data.pubDate.toUTCString()}</pubDate>`,
			];
			if (post.data.description) {
				lines.push(`      <description>${xml(post.data.description)}</description>`);
			}
			for (const tag of post.data.tags) {
				lines.push(`      <category>${xml(tag)}</category>`);
			}
			lines.push('    </item>');
			return lines.join('\n');
		})
		.join('\n');

	const lastBuild = posts[0]?.data.pubDate.toUTCString() ?? new Date(0).toUTCString();

	const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Versucher — yazılar</title>
    <link>${base.href}</link>
    <description>Notlar, denemeler, listeler. Kişisel arşivin konuşan kısmı.</description>
    <language>tr</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${new URL('/rss.xml', base).href}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

	return new Response(feed, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' },
	});
};
