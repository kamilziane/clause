/* ============================================================
   CLAUSE AI backend (Netlify Function), using Google Gemini's free tier.
   The browser always runs the local rule engine first; this function
   adds the plain-English AI read and answers follow-up questions.
   If it isn't deployed or has no key, the app stays in local mode.

   Setup: Netlify -> Project configuration -> Environment variables:
   GEMINI_API_KEY (free key from aistudio.google.com). Deploy with the
   Netlify CLI (drag-and-drop uploads skip functions).
   Never put the key in client-side code.
   ============================================================ */

// Tried in order: if one model is slow, rate-limited or unavailable, the next answers.
const MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.8-flash'];
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
// Netlify cuts synchronous functions off at 10 s, so every call shares one budget.
const BUDGET_MS = 9300;
const MAX_DOC = 60000;

const LANGS = { en:'English', fr:'French', es:'Spanish', ar:'Arabic' };
const CATEGORIES = ['data_sharing', 'tracking', 'sensitive', 'retention', 'ai_training', 'your_content',
  'legal_rights', 'changes', 'termination', 'payments', 'liability', 'other'];

const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    doc_type: { type: 'STRING', enum: ['terms', 'privacy', 'both', 'other', 'not_a_policy'] },
    service_name: { type: 'STRING' },
    verdict: { type: 'STRING', enum: ['fine', 'careful_read', 'be_careful'] },
    score: { type: 'INTEGER' },
    tldr: { type: 'STRING' },
    flags: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      title: { type: 'STRING' },
      severity: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      category: { type: 'STRING', enum: CATEGORIES },
      quote: { type: 'STRING' },
      explanation: { type: 'STRING' },
      tip: { type: 'STRING' }
    }, required: ['title', 'severity', 'category', 'quote', 'explanation', 'tip'] } },
    good: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      title: { type: 'STRING' },
      quote: { type: 'STRING' },
      explanation: { type: 'STRING' }
    }, required: ['title', 'quote', 'explanation'] } },
    checklist: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['doc_type', 'service_name', 'verdict', 'score', 'tldr', 'flags', 'good', 'checklist']
};

const ANSWER_SCHEMA = { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] };

const ANALYZE_PROMPT = `
You are CLAUSE, a consumer-protection assistant built by Kamil Ziane. You read terms and conditions and privacy
policies for ordinary people and tell them, honestly and in plain words, whether they can just tick "I accept" or
should be careful. You are not a lawyer and this is not legal advice.

Judge the document from the user's point of view. Flag what is unusual, unfair, or affects their money, data,
content or legal rights. Do not flag boilerplate as scary: hosting providers, payment processors, "as is"
disclaimers and governing-law clauses are normal and at most "low". Be fair: if a policy is good, say so.

Severity:
- high: real risk or unusually aggressive (selling data, broad perpetual licence on your content, forced arbitration
  with class-action waiver, silent changes, hard-to-cancel auto-renewal, sensitive data like biometrics or precise location
  used beyond the feature, AI training on private content without opt-out).
- medium: worth knowing before accepting (advertising use, long or vague retention, termination at will, no refunds).
- low: common and mostly harmless, but good to know.

verdict: "fine" (standard, nothing worrying), "careful_read" (acceptable, but read the flagged parts),
"be_careful" (several high-risk clauses: think twice). score: 0 (very user-friendly) to 100 (very risky),
consistent with the verdict (fine < 25, careful_read 25-54, be_careful >= 55).

Rules:
- "quote" must be copied word for word from the document (a short sentence or part of one, max 300 characters),
  so it can be highlighted. Never invent or paraphrase quotes.
- Never invent clauses that are not in the text. If something important is missing (for example no way to delete
  your data), you may flag it with an empty quote and say it is missing.
- Up to 12 flags, most important first. Up to 6 good points.
- "explanation": 1-2 short sentences, what it means for the user in everyday words, no legal jargon.
- "tip": one concrete thing the user can do about it.
- "tldr": 2-3 sentences answering "can I just accept?".
- "checklist": 2-5 short actions to do before or right after accepting.
- If the text is not terms or a privacy policy, set doc_type "not_a_policy", verdict "fine", score 0, no flags, and say so in tldr.
- Write every field except "quote" in {LANG}. Quotes stay in the document's original language.
`.trim();

const ASK_PROMPT = `
You are CLAUSE, a consumer-protection assistant built by Kamil Ziane. The user is reading the terms or privacy
policy below and asks a question about it. Answer only from the document. If the document doesn't say, answer that
it doesn't say, then add what is usual in one sentence. Quote the relevant words when it helps. Plain text, no
markdown, 1-4 short sentences unless asked for more. You are not a lawyer; never claim certainty about how a court would
read a clause. Reply in {LANG}, or in the language of the question if it is clearly different.
`.trim();

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

async function ask(model, system, contents, schema, ms, maxTokens){
  const res = await fetch(API + model + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema }
    }),
    signal: AbortSignal.timeout(ms)
  });
  if(!res.ok){
    const err = new Error(model + ' ' + res.status + ' ' + (await res.text()).slice(0, 300));
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  return JSON.parse(text);
}

async function withFallback(system, contents, schema, maxTokens){
  const deadline = Date.now() + BUDGET_MS;
  let lastErr;
  for(const model of MODELS){
    const left = deadline - Date.now();
    if(left < 1500) break;
    try{ return { model, out: await ask(model, system, contents, schema, left, maxTokens) }; }
    catch(e){ lastErr = e; console.warn('[clause]', e.message); }
  }
  throw lastErr || new Error('out of time');
}

exports.handler = async function(event){
  // GET = status check used by the header pill ("AI live" vs local mode)
  if(event.httpMethod === 'GET') return json(200, { live: !!process.env.GEMINI_API_KEY });
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if(!process.env.GEMINI_API_KEY) return json(503, { error: 'AI not configured' });

  let body;
  try{ body = JSON.parse(event.body || '{}'); }catch(e){ return json(400, { error: 'Bad JSON' }); }
  const { mode = 'analyze', text, question, history = [], lang } = body;
  if(typeof text !== 'string' || text.trim().length < 40) return json(400, { error: 'Text too short' });
  const doc = text.slice(0, MAX_DOC);
  const language = LANGS[lang] || 'English';

  try{
    if(mode === 'ask'){
      if(typeof question !== 'string' || !question.trim() || question.length > 1000) return json(400, { error: 'Bad question' });
      const turns = (Array.isArray(history) ? history : []).slice(-6)
        .filter(h => h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'model'))
        .map(h => ({ role: h.role, parts: [{ text: h.text.slice(0, 1500) }] }));
      const contents = [
        { role: 'user', parts: [{ text: 'DOCUMENT:\n' + doc }] },
        { role: 'model', parts: [{ text: '{"text":"I have read the document. What would you like to know?"}' }] },
        ...turns,
        { role: 'user', parts: [{ text: question.trim() }] }
      ];
      const { model, out } = await withFallback(ASK_PROMPT.replace('{LANG}', language), contents, ANSWER_SCHEMA, 700);
      return json(200, { text: String(out.text || '').trim(), model });
    }

    const contents = [{ role: 'user', parts: [{ text: 'Analyse this document:\n\n' + doc }] }];
    const { model, out } = await withFallback(ANALYZE_PROMPT.replace('{LANG}', language), contents, ANALYSIS_SCHEMA, 3000);
    out.score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
    out.flags = (out.flags || []).slice(0, 12);
    out.good = (out.good || []).slice(0, 6);
    out.checklist = (out.checklist || []).slice(0, 5);
    return json(200, { ...out, model, truncated: text.length > MAX_DOC });
  }catch(e){
    const status = e.status === 429 ? 429 : 502;
    return json(status, { error: status === 429 ? 'AI is busy (free-tier limit), try again in a minute.' : 'AI unavailable right now.' });
  }
};
