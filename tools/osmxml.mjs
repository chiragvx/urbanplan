// Minimal, fast OSM XML parser (Overpass output). Returns maps of nodes, ways, relations.
const attr = (s, name) => {
  const m = s.match(new RegExp(String.raw`\s${name}="([^"]*)"`));
  return m ? m[1] : undefined;
};
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function tagsOf(body) {
  const t = {};
  const re = /<tag k="([^"]*)" v="([^"]*)"\s*\/>/g;
  let m;
  while ((m = re.exec(body))) t[unescape(m[1])] = unescape(m[2]);
  return t;
}

export function parseOsmXml(xml) {
  const nodes = new Map(), ways = new Map(), relations = new Map();
  const re = /<(node|way|relation)\s([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, type, head, , body = ''] = m;
    const id = Number(attr(' ' + head, 'id'));
    if (type === 'node') {
      nodes.set(id, { id, lat: Number(attr(' ' + head, 'lat')), lon: Number(attr(' ' + head, 'lon')), tags: body ? tagsOf(body) : {} });
    } else if (type === 'way') {
      const nds = [];
      const r2 = /<nd ref="(\d+)"/g;
      let n;
      while ((n = r2.exec(body))) nds.push(Number(n[1]));
      ways.set(id, { id, nds, tags: tagsOf(body) });
    } else {
      const members = [];
      const r3 = /<member type="(\w+)" ref="(\d+)" role="([^"]*)"/g;
      let n;
      while ((n = r3.exec(body))) members.push({ type: n[1], ref: Number(n[2]), role: n[3] });
      relations.set(id, { id, members, tags: tagsOf(body) });
    }
  }
  return { nodes, ways, relations };
}

/** Assemble multipolygon rings from member ways (joins open ways end-to-end). Returns { outer: [[ids]], inner: [[ids]] }. */
export function assembleMultipolygon(rel, ways) {
  const build = (role) => {
    const segs = rel.members.filter((m) => m.type === 'way' && (m.role || 'outer') === role).map((m) => ways.get(m.ref)?.nds).filter(Boolean).map((a) => [...a]);
    const rings = [];
    while (segs.length) {
      let ring = segs.shift();
      let guard = 0;
      while (ring[0] !== ring[ring.length - 1] && guard++ < 1000) {
        const end = ring[ring.length - 1];
        const k = segs.findIndex((s) => s[0] === end || s[s.length - 1] === end);
        if (k < 0) break;
        const s = segs.splice(k, 1)[0];
        ring = ring.concat(s[0] === end ? s.slice(1) : s.reverse().slice(1));
      }
      if (ring.length >= 4 && ring[0] === ring[ring.length - 1]) rings.push(ring);
    }
    return rings;
  };
  return { outer: build('outer'), inner: build('inner') };
}
