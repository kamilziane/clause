/* =========================================================================
   CLAUSE — App shell (rendering + interaction)
   Depends on js/rules.js and js/samples.js being loaded first.
========================================================================= */

const API = '/.netlify/functions/';
const R = window.ClauseRules;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  text: '',
  title: '',
  local: null,
  ai: null,
  aiStatus: 'idle',     // idle | loading | done | error | off
  aiError: '',
  view: 'ai',           // which result set is shown when both exist: ai | local
  live: null,           // is the AI backend configured?
  chat: [],
  chatBusy: false,
  showAllGood: false,
};

const VERDICTS = {
  fine:         { label:'Fine to accept',        cls:'fine-v', icon:'<path d="M20 6 9 17l-5-5"/>' },
  careful_read: { label:'Read before accepting', cls:'read-v', icon:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  be_careful:   { label:'Be careful',            cls:'care-v', icon:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>' },
};
const SEV_ICON = {
  high:   '<svg viewBox="0 0 24 24" class="ic"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
  medium: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
  low:    '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
  good:   '<svg viewBox="0 0 24 24" class="ic"><path d="M20 6 9 17l-5-5"/></svg>',
};
const DOC_TYPES = { terms:'Terms & conditions', privacy:'Privacy policy', both:'Terms + privacy', other:'Unclear document', not_a_policy:'Not a policy' };

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m])); }
function words(t){ return (t.match(/\S+/g) || []).length; }

/* ---------------------------- Backend status ---------------------------- */
async function checkEngine(){
  const pill = $('#enginePill');
  try{
    const res = await fetch(API + 'analyze', { signal: AbortSignal.timeout(6000) });
    state.live = res.ok && (await res.json()).live === true;
  }catch(e){ state.live = false; }
  pill.className = 'pill ' + (state.live ? 'live' : 'local');
  pill.querySelector('span').textContent = state.live ? 'AI LIVE' : 'LOCAL MODE';
  pill.title = state.live ? 'Rule engine + Gemini explanations' : 'AI backend not reachable: rule engine only';
  if(!state.live){
    $('#useAi').checked = false;
    $('#useAi').disabled = true;
    $('.switch').title = 'AI is offline: using the local rule engine';
    $('.switch').style.opacity = .5;
  }
  updatePrivacyNote();
}

function updatePrivacyNote(){
  const ai = $('#useAi').checked && state.live !== false;
  $('#privacyNote').textContent = ai
    ? 'Local rules run in your browser. With AI on, the text is sent to Google Gemini to be explained; CLAUSE stores nothing. Not legal advice.'
    : 'Local mode: the text never leaves your browser. Not legal advice.';
}

/* ---------------------------- Input ---------------------------- */
function setText(t, title){
  state.text = t;
  state.title = title || '';
  $('#docText').value = t;
  onTextChange();
}
function onTextChange(){
  state.text = $('#docText').value;
  const n = words(state.text);
  $('#charCount').textContent = n.toLocaleString() + ' word' + (n === 1 ? '' : 's');
  $('#analyzeBtn').disabled = state.text.trim().length < 40;
  $('#step1').classList.toggle('done', n > 0);
}
function switchInput(mode){
  $$('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.input === mode));
  $$('.in-pane').forEach(p => p.hidden = p.id !== 'in-' + mode);
}

async function fetchLink(e){
  e.preventDefault();
  const url = $('#docUrl').value.trim();
  if(!url) return;
  const btn = $('#linkForm button');
  btn.disabled = true; btn.textContent = 'Fetching…';
  $('#in-link .hint').textContent = 'Reading the page…';
  try{
    const res = await fetch(API + 'fetch-policy', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ url }) });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || 'Couldn\'t read that page.');
    setText(data.text, data.title || new URL(data.url).hostname);
    $('#in-link .hint').textContent = `Loaded ${words(data.text).toLocaleString()} words from ${new URL(data.url).hostname}.`;
    switchInput('paste');
    analyze();
  }catch(err){
    const offline = err instanceof TypeError || /JSON/.test(err.message);
    $('#in-link .hint').textContent = offline ? 'Link reading needs the online version of CLAUSE. Copy and paste the text instead.' : err.message;
  }finally{
    btn.disabled = false; btn.textContent = 'Fetch';
  }
}

function readFile(file){
  if(!file) return;
  if(file.size > 3_000_000){ alert('That file is too big (3 MB max).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    let t = String(reader.result || '');
    if(/\.html?$/i.test(file.name) || /<html|<body|<p[\s>]/i.test(t.slice(0, 2000))){
      const doc = new DOMParser().parseFromString(t, 'text/html');
      doc.querySelectorAll('script,style,noscript,nav,footer,header').forEach(n => n.remove());
      doc.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr,section').forEach(n => n.append('\n'));
      t = (doc.body?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
    }
    setText(t, file.name.replace(/\.[^.]+$/, ''));
    switchInput('paste');
  };
  reader.readAsText(file);
}

/* ---------------------------- Analyze ---------------------------- */
async function analyze(){
  const text = state.text.trim();
  if(text.length < 40) return;
  const btn = $('#analyzeBtn');
  btn.disabled = true;
  $('.scan').hidden = false;
  $('#step2').classList.add('done');

  // the rule engine is instant, the short pause just lets the scan read as a scan
  await new Promise(r => setTimeout(r, 450));
  state.local = R.analyzeLocally(text);
  state.ai = null; state.aiError = ''; state.chat = []; state.view = 'ai'; state.showAllGood = false;
  const wantAi = $('#useAi').checked && state.live;
  state.aiStatus = wantAi ? 'loading' : 'off';
  $('.scan').hidden = true;
  btn.disabled = false;
  renderResults(true);
  $('#step3').classList.add('done');
  if(window.innerWidth < 980) $('#results').scrollIntoView({ behavior:'smooth', block:'start' });

  if(!wantAi){ saveHistory(); return; }
  try{
    const res = await fetch(API + 'analyze', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ mode:'analyze', text, lang:$('#lang').value }),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || 'AI unavailable right now.');
    if(state.text.trim() !== text) return; // user moved on
    state.ai = data;
    state.aiStatus = 'done';
  }catch(err){
    state.aiStatus = 'error';
    state.aiError = err instanceof TypeError ? 'Couldn\'t reach the AI.' : err.message;
  }
  renderResults(false);
  saveHistory();
}

/* The result set currently on screen, in one shape for AI and local. */
function current(){
  const L = state.local;
  if(state.ai && state.view === 'ai'){
    const a = state.ai;
    return {
      source:'ai', model:a.model, verdict:a.verdict, score:a.score,
      docType:a.doc_type, name:a.service_name || L.serviceName,
      tldr:a.tldr, flags:a.flags || [], good:a.good || [], checklist:a.checklist || [],
      truncated:a.truncated,
    };
  }
  return {
    source:'local', verdict:L.verdict, score:L.score, docType:L.docType, name:L.serviceName,
    tldr:R.localSummary(L), flags:L.flags, good:L.good, checklist:R.localChecklist(L),
  };
}

/* ---------------------------- Highlighting ---------------------------- */
function findQuote(text, quote){
  if(!quote || quote.length < 8) return null;
  let i = text.indexOf(quote);
  if(i < 0) i = text.toLowerCase().indexOf(quote.toLowerCase());
  if(i >= 0) return [i, i + quote.length];
  // the AI sometimes normalises whitespace or trims: anchor on the first words
  const head = quote.slice(0, 50).toLowerCase();
  i = text.toLowerCase().indexOf(head);
  return i >= 0 ? [i, Math.min(text.length, i + quote.length)] : null;
}

function buildMarks(text, r){
  const items = [];
  r.flags.forEach((f, n) => {
    const qs = f.quotes?.length ? f.quotes : [{ text:f.quote }];
    qs.forEach(q => items.push({ quote:q.text, start:q.start, end:q.end, cls:f.severity, key:'f' + n, title:f.title }));
  });
  r.good.forEach((g, n) => items.push({ quote:g.quote, cls:'good', key:'g' + n, title:g.title }));
  const rank = { high:0, medium:1, good:2, low:3 };
  const placed = [];
  for(const it of items.sort((a, b) => rank[a.cls] - rank[b.cls])){
    const range = it.start != null ? [it.start, it.end] : findQuote(text, it.quote);
    if(!range) continue;
    if(placed.some(p => range[0] < p.end && range[1] > p.start)) continue;
    placed.push({ start:range[0], end:range[1], cls:it.cls, key:it.key, title:it.title });
  }
  placed.sort((a, b) => a.start - b.start);
  return placed;
}

function renderDoc(text, marks){
  let out = '', pos = 0;
  const seen = new Set();
  for(const m of marks){
    out += esc(text.slice(pos, m.start));
    const id = seen.has(m.key) ? '' : ` id="m-${m.key}"`;
    seen.add(m.key);
    out += `<mark class="${m.cls}"${id} title="${esc(m.title)}">${esc(text.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  }
  return out + esc(text.slice(pos));
}

/* ---------------------------- Rendering ---------------------------- */
function gauge(score, verdict){
  const C = 2 * Math.PI * 48;
  const color = verdict === 'be_careful' ? 'var(--red)' : verdict === 'careful_read' ? 'var(--amber)' : 'var(--green)';
  return `<svg viewBox="0 0 120 120" role="img" aria-label="Caution score ${score} out of 100">
    <circle cx="60" cy="60" r="48" fill="none" stroke="var(--line-soft)" stroke-width="8"/>
    <circle class="arc" cx="60" cy="60" r="48" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${C}" data-target="${C * (1 - score / 100)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="62" text-anchor="middle" class="num">${score}</text>
    <text x="60" y="81" text-anchor="middle" class="lbl">CAUTION</text></svg>`;
}

function flagHtml(f, n, kind){
  const cls = kind === 'good' ? 'good' : f.severity;
  const key = (kind === 'good' ? 'g' : 'f') + n;
  const cat = kind === 'good' ? '' : `<span class="cat">${esc(R.CATEGORIES[f.category] || f.category || '')}${f.count > 1 ? ' · ' + f.count + ' mentions' : ''}</span>`;
  return `<div class="flag ${cls}">
    <span class="sev ${cls}">${SEV_ICON[cls]}</span>
    <div>
      <div class="flag-t"><b dir="auto">${esc(f.title)}</b>${cat}</div>
      <p dir="auto">${esc(f.explanation)}</p>
      ${f.quote ? `<button class="quote" data-mark="m-${key}" title="Show in document">“${esc(f.quote.length > 280 ? f.quote.slice(0, 280) + '…' : f.quote)}”</button>` : `<p class="dim mono">Not in the document: that's the problem.</p>`}
      ${f.tip ? `<p class="tip" dir="auto">${esc(f.tip)}</p>` : ''}
    </div></div>`;
}

function renderResults(first){
  const r = current();
  const v = VERDICTS[r.verdict] || VERDICTS.careful_read;
  const high = r.flags.filter(f => f.severity === 'high').length;
  const med = r.flags.filter(f => f.severity === 'medium').length;
  const low = r.flags.length - high - med;
  const marks = buildMarks(state.text, r);
  const shownText = state.text.length > 80000 ? state.text.slice(0, 80000) : state.text;
  const good = state.showAllGood ? r.good : r.good.slice(0, 4);

  let sourceTags = `<span class="tag">${esc(DOC_TYPES[r.docType] || 'Document')}</span>`;
  if(r.name) sourceTags = `<span class="tag">${esc(r.name)}</span>` + sourceTags;
  sourceTags += `<span class="tag">${state.local.words.toLocaleString()} words</span>`;
  sourceTags += r.source === 'ai' ? `<span class="tag ai">AI · Gemini</span>` : `<span class="tag">Rule engine</span>`;
  if(r.truncated) sourceTags += `<span class="tag warn">Long document: AI read the first 60,000 characters</span>`;

  let aiLine = '';
  if(state.aiStatus === 'loading') aiLine = `<div class="loading-row" style="margin-top:14px"><i class="spin"></i>AI is reading the whole document for a plain-English verdict…</div>`;
  if(state.aiStatus === 'error') aiLine = `<p class="dim mono" style="margin:12px 0 0;color:var(--amber)">${esc(state.aiError)} Showing the rule-based result.</p>`;

  const toggle = state.ai ? `<div class="seg" role="tablist" aria-label="Result source">
      <button class="seg-btn ${state.view === 'ai' ? 'active' : ''}" data-view="ai">AI</button>
      <button class="seg-btn ${state.view === 'local' ? 'active' : ''}" data-view="local">Rules</button></div>` : '';

  $('#emptyState').hidden = true;
  const body = $('#resultBody');
  body.hidden = false;
  body.className = first ? 'stagger' : '';
  body.innerHTML = `
    <div class="verdict-row">
      <section class="panel verdict ${v.cls} glow">
        <div>
          <div class="eyebrow">Verdict</div>
          <h2>${v.label}</h2>
          <div class="sub">${r.flags.length ? `${r.flags.length} clause${r.flags.length > 1 ? 's' : ''} flagged · ${high} high risk` : 'No red flags found'}</div>
        </div>
        <span class="v-icon"><svg viewBox="0 0 24 24" class="ic">${v.icon}</svg></span>
      </section>
      <section class="panel gauge ${v.cls}">${gauge(r.score, r.verdict)}</section>
    </div>

    <section class="panel accent tldr">
      <div class="panel-head" style="margin-bottom:10px"><h2>Can I just accept?</h2>${toggle}</div>
      <p dir="auto">${esc(r.tldr)}</p>
      <div class="source">${sourceTags}</div>
      ${aiLine}
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2><svg viewBox="0 0 24 24" class="ic" style="color:var(--red)"><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></svg>What to watch out for</h2>
        <div class="counts">${high ? `<span class="count h">${high} high</span>` : ''}${med ? `<span class="count m">${med} medium</span>` : ''}${low ? `<span class="count l">${low} low</span>` : ''}</div>
      </div>
      ${r.flags.length ? r.flags.map((f, n) => flagHtml(f, n)).join('') : `<p style="color:var(--text-1);margin:0">Nothing concerning stood out. Still skim the parts about payments and your data if you're unsure.</p>`}
    </section>

    ${r.good.length ? `<section class="panel">
      <div class="panel-head"><h2><svg viewBox="0 0 24 24" class="ic" style="color:var(--green)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>What they do well</h2></div>
      ${good.map((g, n) => flagHtml(g, n, 'good')).join('')}
      ${r.good.length > 4 ? `<button class="more" id="moreGood">${state.showAllGood ? 'Show less' : `Show ${r.good.length - 4} more`}</button>` : ''}
    </section>` : ''}

    ${r.checklist.length ? `<section class="panel">
      <div class="panel-head"><h2><svg viewBox="0 0 24 24" class="ic" style="color:var(--cyan)"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></svg>Before you tick the box</h2></div>
      <ul class="todo">${r.checklist.map(c => `<li dir="auto">${esc(c)}</li>`).join('')}</ul>
    </section>` : ''}

    <section class="panel">
      <div class="panel-head">
        <h2><svg viewBox="0 0 24 24" class="ic" style="color:var(--violet)"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>Highlighted document</h2>
        <div class="legend"><span><i style="background:var(--red)"></i>High</span><span><i style="background:var(--amber)"></i>Medium</span><span><i style="background:var(--text-2)"></i>Low</span><span><i style="background:var(--green)"></i>Good</span></div>
      </div>
      <div class="inset doc" id="docView" dir="auto">${renderDoc(shownText, marks.filter(m => m.end <= shownText.length))}</div>
    </section>`;

  requestAnimationFrame(() => $$('.gauge circle.arc').forEach(c => c.style.strokeDashoffset = c.dataset.target));

  $('#askPanel').hidden = !(state.live && $('#useAi').checked);
  renderChat();
}

function renderChat(){
  $('#chat').innerHTML = state.chat.map(m => `<div class="msg ${m.role}${m.err ? ' err' : ''}" dir="auto">${esc(m.text)}</div>`).join('')
    + (state.chatBusy ? `<div class="msg model"><span class="typing"><i></i><i></i><i></i></span></div>` : '');
  $('#suggest').hidden = state.chat.length > 0;
  const c = $('#chat'); c.scrollTop = c.scrollHeight;
}

async function askQuestion(q){
  q = q.trim();
  if(!q || state.chatBusy || !state.local) return;
  const history = state.chat.filter(m => !m.err).map(m => ({ role:m.role, text:m.text }));
  state.chat.push({ role:'user', text:q });
  state.chatBusy = true; renderChat();
  try{
    const res = await fetch(API + 'analyze', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ mode:'ask', text:state.text, question:q, history, lang:$('#lang').value }),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || 'AI unavailable right now.');
    state.chat.push({ role:'model', text:data.text });
  }catch(err){
    state.chat.push({ role:'model', text:err instanceof TypeError ? 'Couldn\'t reach the AI.' : err.message, err:true });
  }
  state.chatBusy = false; renderChat();
}

/* ---------------------------- History ---------------------------- */
function loadHistory(){
  try{ return JSON.parse(localStorage.getItem('clause-history') || '[]'); }catch(e){ return []; }
}
function saveHistory(){
  const r = current();
  const name = state.title || r.name || state.text.trim().split('\n')[0].slice(0, 60);
  const list = [{ name, verdict:r.verdict, score:r.score, flags:r.flags.length, source:r.source, words:state.local.words, date:new Date().toISOString() },
    ...loadHistory()].slice(0, 30);
  try{ localStorage.setItem('clause-history', JSON.stringify(list)); }catch(e){}
}
function renderHistory(){
  const list = loadHistory();
  const color = v => v === 'be_careful' ? 'var(--red)' : v === 'careful_read' ? 'var(--amber)' : 'var(--green)';
  $('#historyList').innerHTML = list.length ? list.map(h => `
    <div class="panel hist">
      <span class="score" style="color:${color(h.verdict)}">${h.score}</span>
      <div class="info"><b>${esc(h.name || 'Untitled document')}</b>
        <span>${esc((VERDICTS[h.verdict] || {}).label || '')} · ${h.flags} flag${h.flags === 1 ? '' : 's'} · ${h.source === 'ai' ? 'AI' : 'rules'} · ${new Date(h.date).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span></div>
    </div>`).join('') + `<button class="btn ghost" id="clearHistory" style="margin:10px 0 40px">Clear history</button>`
    : `<p class="empty-small">No checks yet. Analyze a document and it will show up here.</p>`;
}

/* ---------------------------- Learn ---------------------------- */
function renderLearn(){
  const groups = [['high', 'High risk: think twice'], ['medium', 'Worth knowing before you accept'], ['low', 'Common, mostly harmless']];
  let html = '';
  for(const [sev, label] of groups){
    html += `<h2 class="section-t">${label}</h2>`;
    html += R.RED_RULES.filter(r => r.sev === sev).map(r => `
      <section class="panel learn-card">
        <span class="cat"><span class="sev ${sev}">●</span> ${esc(R.CATEGORIES[r.cat])}</span>
        <h3>${esc(r.title)}</h3><p>${esc(r.explain)}</p><p class="tip">${esc(r.tip)}</p>
      </section>`).join('');
  }
  html += `<h2 class="section-t">Good signs</h2>` + R.GOOD_RULES.map(g => `
    <section class="panel learn-card good-card"><span class="cat"><span class="sev good">●</span> Good sign</span>
      <h3>${esc(g.title)}</h3><p>${esc(g.explain)}</p></section>`).join('');
  $('#learnGrid').innerHTML = html;
}

function showTab(tab){
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + tab);
  if(tab === 'history') renderHistory();
  if(tab === 'learn' && !$('#learnGrid').children.length) renderLearn();
  window.scrollTo({ top:0 });
}

/* ---------------------------- Events ---------------------------- */
$('#docText').addEventListener('input', () => { state.title = ''; onTextChange(); });
$('#docText').addEventListener('keydown', e => { if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)) analyze(); });
$('#analyzeBtn').addEventListener('click', analyze);
$('#useAi').addEventListener('change', updatePrivacyNote);
$('#linkForm').addEventListener('submit', fetchLink);
$('#docFile').addEventListener('change', e => readFile(e.target.files[0]));
$$('.seg-btn[data-input]').forEach(b => b.addEventListener('click', () => switchInput(b.dataset.input)));
$$('[data-sample]').forEach(b => b.addEventListener('click', () => {
  setText(window.CLAUSE_SAMPLES[b.dataset.sample], b.dataset.sample === 'shady' ? 'SnapVibe (sample)' : 'Northwind Notes (sample)');
  switchInput('paste');
  analyze();
}));
$$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));

$('#resultBody').addEventListener('click', e => {
  const q = e.target.closest('.quote');
  if(q){
    const m = document.getElementById(q.dataset.mark);
    if(!m) return;
    m.scrollIntoView({ behavior:'smooth', block:'center' });
    m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 1400);
    return;
  }
  const v = e.target.closest('[data-view]');
  if(v){ state.view = v.dataset.view; renderResults(false); return; }
  if(e.target.id === 'moreGood'){ state.showAllGood = !state.showAllGood; renderResults(false); }
});
$('#askForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#askInput'); askQuestion(i.value); i.value = ''; });
$('#suggest').addEventListener('click', e => { if(e.target.matches('.chip-btn')) askQuestion(e.target.textContent); });
$('#historyList').addEventListener('click', e => {
  if(e.target.id === 'clearHistory'){ try{ localStorage.removeItem('clause-history'); }catch(err){} renderHistory(); }
});

onTextChange();
// #demo opens straight on the shady sample (used by the portfolio link)
checkEngine().then(() => { if(location.hash === '#demo') $('[data-sample=shady]').click(); });
