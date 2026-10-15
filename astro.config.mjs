// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://versucher.com',
	build: {
		// /film/matrix-1999 gibi klasör tabanlı URL'ler
		format: 'directory',
	},
});
