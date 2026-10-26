/* ============================================================
   Fetches a public terms / privacy page and returns its readable text,
   so the user can paste a link instead of the whole policy.
   Only public http(s) addresses: hosts that resolve to private or local
   networks are refused, and every redirect is checked again.
   ============================================================ */

const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 120000;
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

function isPrivateIp(ip){
  if(net.isIPv4(ip)){
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if(v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function checkUrl(raw){
  let url;
  try{ url = new URL(raw); }catch(e){ throw new Error('That doesn\'t look like a valid link.'); }
  if(url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https links are supported.');
  if(url.username || url.password) throw new Error('Links with credentials are not supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if(host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Only public websites are supported.');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if(!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('Only public websites are supported.');
  return url;
}

const ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', rsquo:'’', lsquo:'‘', rdquo:'”', ldquo:'“', mdash:'—', ndash:'–', hellip:'…', eacute:'é', egrave:'è', agrave:'à', ccedil:'ç' };

function htmlToText(html){
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const main = body.match(/<(main|article)\b[\s\S]*<\/\1>/i);
  if(main && main[0].length > 2000) body = main[0];
  const decode = s => s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
  const text = decode(body
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: decode(title).replace(/\s+/g, ' ').trim(), text };
}

async function readCapped(res){
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for(;;){
    const { done, value } = await reader.read();
    if(done) break;
    size += value.length;
    if(size > MAX_BYTES){ reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

exports.handler = async function(event){
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try{ body = JSON.parse(event.body || '{}'); }catch(e){ return json(400, { error: 'Bad JSON' }); }
  if(typeof body.url !== 'string' || body.url.length > 2000) return json(400, { error: 'Missing link.' });

  try{
    let url = await checkUrl(body.url.trim());
    let res;
    for(let hop = 0; ; hop++){
      res = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'CLAUSE policy reader (+https://kamilziane.netlify.app/)', 'Accept': 'text/html,text/plain' },
        signal: AbortSignal.timeout(6000)
      });
      if(res.status < 300 || res.status >= 400) break;
      const next = res.headers.get('location');
      if(!next || hop >= 3) throw new Error('Too many redirects.');
      url = await checkUrl(new URL(next, url).href);
    }
    if(!res.ok) return json(422, { error: `The site answered ${res.status}. Copy and paste the text instead.` });
    const type = res.headers.get('content-type') || '';
    if(!/text\/(html|plain)|application\/xhtml/i.test(type)) return json(422, { error: 'That link isn\'t a web page (PDFs aren\'t supported yet). Copy and paste the text instead.' });

    const raw = await readCapped(res);
    const { title, text } = /text\/plain/i.test(type) ? { title: '', text: raw.trim() } : htmlToText(raw);
    if(text.length < 600) return json(422, { error: 'Couldn\'t find a policy on that page (some sites load their text with JavaScript). Open it, select all, and paste it instead.' });
    return json(200, { title, text: text.slice(0, MAX_TEXT), url: url.href, truncated: text.length > MAX_TEXT });
  }catch(e){
    const msg = e.name === 'TimeoutError' ? 'The site took too long to answer.' : (e.message || 'Couldn\'t read that page.');
    return json(422, { error: msg.length > 160 ? 'Couldn\'t read that page. Copy and paste the text instead.' : msg });
  }
};
