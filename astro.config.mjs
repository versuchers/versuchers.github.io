// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://versucher.com',
	build: {
		// /film/matrix-1999 gibi klasör tabanlı URL'ler
		format: 'directory',
		// CSS küçük (~21 KB / 4.8 KB gzip) — harici dosya yerine HTML'e gömülür,
		// böylece ilk boyamada bir render-blocking istek eksilir.
		inlineStylesheets: 'always',
	},
});
