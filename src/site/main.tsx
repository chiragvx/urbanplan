// The website's pages, one HTML entry each (index.html, pricing/, login/ …), all rendered from here by data-page.
import { render, type FunctionComponent } from 'preact';
import './site.css';
import { Landing } from './Landing';
import { Pricing } from './Pricing';
import { Login, Signup, Forgot, Reset } from './AuthPages';
import { Account } from './Account';
import { Terms, Privacy } from './Legal';

const PAGES: Record<string, FunctionComponent> = { landing: Landing, pricing: Pricing, login: Login, signup: Signup, forgot: Forgot, reset: Reset, account: Account, terms: Terms, privacy: Privacy };

const root = document.getElementById('site')!;
const Page = PAGES[root.dataset.page ?? 'landing'] ?? Landing;
render(<Page />, root);
