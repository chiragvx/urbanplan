// The places that get a report page (/<city>/<slug>/): a centre, a radius and the roads to feature, by their
// OpenStreetMap names (checked against the bake: `node tools/dev/places-probe.mjs <city> <lat> <lon> [r]` lists
// the named roads round a point). `label` is the name people search for where OSM carries the official one.
// Roads not listed are added from the area's main roads, longest first, up to four.

export interface PlaceConfig {
  slug: string;
  name: string;
  lat: number; lon: number;
  /** radius of the report (m) */
  r: number;
  roads?: (string | { osm: string; label: string })[];
  /** other names the place goes by (in the page text, for search) */
  aka?: string[];
}

export const PUNE: PlaceConfig[] = [
  { slug: 'fc-road', name: 'FC Road', aka: ['Fergusson College Road'], lat: 18.5225, lon: 73.8412, r: 450, roads: [{ osm: 'Gopal Krushna Gokhale Path', label: 'FC Road' }, 'Apte Path'] },
  { slug: 'jm-road', name: 'JM Road', aka: ['Jangli Maharaj Road'], lat: 18.5215, lon: 73.8478, r: 450, roads: [{ osm: 'Jangli Maharaj Path', label: 'JM Road' }, 'Congress Bhavan Path'] },
  { slug: 'deccan', name: 'Deccan Gymkhana', aka: ['Deccan'], lat: 18.5160, lon: 73.8430, r: 400, roads: [{ osm: 'Jangli Maharaj Path', label: 'JM Road' }, { osm: 'Gopal Krushna Gokhale Path', label: 'FC Road' }, 'Deccan Gymkhana Road'] },
  { slug: 'karve-road', name: 'Karve Road', lat: 18.5045, lon: 73.8180, r: 450, roads: ['Karve Road'] },
  { slug: 'nal-stop', name: 'Nal Stop', lat: 18.5078, lon: 73.8300, r: 400, roads: ['Karve Road', 'Bharatratna Atal Bihari Vajpayee Flyover'] },
  { slug: 'kothrud', name: 'Kothrud', lat: 18.5075, lon: 73.8000, r: 500, roads: ['Paud Road'] },
  { slug: 'university-circle', name: 'University Circle', aka: ['SPPU Chowk', 'Ganeshkhind Road'], lat: 18.5420, lon: 73.8288, r: 500, roads: ['Ganeshkhind Road', { osm: 'Gopal Hari Deshmukh Marg', label: 'Baner Road' }, 'University Road', 'Senapati Bapat Marg'] },
  { slug: 'shivajinagar', name: 'Shivajinagar', lat: 18.5310, lon: 73.8470, r: 450, roads: ['Ganeshkhind Road', 'Bharatratna Atal Bihari Vajpayee Flyover', 'K. B. Joshi Path'] },
  { slug: 'swargate', name: 'Swargate', lat: 18.5018, lon: 73.8636, r: 450, roads: ['Jagannath Shankarsheth Marg', 'Late Keshavrao Jedhe Flyover'] },
  { slug: 'camp-mg-road', name: 'Camp (MG Road)', aka: ['Pune Camp', 'MG Road'], lat: 18.5155, lon: 73.8790, r: 450, roads: [{ osm: 'Mahatma Gandhi Marg', label: 'MG Road' }, 'East Street'] },
  { slug: 'pune-station', name: 'Pune Station', lat: 18.5289, lon: 73.8744, r: 450, roads: ['Raja Bahadur Mill Marg', 'His Highness The Prince Aga Khan Marg', 'Sassoon Marg'] },
  { slug: 'bund-garden-road', name: 'Bund Garden Road', lat: 18.5390, lon: 73.8830, r: 450, roads: ['Bund Garden Road', 'Koregaon Road', 'Mangaldas Road', 'Boat Club Road'] },
  { slug: 'koregaon-park', name: 'Koregaon Park', lat: 18.5362, lon: 73.8940, r: 500, roads: ['North Main Road', 'South Main Road'] },
  { slug: 'kalyani-nagar', name: 'Kalyani Nagar', lat: 18.5480, lon: 73.9020, r: 500, roads: ['Central Avenue', 'North Avenue', 'East Avenue'] },
  { slug: 'nagar-road', name: 'Nagar Road', aka: ['Pune–Ahmednagar Road'], lat: 18.5560, lon: 73.9070, r: 500, roads: ['Nagar Road', 'Airport New Road'] },
  { slug: 'viman-nagar', name: 'Viman Nagar', lat: 18.5679, lon: 73.9143, r: 550, roads: ['Viman Nagar Road'] },
  { slug: 'kharadi', name: 'Kharadi', lat: 18.5515, lon: 73.9420, r: 550, roads: ['Kharadi South Main Road'] },
  { slug: 'hadapsar', name: 'Hadapsar', lat: 18.5030, lon: 73.9260, r: 550, roads: ['Solapur Road', 'Magarpatta Road Flyover', 'Kharadi Bypass'] },
  { slug: 'baner-road', name: 'Baner Road', lat: 18.5590, lon: 73.7868, r: 550, roads: [{ osm: 'Gopal Hari Deshmukh Marg', label: 'Baner Road' }, 'Aundh-Baner Link Road'] },
  { slug: 'hinjewadi-phase-1', name: 'Hinjewadi Phase 1', aka: ['Rajiv Gandhi Infotech Park'], lat: 18.5913, lon: 73.7389, r: 650, roads: ['Hinjawadi Phase 1 road', 'Hinjawadi Road', 'Hinjawadi Phase 2 Road'] },
  { slug: 'wakad', name: 'Wakad', lat: 18.6000, lon: 73.7620, r: 550, roads: ['Datta Mandir Road', 'Shankar Kalate Nagar Road'] },
  { slug: 'chandni-chowk', name: 'Chandni Chowk', lat: 18.5106, lon: 73.7804, r: 500, roads: ['Katraj - Dehu Road Bypass', 'Pashan-Bavdhan Road'] },
  { slug: 'sinhagad-road', name: 'Sinhagad Road', lat: 18.4811, lon: 73.8268, r: 500, roads: ['Sinhagad Road', 'Sinhagad Road Flyover'] },
  { slug: 'katraj', name: 'Katraj', lat: 18.4482, lon: 73.8590, r: 500, roads: ['Satara Road', 'Katraj Kondhwa Road', 'Katraj Flyover', 'Katraj - Dehu Road Bypass'] },
  { slug: 'pimpri', name: 'Pimpri', lat: 18.6260, lon: 73.8050, r: 550, roads: ['Old Pune–Mumbai Highway', 'Pimpri Chowk Underpass', { osm: 'MIDC Road | Morawadi Road | Pimpri - Chikhali Road', label: 'Pimpri–Chikhali Road' }] },
  { slug: 'nigdi', name: 'Nigdi (Bhakti Shakti Chowk)', aka: ['Bhakti Shakti Chowk'], lat: 18.6642, lon: 73.7726, r: 500, roads: ['Jagadguru Sant Tukaram Maharaj and Chhatrapati Shivaji Maharaj Flyover', 'Bhakti Shakti Circle Eleveted Road', 'Akurdi Chikhali Marg'] },
];

export const MUMBAI: PlaceConfig[] = [
  { slug: 'bkc', name: 'Bandra Kurla Complex (BKC)', aka: ['BKC'], lat: 19.0650, lon: 72.8680, r: 650, roads: ['Bandra Kurla Complex Road', 'Avenue 3'] },
  { slug: 'andheri-west', name: 'Andheri West', lat: 19.1190, lon: 72.8440, r: 500, roads: [{ osm: 'Swami Vivekanand Road', label: 'S.V. Road' }, 'CD Barfiwala Road', 'Barfiwala Flyover'] },
  { slug: 'andheri-east', name: 'Andheri East', lat: 19.1150, lon: 72.8550, r: 500, roads: [{ osm: 'Mathuradas Vasanji Road', label: 'Andheri–Kurla Road' }, 'Andheri Flyover', 'N S Phadke Marg'] },
  { slug: 'dadar-tt', name: 'Dadar TT', aka: ['Dadar TT Circle'], lat: 19.0178, lon: 72.8478, r: 450, roads: ['Dr Babasaheb Ambedkar Marg (Vincent Road)', 'Dadar TT flyover', 'Tilak Road'] },
  { slug: 'marine-drive', name: 'Marine Drive', lat: 18.9440, lon: 72.8230, r: 650, roads: ['Marine Drive', 'Maharshi Karve Road', 'Mumbai Coastal Road'] },
  { slug: 'colaba', name: 'Colaba', aka: ['Colaba Causeway'], lat: 18.9200, lon: 72.8300, r: 500, roads: ['Nanabhai Moos Marg (Upper Colaba Road)', 'BEST Marg'] },
  { slug: 'lower-parel', name: 'Lower Parel', lat: 18.9945, lon: 72.8253, r: 500, roads: ['Senapati Bapat Marg', 'Senapati Flyover', 'Ganapatrao Kadam Marg'] },
  { slug: 'worli-naka', name: 'Worli Naka', lat: 19.0064, lon: 72.8182, r: 450, roads: ['Dr Annie Besant Road', 'Pandurang Budhkar Marg', 'Khan Abdul Gaffar Khan Marg'] },
  { slug: 'linking-road-bandra', name: 'Linking Road, Bandra', aka: ['Linking Road'], lat: 19.0650, lon: 72.8340, r: 500, roads: ['Linking Road'] },
  { slug: 'sv-road-santacruz', name: 'S.V. Road, Santacruz', aka: ['Swami Vivekanand Road'], lat: 19.0815, lon: 72.8390, r: 500, roads: [{ osm: 'Swami Vivekanand Road', label: 'S.V. Road' }] },
  { slug: 'juhu', name: 'Juhu', aka: ['Juhu Tara Road'], lat: 19.0898, lon: 72.8277, r: 550, roads: ['Juhu Tara Road'] },
  { slug: 'sion-circle', name: 'Sion Circle', lat: 19.0423, lon: 72.8636, r: 450, roads: ['Sion Flyover', 'Sion Circle'] },
  { slug: 'kurla', name: 'Kurla (LBS Marg)', aka: ['Kurla West'], lat: 19.0700, lon: 72.8765, r: 500, roads: [{ osm: 'Lal Bahadur Shastri Marg', label: 'LBS Marg' }] },
  { slug: 'chembur', name: 'Chembur', lat: 19.0620, lon: 72.8990, r: 500, roads: ['Chembur Flyover', 'Ramakrishna Chemburkar Marg'] },
  { slug: 'ghatkopar', name: 'Ghatkopar', lat: 19.0860, lon: 72.9080, r: 500, roads: [{ osm: 'Lal Bahadur Shastri Marg', label: 'LBS Marg' }, 'Mahatma Gandhi Road'] },
  { slug: 'lbs-marg-kanjurmarg', name: 'LBS Marg, Kanjurmarg', aka: ['LBS Marg', 'Lal Bahadur Shastri Marg'], lat: 19.1320, lon: 72.9300, r: 550, roads: [{ osm: 'Lal Bahadur Shastri Marg', label: 'LBS Marg' }] },
  { slug: 'powai', name: 'Powai', aka: ['Hiranandani Gardens'], lat: 19.1176, lon: 72.9060, r: 600, roads: ['Adi Sankaracharya Marg', { osm: 'Jogeshwari-Vikhroli Link Road', label: 'JVLR' }, 'Orchard Avenue'] },
  { slug: 'jvlr-jogeshwari', name: 'JVLR, Jogeshwari', aka: ['Jogeshwari–Vikhroli Link Road'], lat: 19.1391, lon: 72.8655, r: 550, roads: [{ osm: 'Jogeshwari Vikhroli Link Road', label: 'JVLR' }, 'Sant Gadge Maharaj Marg'] },
  { slug: 'goregaon', name: 'Goregaon West', aka: ['Goregaon'], lat: 19.1646, lon: 72.8493, r: 500, roads: [{ osm: 'Swami Vivekanand Road', label: 'S.V. Road' }, 'Aarey Road', 'Station Road'] },
  { slug: 'weh-kandivali', name: 'Western Express Highway, Kandivali', aka: ['WEH', 'Western Express Highway'], lat: 19.2033, lon: 72.8630, r: 550, roads: ['Western Express Highway', 'Mahindra Flyover', 'Akurli Road'] },
  { slug: 'borivali', name: 'Borivali West', aka: ['Borivali'], lat: 19.2290, lon: 72.8570, r: 500, roads: [{ osm: 'Swami Vivekanand Road', label: 'S.V. Road' }, 'Kasturba Gandhi Road'] },
];
