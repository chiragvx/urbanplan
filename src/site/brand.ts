// The brand, in one place: the name every page, card, manifest and llms.txt uses, and the site's address when the
// host doesn't set SITE_URL. A rename (or a new domain) is an edit here.
// (Plain values only: vite.config.ts and the build tools import this file too.)

/** The product's name, as it's written in running text. */
export const SITE_NAME = 'UrbanPlan';
/** The logo splits the name in two, the second part bold: Urban·Plan. Set to [SITE_NAME, ''] for a name that doesn't split. */
export const LOGO_PARTS: [string, string] = ['Urban', 'Plan'];
/** For the home-screen icon (12 characters or fewer). */
export const SHORT_NAME = SITE_NAME;
/** The site's address when neither SITE_URL nor VITE_SITE_URL is set on the host that builds it. */
// TODO: confirm the real domain, then set SITE_URL on the host (or change this fallback)
export const SITE_URL_FALLBACK = 'https://urbanplan.app';
/** The browser bar and home-screen colour (the dark of the logo). */
export const THEME_COLOR = '#0c0c0d';
export const TAGLINE = 'Edit the real city, see what it becomes';
