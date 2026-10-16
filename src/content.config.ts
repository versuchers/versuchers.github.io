import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: ['**/*.{md,mdx}', '!**/_*'] }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional().default(''),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		tags: z.array(z.string()).optional().default([]),
		draft: z.boolean().optional().default(false),
		cover: z.string().optional(),
		/** Blogger'dan aktarılan yazılar için: HTML gövde (markdown yerine). */
		contentHtml: z.string().optional(),
		/** Özgün blog yolu (örn. /2014/06/toplumla-dialog.html). */
		source: z.string().optional(),
		/** Blogger'da şifreli (sp-enc) yayımlanmış yazı mı? */
		encrypted: z.boolean().optional().default(false),
		/** Şifreli yazının base64 çözme yükü (salt/iv/hmac/cipher/hint). */
		encPayload: z.string().optional(),
	}),
});

export const collections = { blog };
