// /account/: the account now lives in the dashboard (profile, sign-in, plan, data). Old links land here and go on
// to the dashboard's settings; without JavaScript, a link does the same.
import { useEffect } from 'preact/hooks';
import { DASH, Loading, Page } from './ui';

export function Account() {
  useEffect(() => { location.replace(`${DASH}#settings/profile`); }, []);
  return (
    <Page current="account/">
      <section class="wrap account">
        <Loading label="Opening your dashboard…" />
        <p><a href={`${DASH}#settings/profile`}>Go to your account settings</a></p>
      </section>
    </Page>
  );
}
