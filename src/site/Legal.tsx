// Terms and privacy for the beta. Plain-language drafts: have them reviewed before charging anyone.
import { href, Page } from './ui';

const UPDATED = '1 November 2026';

export function Terms() {
  return (
    <Page current="terms/">
      <section class="wrap legal">
        <article>
          <span class="eyebrow">Legal</span>
          <h1 style="font-size:var(--up-text-3xl)">Terms of use (beta)</h1>
          <p class="muted small">Last updated {UPDATED}. These terms cover the free beta of UrbanPlan.</p>
          <h2>What UrbanPlan is</h2>
          <p>UrbanPlan is a map editor and design tool. It shows cities from open data and published planning documents, and lets you draw changes to them. It is offered as a beta: features change, and parts of the map are known to be wrong.</p>
          <h2>Not advice, not a legal record</h2>
          <ul>
            <li>Nothing in UrbanPlan is engineering, legal, planning or financial advice.</li>
            <li>The Development Plan layer is traced from scanned sheets and lined up to within a few metres. It is a survey aid. It is not a DP remark, a zone certificate, a part plan or a legal boundary.</li>
            <li>Before you buy, sell, lend against, design or build anything, check with the planning authority and a licensed professional.</li>
          </ul>
          <h2>Your maps</h2>
          <p>Maps you make are yours. They are saved in your browser unless you publish or export them. When you publish a map, anyone with the link can open it and edit their own copy. Edits to OpenStreetMap-derived data remain under the Open Database License (ODbL).</p>
          <h2>Data and attribution</h2>
          <p>Roads and buildings © OpenStreetMap contributors, under the ODbL. Terrain from the Copernicus DEM GLO-30 © DLR/Airbus. Development Plan sheets © Pune Municipal Corporation. Keep these attributions on anything you share.</p>
          <h2>Fair use of the service</h2>
          <p>Don't try to break, overload or scrape the service, and don't use it to publish anything unlawful or anything that targets a private person.</p>
          <h2>Accounts</h2>
          <p>Keep your sign-in details to yourself. You can delete your account at any time by asking us; we may close accounts that break these terms.</p>
          <h2>No warranty</h2>
          <p>The beta is provided as is, without warranties. To the extent the law allows, we are not liable for losses from using it or relying on it.</p>
          <h2>Changes</h2>
          <p>We'll update these terms as UrbanPlan grows, and say so on this page. Paid plans will come with their own terms before anyone is charged.</p>
        </article>
      </section>
    </Page>
  );
}

export function Privacy() {
  return (
    <Page current="privacy/">
      <section class="wrap legal">
        <article>
          <span class="eyebrow">Legal</span>
          <h1 style="font-size:var(--up-text-3xl)">Privacy notice (beta)</h1>
          <p class="muted small">Last updated {UPDATED}.</p>
          <h2>Without an account</h2>
          <p>The editor runs in your browser. Your maps and settings are stored in your browser's local storage and never sent to us, unless you publish or export a map. Map tiles and imagery you switch on are loaded from their providers (for example OpenStreetMap or a satellite provider), who see your request.</p>
          <h2>With an account</h2>
          <ul>
            <li><b>What we keep:</b> your email address, your name, and optionally your organisation and role. If you sign in with Google, we receive your name and email from Google.</li>
            <li><b>Why:</b> to sign you in, to show your account, and to tell you about UrbanPlan features you signed up for.</li>
            <li><b>Where:</b> accounts are run on Supabase (our authentication and database provider).</li>
            <li><b>Not sold:</b> we don't sell your personal data.</li>
          </ul>
          <h2>Your choices</h2>
          <p>You can change your profile on <a href={href('account/')}>your account page</a>, and ask us to delete your account and its data at any time.</p>
          <h2>Changes</h2>
          <p>We'll update this notice as the service changes, and say so on this page.</p>
        </article>
      </section>
    </Page>
  );
}
