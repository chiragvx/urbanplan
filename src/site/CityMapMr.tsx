// The Marathi pages (lang="mr"): /mr/pune/map/ and /mr/pune/dp-map/, the same facts as /pune/map/ and /pune/dp-map/
// in plain Marathi. Every number comes from the same bake and is written with the same (Latin) digits as the English
// pages. NATIVE REVIEW NEEDED: this Marathi was drafted without a native speaker's review; have it read by one before
// relying on it (the page's <head> carries the same note as an HTML comment, see routes.ts `reviewNote`).
import { CITY_LABEL, PLACES } from './places/data';
import { Crumbs, MAPS, PlaceGroups } from './CityMap';
import { href, Icon, Page, proStart } from './ui';
import { SITE_NAME } from './brand';
import './place.css';

const n = (v: number) => v.toLocaleString('en-IN');
const km = (v: number) => `${n(Math.round(v))} किमी`;
const date = (d: string) => new Date(d).toLocaleDateString('mr-IN-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const GROUP_MR: Record<string, string> = {
  'Central Pune': 'मध्य पुणे', 'West Pune': 'पश्चिम पुणे', 'East Pune': 'पूर्व पुणे', 'South Pune': 'दक्षिण पुणे',
  'Pimpri-Chinchwad and Hinjewadi': 'पिंपरी-चिंचवड आणि हिंजवडी', Elsewhere: 'इतर',
};

function Rows({ rows }: { rows: [string, string][] }) {
  return <dl class="calc-rows place-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

const Sources = () => (
  <aside class="calc place-prov" aria-label="ही माहिती कुठून आली">
    <h2>ही माहिती कुठून आली</h2>
    <ul class="small">
      <li>रस्ते आणि इमारतींच्या रेषा: © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap योगदानकर्ते</a> (ODbL), {SITE_NAME} च्या पुणे नकाशात {date(MAPS.pune.baked)} रोजी घेतलेल्या. सगळ्या इमारती नकाशावर नाहीत.</li>
      <li>रस्त्यांची रुंदी आणि लेन ही {SITE_NAME} ने या माहितीवरून (लेनची संख्या, रस्त्याचा प्रकार) तयार केलेली प्रतिकृती आहे, प्रत्यक्ष मोजणी नाही.</li>
      <li>विकास आराखडा: पुणे महानगरपालिकेचे मंजूर DP नकाशे, स्कॅन करून नकाशावर सुमारे 2–3 मीटर अचूकतेने बसवलेले, आणि काही भागात {SITE_NAME} ने रेखांकित केलेले.</li>
      <li>जमिनीची उंची: Copernicus DEM GLO-30 © DLR / Airbus.</li>
      <li><b>हे सर्वेक्षणासाठी मदत करणारे साधन आहे; अधिकृत DP अभिप्राय (DP remark), झोन दाखला किंवा अभियांत्रिकी सल्ला नाही.</b> रस्त्याची किंवा भूखंडाची कायदेशीर स्थिती पुणे महानगरपालिकेकडून जाणून घ्या.</li>
    </ul>
  </aside>
);

// ---------------- /mr/pune/map/ ----------------

export function MapPageMr() {
  const M = MAPS.pune;
  const places = PLACES.filter((p) => p.city === 'pune').length;
  return (
    <Page chrome="en">
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['मुख्यपृष्ठ', ''], ['पुणे', 'pune/'], ['पुण्याचा 3D नकाशा', null]]} />
          <h1>पुण्याचा 3D नकाशा: रस्ते, इमारती आणि जमीन</h1>
          <p class="answer">
            {SITE_NAME} चा पुणे आणि पिंपरी-चिंचवडचा नकाशा <b>{n(M.km2)} चौ. किमी</b> क्षेत्र व्यापतो: <b>{n(M.counts.roads)} रस्ते</b> ({n(M.counts.sections)} भाग),
            एकूण <b>{km(M.roadKm)}</b> लांबी (त्यापैकी {km(M.mainKm)} मुख्य रस्ते, {km(M.deckKm)} उड्डाणपूल आणि पुलांवर), <b>{n(M.counts.buildings)} इमारती</b> आणि
            जमिनीचा उंच-सखलपणा, 2D आणि 3D मध्ये. ठिकाणांची पाने, रस्ता रुंदी नकाशा आणि DP पाने याच नकाशावरून तयार केली आहेत.
          </p>
          <p class="small muted"><a href={href('pune/map/')} hrefLang="en" lang="en">Read this page in English: Pune 3D map</a></p>
          <div class="place-grid">
            <figure class="place-map city-map">
              <img src={href(M.svg.map)} width={M.svg.w} height={M.svg.h} fetchpriority="high" alt={`पुण्याच्या मुख्य रस्त्यांचा नकाशा: महामार्ग आणि प्रमुख रस्ते नारिंगी रंगात, आणि स्वतंत्र पान असलेली ${places} ठिकाणे`} />
              <figcaption class="legend place-legend">
                <span><i class="legend-swatch" style="background:#ff6a2b" /> महामार्ग आणि प्रमुख रस्ते</span>
                <span><i class="legend-swatch" style="background:#9e958a" /> उप-प्रमुख आणि जोड रस्ते</span>
                <span><i class="legend-swatch round" style="background:#1d1a17" /> ठिकाणांची पाने</span>
              </figcaption>
            </figure>
            <aside class="place-side">
              <Rows rows={[
                ['क्षेत्र', `${n(M.km2)} चौ. किमी`],
                ['रस्ते', n(M.counts.roads)],
                ['रस्त्यांचे भाग', n(M.counts.sections)],
                ['रस्त्यांची एकूण लांबी', km(M.roadKm)],
                ['… मुख्य रस्ते', km(M.mainKm)],
                ['… उड्डाणपूल आणि पुलांवर', km(M.deckKm)],
                ['इमारती', n(M.counts.buildings)],
                ['विकास आराखडा', `जुनी PMC हद्द, ${M.dp!.sheets} नकाशे`],
                ['नकाशा तयार केला', date(M.baked)],
              ]} />
              <a class="btn btn-primary btn-lg btn-block" href={proStart('blank', 'pune')}>पुण्यातील भूखंडाचा हिशोब करा <Icon.arrow /></a>
              <p class="cta-note">{SITE_NAME} Pro मध्ये: UDCPR नुसार FSI, मार्जिन आणि उंची. सुरुवात मोफत.</p>
            </aside>
          </div>

          <h2>नकाशावर काय आहे</h2>
          <ul>
            <li><b>नकाशावरील प्रत्येक रस्ता</b>, त्याच्या रुंदीनुसार, लेन आणि पदपथांसह; उड्डाणपूल आणि पूल त्यांच्या उंचीवर, भुयारी मार्ग जमिनीखाली.</li>
            <li><b>नकाशावरील प्रत्येक इमारत</b> 3D मध्ये, OpenStreetMap वरील रेषांवरून, उंची माहीत असेल तिथे त्या उंचीसह.</li>
            <li><b>जमीन</b>: टेकड्या, नदीकाठ आणि उतार, Copernicus च्या 30 मीटर उंची-नकाशावरून.</li>
            <li><b>विकास आराखडा</b> जुन्या PMC हद्दीसाठी: मंजूर DP नकाशे नकाशावर थर म्हणून, आणि पूर्व-मध्य पुण्याच्या काही भागात DP रस्ता रुंदी रेखांकित (पाहा <a href={href('mr/pune/dp-map/')}>पुणे विकास आराखडा नकाशा</a>).</li>
          </ul>

          <h2>या नकाशाचा उपयोग</h2>
          <ul>
            <li><b>ठिकाण पाहा</b>: खालील प्रत्येक ठिकाणाचे स्वतंत्र पान आहे: तिथले रस्ते आणि त्यांची रुंदी, चौक आणि इमारती.</li>
            <li><b>भूखंडाचा DP तपासा</b>: <a href={href('pune/dp-report/')}>पुणे DP अहवाल</a> कोणत्याही भूखंडावरचा झोन, आरक्षणे आणि DP रस्ते दाखवतो, मोफत.</li>
            <li><b>FSI पटकन काढा</b>: <a href={href('pune/fsi-calculator/')}>पुणे FSI कॅल्क्युलेटर</a> (इंग्रजीत) ला फक्त भूखंडाचे क्षेत्रफळ आणि रस्त्याची रुंदी लागते.</li>
            <li><b>भूखंडाचा पूर्ण हिशोब</b>: <a href={proStart('blank', 'pune')}>{SITE_NAME} Pro</a> भूखंड आणि समोरचा रस्ता घेऊन FSI, मार्जिन, उंची आणि त्यात बसणाऱ्या इमारती काढतो.</li>
          </ul>

          <div class="cta-panel place-cta">
            <h2>पुण्यातील भूखंडाचे नियोजन करा</h2>
            <p>भूखंडाचा आकार आणि समोरच्या रस्त्याची रुंदी द्या. नियम किती बांधकाम देतात ते Pro काढतो, आणि इमारती व पार्किंग मांडतो.</p>
            <div class="cta-row">
              <a class="btn btn-primary btn-lg" href={proStart('blank', 'pune')}>भूखंडाचा हिशोब करा <Icon.arrow /></a>
              <a class="btn btn-lg" href={href('pune/dp-report/')}>भूखंडाचा DP तपासा</a>
            </div>
          </div>

          <h2>नकाशावरील ठिकाणे</h2>
          <p>प्रत्येक ठिकाणाचे स्वतंत्र पान आहे (इंग्रजीत): रस्ते आणि त्यांची रुंदी, चौक, इमारती आणि DP रेखांकित असेल तिथे DP रुंदी.</p>
          <PlaceGroups city="pune" names={GROUP_MR} note={(p) => `${p.data.area.roadKm} किमी रस्ते`} />

          <h2>पुण्याचे आणखी नकाशे</h2>
          <ul>
            <li><a href={href('mr/pune/dp-map/')}>पुणे विकास आराखडा नकाशा (DP map)</a>: कोणत्या भागांचे DP नकाशे आहेत आणि DP रस्ता रुंदी कुठे रेखांकित आहे.</li>
            <li lang="en"><a href={href('pune/road-width-map/')} hrefLang="en">Pune road width map</a> (English)</li>
            <li lang="en"><a href={href('data/')} hrefLang="en">Open data: Pune's main roads as GeoJSON</a> (English)</li>
          </ul>
          <Sources />
        </article>
      </section>
    </Page>
  );
}

// ---------------- /mr/pune/dp-map/ ----------------

export const DP_FAQ_MR: [string, string][] = [
  [`${SITE_NAME} मधील पुणे DP नकाशा अधिकृत आहे का?`, `नाही. हे पुणे महानगरपालिकेचे मंजूर DP नकाशे आहेत, स्कॅन करून आजच्या नकाशावर सुमारे 2–3 मीटर अचूकतेने बसवलेले: एखादी रस्ता-रेषा किंवा आरक्षण भूखंडाजवळ आहे का हे पाहण्यासाठी पुरेसे, मोजमापासाठी नाही. अधिकृत उत्तर म्हणजे PMC कडून मिळणारा DP अभिप्राय किंवा झोन दाखला.`],
  ['पिंपरी-चिंचवड, हिंजवडी किंवा समाविष्ट गावांचा DP यात आहे का?', `नाही. ${SITE_NAME} मधील DP नकाशे जुन्या PMC हद्दीचे आहेत. पिंपरी-चिंचवड (PCMC), हिंजवडी आणि नंतर PMC मध्ये समाविष्ट झालेल्या गावांचे DP नकाशे ${SITE_NAME} मध्ये नाहीत.`],
  ['DP रस्ता रुंदी कुठे रेखांकित आहे?', `फक्त पूर्व-मध्य पुण्याच्या काही भागात: बंड गार्डन रोड, कोरेगाव पार्क, कल्याणी नगर, नगर रोड आणि पुणे स्टेशन परिसर. इतरत्र DP नकाशा फक्त पाहण्यासाठी आहे, आणि ${SITE_NAME} मधील रुंदी आजच्या रस्त्यांची आहे.`],
  ['माझ्या भूखंडावर DP कसा पाहायचा?', 'पुणे DP अहवाल उघडा, भाग शोधा आणि भूखंडावर क्लिक करा: उपग्रह छायाचित्रावर झोन, आरक्षण आणि जवळचे DP रस्ते दिसतात. DP रस्ता भूखंडातून किती जागा घेतो हे पाहण्यासाठी भूखंडाचा हिशोब Pro मध्ये करा.'],
];

export function DpMapPageMr() {
  const M = MAPS.pune, D = M.dp!;
  const pune = PLACES.filter((p) => p.city === 'pune');
  const traced = pune.filter((p) => p.data.dp === 'traced'), sheets = pune.filter((p) => p.data.dp === 'sheets'), none = pune.filter((p) => p.data.dp === 'none');
  const link = (p: (typeof pune)[number]) => <a href={href(`pune/${p.slug}/`)} lang="en">{p.name}</a>;
  return (
    <Page chrome="en">
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['मुख्यपृष्ठ', ''], ['पुणे', 'pune/'], ['पुणे विकास आराखडा नकाशा', null]]} />
          <h1>पुणे विकास आराखडा नकाशा (DP map) ऑनलाइन</h1>
          <p class="answer">
            {SITE_NAME} पुणे महानगरपालिकेच्या मंजूर विकास आराखड्याचे (DP) <b>{D.sheets} नकाशे</b> आजच्या नकाशावर सुमारे 2–3 मीटर अचूकतेने बसवून दाखवते.
            ते जुन्या PMC हद्दीतील सुमारे <b>{n(Math.round(D.km2))} चौ. किमी</b> क्षेत्र व्यापतात. DP मधील रस्त्यांची रुंदी <b>फक्त पूर्व-मध्य पुण्याच्या काही भागात, {km(D.tracedKm)} रस्त्यांसाठी</b> रेखांकित केली आहे.
            पिंपरी-चिंचवड, हिंजवडी आणि नंतर समाविष्ट झालेल्या गावांचे DP नकाशे {SITE_NAME} मध्ये नाहीत.
          </p>
          <p class="small muted"><a href={href('pune/dp-map/')} hrefLang="en" lang="en">Read this page in English: Pune DP map</a></p>
          <div class="place-grid">
            <figure class="place-map city-map">
              <img src={href(M.svg.dp!)} width={M.svg.w} height={M.svg.h} fetchpriority="high" alt={`पुण्याचा नकाशा: ${D.sheets} DP नकाशे व्यापत असलेले जुन्या शहराचे क्षेत्र निळ्या छटेत, DP रुंदी रेखांकित असलेले ${km(D.tracedKm)} रस्ते लाल रंगात, आणि DP नकाशांच्या बाहेरील पिंपरी-चिंचवड व हिंजवडी`} />
              <figcaption class="legend place-legend">
                <span><i class="legend-swatch" style="background:rgba(79,124,201,.3)" /> {SITE_NAME} मधील DP नकाशे</span>
                <span><i class="legend-swatch" style="background:#c0262d" /> DP रस्ता रुंदी रेखांकित</span>
                <span><i class="legend-swatch round" style="background:#c0262d" /> ठिकाण: रुंदी रेखांकित</span>
                <span><i class="legend-swatch round" style="background:#2f5fb3" /> ठिकाण: फक्त DP नकाशा</span>
                <span><i class="legend-swatch round" style="background:#8a8178" /> ठिकाण: DP नकाशा नाही</span>
              </figcaption>
            </figure>
            <aside class="place-side">
              <Rows rows={[
                ['DP नकाशे (शीट)', `${D.sheets} (${D.sheetNames[0]} ते ${D.sheetNames[D.sheetNames.length - 1]})`],
                ['व्यापलेले क्षेत्र', `${n(Math.round(D.km2))} चौ. किमी`],
                ['नकाशावर बसवण्याची अचूकता', 'सुमारे 2–3 मीटर'],
                ['DP रस्ता रुंदी रेखांकित', km(D.tracedKm)],
                ['… नाव असलेले रस्ते', n(D.tracedRoads)],
                ['PCMC, हिंजवडी, समाविष्ट गावे', 'DP नकाशे नाहीत'],
                ['नकाशा तयार केला', date(M.baked)],
              ]} />
              <a class="btn btn-primary btn-lg btn-block" href={href('pune/dp-report/')}>भूखंडाचा DP तपासा <Icon.arrow /></a>
              <p class="cta-note">कोणत्याही भूखंडावरचा झोन, आरक्षणे आणि DP रस्ते, मोफत.</p>
            </aside>
          </div>

          <h2>कोणत्या भागांचा DP आहे</h2>
          <p>स्वतंत्र पान असलेल्या पुण्यातील {pune.length} ठिकाणांपैकी:</p>
          <div class="dp-status">
            <section>
              <h3><i class="legend-swatch round" style="background:#c0262d" /> DP रस्ता रुंदी रेखांकित ({traced.length})</h3>
              <ul>{traced.map((p) => <li key={p.slug}>{link(p)} <span class="muted small">· {p.data.dpKm} किमी रेखांकित</span></li>)}</ul>
              <p class="small muted">या पानांवर आजची रुंदी आणि DP रुंदी रस्त्यानुसार शेजारी दिली आहे.</p>
            </section>
            <section>
              <h3><i class="legend-swatch round" style="background:#2f5fb3" /> DP नकाशा आहे, रुंदी रेखांकित नाही ({sheets.length})</h3>
              <ul>{sheets.map((p) => <li key={p.slug}>{link(p)}</li>)}</ul>
              <p class="small muted">DP नकाशे हा भाग व्यापतात, पण पानांवर DP रुंदी नाही.</p>
            </section>
            <section>
              <h3><i class="legend-swatch round" style="background:#8a8178" /> {SITE_NAME} मध्ये DP नकाशा नाही ({none.length})</h3>
              <ul>{none.map((p) => <li key={p.slug}>{link(p)}</li>)}</ul>
              <p class="small muted">जुन्या PMC हद्दीबाहेर (किंवा हद्दीच्या कडेला): यांच्यासाठी PCMC, PMRDA किंवा PMC कडे विचारा.</p>
            </section>
          </div>

          <h2>रेखांकित DP रस्ता रुंदी</h2>
          <p>जिथे रुंदी रेखांकित आहे, तिथे नकाशातील प्रत्येक रस्त्याला DP ने दिलेली रुंदी आहे, आजच्या मध्यरेषेच्या दोन्ही बाजूंना काढलेली (DP ची स्वतःची रेषा एका बाजूला सरकलेली असू शकते). लांबीनुसार रेखांकित रुंदी:</p>
          <div class="table-wrap">
            <table class="rules">
              <caption>पूर्व-मध्य पुण्यात {SITE_NAME} ने रेखांकित केलेली DP रस्ता रुंदी (किमान 0.5 किमी रस्ता असलेल्या रुंदी)</caption>
              <thead><tr><th>DP रुंदी</th><th class="n">रस्त्याची लांबी</th></tr></thead>
              <tbody>{D.widths.map((w) => <tr key={w.w}><td>{w.w} मीटर</td><td class="n">{w.km} किमी</td></tr>)}</tbody>
            </table>
          </div>

          <h2>तुमच्या भूखंडावर DP कसा तपासायचा</h2>
          <ol>
            <li><a href={href('pune/dp-report/')}>पुणे DP अहवाल</a> उघडा आणि तुमचा रस्ता किंवा भाग शोधा.</li>
            <li>भूखंडावर क्लिक करा: अहवालात त्याचा झोन, त्यावरचे आरक्षण आणि जवळचे DP रस्ते दिसतात.</li>
            <li>DP रस्ता भूखंडातून घेणारी पट्टी आणि DP रुंदी किंवा आजच्या रुंदीनुसार FSI पाहण्यासाठी, <a href={proStart('survey', 'pune')}>सर्व्हे क्रमांकावरून भूखंड Pro मध्ये शोधा</a>.</li>
          </ol>

          <h2>DP नकाशा काय सांगतो, आणि काय नाही</h2>
          <div class="two-col">
            <section>
              <h3>तो दाखवतो</h3>
              <ul>
                <li>भागाचा <b>झोन</b>: निवासी, व्यापारी, औद्योगिक, हरित इत्यादी.</li>
                <li><b>आरक्षणे</b>: शाळा, उद्याने, मंडई, रुग्णालये यांसाठी राखून ठेवलेली जागा, प्रत्येकी एका संकेतांकासह.</li>
                <li><b>नियोजित रस्ते</b>: नवीन रस्ते, आणि सध्याचे रस्ते किती रुंद करायचे आहेत.</li>
              </ul>
            </section>
            <section>
              <h3>तो दाखवत नाही</h3>
              <ul>
                <li><b>भूखंडाच्या हद्दी</b> किंवा सर्व्हे / सीटीएस क्रमांक: DP हा आराखडा आहे, जमिनीचा अभिलेख नाही.</li>
                <li>आराखडा मंजूर झाल्यानंतरचे <b>बदल</b> (फेरबदल, नगररचना योजना), किंवा रस्त्याची जागा संपादित झाली आहे का.</li>
                <li><b>DP अभिप्राय किंवा झोन दाखल्याची</b> जागा: {SITE_NAME} मध्ये तो काही मीटरपर्यंत अचूक बसवलेला आहे, मोजणी केलेला नाही.</li>
              </ul>
            </section>
          </div>
          <p lang="en">More in the guides (English): <a href={href('guides/what-is-development-plan/')}>what a Development Plan is</a>, <a href={href('guides/dp-road-affects-property/')}>whether a DP road affects your property</a>, <a href={href('guides/dp-road-widening/')}>DP road widening</a>.</p>

          <div class="notice info" role="note">
            <Icon.info />
            <div style="display:grid;gap:6px">
              <p><b>{SITE_NAME} हे सर्वेक्षणासाठी मदत करणारे साधन आहे; अधिकृत DP अभिप्राय किंवा झोन दाखला नाही.</b> DP नकाशे {SITE_NAME} ने स्कॅन करून बसवले आहेत; रेखांकित रुंदी हे {SITE_NAME} ने त्यांचे केलेले वाचन आहे.</p>
              <p>अधिकृत स्रोत <a href="https://www.pmc.gov.in/" rel="noopener">पुणे महानगरपालिका</a> आहे: सर्व्हे किंवा सीटीएस क्रमांकासाठी DP अभिप्राय किंवा झोन दाखला मागा, आणि खरेदी, विक्री किंवा बांधकामापूर्वी परवानाधारक वास्तुविशारदाचा सल्ला घ्या.</p>
            </div>
          </div>

          <h2>प्रश्न</h2>
          <div class="faq">{DP_FAQ_MR.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>

          <div class="cta-panel place-cta">
            <h2>पुण्याच्या DP नुसार भूखंडाचे नियोजन करा</h2>
            <p>DP अहवालात भूखंडाचा झोन आणि आरक्षणे तपासा, मग Pro मध्ये हिशोब करा: DP रस्ता घेणारी पट्टी, त्याच्या रुंदीनुसार FSI, आणि त्यात बसणाऱ्या इमारती.</p>
            <div class="cta-row">
              <a class="btn btn-primary btn-lg" href={href('pune/dp-report/')}>भूखंडाचा DP तपासा <Icon.arrow /></a>
              <a class="btn btn-lg" href={proStart('survey', 'pune')}>सर्व्हे क्रमांकावरून भूखंड शोधा</a>
            </div>
          </div>
          <p>संपूर्ण शहर: <a href={href('mr/pune/map/')}>पुण्याचा 3D नकाशा</a>.</p>
          <Sources />
        </article>
      </section>
    </Page>
  );
}
