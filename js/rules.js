/* =========================================================================
   CLAUSE — Local rule engine
   Runs instantly in the browser, with or without the AI. Every flag points
   at the exact sentence that triggered it, so nothing is a black box.
========================================================================= */

const CATEGORIES = {
  data_sharing:  'Data sharing',
  tracking:      'Tracking',
  sensitive:     'Sensitive data',
  retention:     'Data retention',
  ai_training:   'AI training',
  your_content:  'Your content',
  legal_rights:  'Your legal rights',
  changes:       'Changes to the deal',
  termination:   'Account termination',
  payments:      'Payments',
  liability:     'Liability',
  other:         'Other',
};

// sev: high | medium | low. weight feeds the 0–100 caution score.
// keepNegated: the phrase itself is negative ("no refunds"), so "not" nearby doesn't cancel it.
const RED_RULES = [
  { id:'sell_data', cat:'data_sharing', sev:'high', weight:24,
    title:'May sell your personal data',
    explain:'They reserve the right to sell or rent information about you. Once sold, you lose any control over who has it.',
    tip:'Look for a "Do not sell my data" link or opt-out in your account settings.',
    patterns:[/\b(sell|rent|trade|monetis\w*|monetiz\w*)\b[^.;]{0,70}\b(personal (data|information)|your (data|information)|user (data|information))/i,
              /\bsale of (your |users' )?(personal )?(data|information)\b/i] },
  { id:'ad_sharing', cat:'data_sharing', sev:'high', weight:16,
    title:'Shares your data with advertisers',
    explain:'Your information is passed to advertising or marketing partners, who can use it to profile you across the web.',
    tip:'Turn off personalised ads in the app settings and in your phone\'s privacy settings.',
    patterns:[/\b(share|disclose|provide|transfer)\w*\b[^.;]{0,90}\b(advertis\w+|marketing) partners?\b/i,
              /\b(advertis\w+|marketing) partners?\b[^.;]{0,60}\b(receive|access|collect|use)\b/i,
              /\bthird[- ]part(y|ies)\b[^.;]{0,60}\bfor (their own )?(marketing|advertising)\b/i] },
  { id:'targeted_ads', cat:'tracking', sev:'medium', weight:8,
    title:'Uses your data for targeted ads',
    explain:'What you do is used to build a profile and show you personalised advertising.',
    tip:'Check whether there is an opt-out for personalised advertising.',
    patterns:[/\b(targeted|personali[sz]ed|interest-based|behavio(u)?ral) (ads|advertis\w+)\b/i] },
  { id:'tracking', cat:'tracking', sev:'medium', weight:10,
    title:'Tracks you beyond this service',
    explain:'They follow your activity on other websites, apps or devices, not just while you use their service.',
    tip:'Use a browser with tracking protection and decline non-essential cookies.',
    patterns:[/\b(across|on) (other|third[- ]party) (websites|sites|apps|applications|services)\b/i,
              /\bcross[- ](device|site|app)\b/i, /\b(device )?fingerprint(ing)?\b/i,
              /\b(web beacons|tracking pixels?|third[- ]party cookies)\b/i] },
  { id:'sensitive', cat:'sensitive', sev:'high', weight:14,
    title:'Collects sensitive data',
    explain:'They collect especially personal data (biometrics, precise location, health, contacts or similar). A leak of this kind of data is much harder to undo.',
    tip:'Deny the matching phone permissions (location, contacts, microphone) unless you really need the feature.',
    patterns:[/\bbiometric\w*\b/i, /\b(face|voice) ?prints?\b/i, /\bfacial (recognition|geometry)\b/i,
              /\bprecise (geo)?location\b/i, /\b(health|medical) (data|information)\b/i,
              /\b(sexual orientation|religious beliefs|political (opinions|views)|ethnic origin)\b/i,
              /\b(address book|contact list|your contacts)\b/i, /\b(microphone|camera roll|photo library)\b/i] },
  { id:'retention', cat:'retention', sev:'medium', weight:8,
    title:'Keeps your data for a long time',
    explain:'There is no clear deletion date: data may be kept indefinitely or even after you delete your account.',
    tip:'Ask for deletion in writing (under GDPR you can) and keep the confirmation.',
    patterns:[/\b(retain|keep|store)\w*\b[^.;]{0,90}\b(indefinitely|as long as (we|necessary|needed|required|reasonably)|for as long as)\b/i,
              /\beven after (you )?(delete|close|terminate|deactivate)\b/i,
              /\b(residual|backup) copies\b/i] },
  { id:'ai_training', cat:'ai_training', sev:'medium', weight:12,
    title:'Uses your content to train AI',
    explain:'What you write, upload or say can be used to train their AI models. That is usually impossible to undo once trained.',
    tip:'Look for an AI training opt-out in settings before you upload anything personal.',
    patterns:[/\b(train|training|improve|develop)\w*\b[^.;]{0,70}\b(machine learning|artificial intelligence|AI|large language|models?|algorithms)\b/i] },
  { id:'combine', cat:'data_sharing', sev:'medium', weight:8,
    title:'Combines data from other sources',
    explain:'They merge what you give them with data bought or collected elsewhere, building a fuller profile of you.',
    tip:'You can ask (GDPR right of access) what they hold about you and where it came from.',
    patterns:[/\bcombine\w*\b[^.;]{0,80}\b(other sources|third[- ]part(y|ies)|data brokers|publicly available)\b/i,
              /\bdata brokers?\b/i] },
  { id:'third_party', cat:'data_sharing', sev:'low', weight:5,
    title:'Shares data with third parties',
    explain:'Data is shared with other companies. This is common (hosting, payments), but check who and why.',
    tip:'Look for a list of the third parties or categories of recipients.',
    patterns:[/\b(share|disclose|provide|transfer)\w*\b[^.;]{0,70}\bthird[- ]part(y|ies)\b/i] },
  { id:'gov_no_notice', cat:'data_sharing', sev:'medium', weight:6,
    title:'Hands data to authorities without telling you',
    explain:'They may give your data to authorities without notifying you, even when the law would allow them to.',
    tip:'Nothing to toggle here: just be aware of what you store on the service.',
    patterns:[/\b(law enforcement|government|authorit(y|ies))\b[^.;]{0,100}\bwithout (prior )?(notice|notifying you|a warrant)\b/i] },
  { id:'transfer', cat:'data_sharing', sev:'low', weight:3,
    title:'Moves your data to other countries',
    explain:'Your data can be stored in countries with weaker privacy laws than yours.',
    tip:'In the EU, look for "Standard Contractual Clauses" or an adequacy decision mentioned nearby.',
    patterns:[/\btransfer\w*\b[^.;]{0,90}\b(outside|other countries|countries (that|which) may not|different data protection)\b/i] },

  { id:'content_license', cat:'your_content', sev:'high', weight:16,
    title:'Broad licence over what you post',
    explain:'You give them a wide licence (worldwide, perpetual, irrevocable…) to use, copy and share your content, sometimes even after you delete it.',
    tip:'Don\'t upload anything you want to keep exclusive control of.',
    test:s => /\blicen[cs]e\b/i.test(s) && ((s.match(/\b(worldwide|perpetual|irrevocable|royalty[- ]free|sub-?licens\w+|transferable)\b/gi) || []).length >= 2) },
  { id:'moral_rights', cat:'your_content', sev:'medium', weight:6,
    title:'You waive your moral rights',
    explain:'You give up the right to be credited or to object to how your work is changed.',
    tip:'Matters if you post creative work (art, writing, music).',
    patterns:[/\bwaive\w*\b[^.;]{0,50}\bmoral rights\b/i] },
  { id:'arbitration', cat:'legal_rights', sev:'high', weight:14,
    title:'You can\'t take them to court',
    explain:'Disputes go to private arbitration instead of a court, and you may give up joining a class action. It makes it much harder to fight back.',
    tip:'Some terms let you opt out of arbitration by email within 30 days. Look for it.',
    patterns:[/\bbinding (individual )?arbitration\b/i, /\bclass[- ]action waiver\b/i,
              /\bwaive\w*\b[^.;]{0,60}\b(class action|jury trial|right to (a )?(sue|trial))\b/i,
              /\bresolved (exclusively )?(by|through) (final and binding )?arbitration\b/i] },
  { id:'changes_silent', cat:'changes', sev:'high', weight:12,
    title:'Can change the terms without telling you',
    explain:'They can rewrite the agreement whenever they want and are not required to warn you.',
    tip:'Re-check the terms from time to time, or look for a changelog.',
    patterns:[/\b(change|modify|amend|update|revise)\w*\b[^.;]{0,100}\bwithout (prior |advance |any )?(notice|notifying you|informing you)\b/i,
              /\bwithout (prior |advance |any )?(notice|notifying you)\b[^.;]{0,60}\b(change|modify|amend|update|revise)\w*\b/i] },
  { id:'changes_anytime', cat:'changes', sev:'medium', weight:6,
    title:'Can change the terms at any time',
    explain:'They can update the agreement on their own whenever they choose.',
    tip:'Check whether they promise to notify you before changes apply.',
    patterns:[/\b(change|modify|amend|update|revise)\w*\b[^.;]{0,80}\b(at any time|from time to time|in our (sole|absolute) discretion|at our (sole|absolute) discretion)\b/i] },
  { id:'continued_use', cat:'changes', sev:'low', weight:4,
    title:'Using the service = accepting new terms',
    explain:'If the terms change and you keep using the service, you are treated as having accepted the new version.',
    tip:'If a change bothers you, stop using the service before it takes effect.',
    patterns:[/\bcontinu\w+ (to use|use|access)\b[^.;]{0,80}\b(constitutes?|means|deemed|signif\w+|indicates?)\b[^.;]{0,40}\baccept/i] },
  { id:'termination', cat:'termination', sev:'medium', weight:8,
    title:'Can close your account for any reason',
    explain:'They can suspend or delete your account whenever they want, possibly without explanation, and you may lose your content.',
    tip:'Keep your own backup of anything important you store there.',
    patterns:[/\b(terminate|suspend|disable|delete|close)\w*\b[^.;]{0,100}\b(for any (reason|cause)|for no reason|without (prior )?(notice|cause|reason|explanation)|at (our|its) (sole|absolute) discretion)\b/i] },
  { id:'auto_renew', cat:'payments', sev:'high', weight:12,
    title:'Auto-renewing subscription',
    explain:'You will be charged again automatically until you cancel. Easy to forget, and free trials often turn into paid plans this way.',
    tip:'Set a reminder a few days before the renewal or trial end date.',
    patterns:[/\b(automatically renew\w*|auto-?renew\w*|renew\w* automatically)\b/i,
              /\brecurring (billing|charges?|payments?)\b/i,
              /\bwill (automatically )?be charged\b[^.;]{0,40}\b(automatically|each|every|at the end of)\b/i] },
  { id:'no_refund', cat:'payments', sev:'medium', weight:8, keepNegated:true,
    title:'No refunds',
    explain:'Money you pay may not come back, even if you cancel early or the service doesn\'t work for you.',
    tip:'In the EU you usually have a 14-day withdrawal right for online purchases, check if it applies.',
    patterns:[/\bnon-?refundable\b/i, /\bno refunds?\b/i, /\bnot (be )?(eligible for (a )?)?refund(ed|able|s)?\b/i] },
  { id:'cancel_hurdle', cat:'payments', sev:'medium', weight:8,
    title:'Cancelling is made hard',
    explain:'Cancelling requires extra steps (writing a letter, calling, notice weeks in advance) instead of one click.',
    tip:'Note the cancellation deadline now and keep proof when you cancel.',
    patterns:[/\bcancel\w*\b[^.;]{0,90}\b(in writing|by (mail|post|phone|telephone|calling)|written notice|by registered)\b/i,
              /\bcancel\w*\b[^.;]{0,60}\b\d+ days?'? (before|prior|in advance)\b/i] },
  { id:'price_change', cat:'payments', sev:'low', weight:4,
    title:'Prices can go up',
    explain:'They can raise the price of the service, sometimes with little notice.',
    tip:'Check how much notice they give before a price increase.',
    patterns:[/\b(change|increase|raise|modify)\w*\b[^.;]{0,50}\b(prices?|fees|subscription (fee|price)s?)\b/i] },
  { id:'indemnify', cat:'liability', sev:'medium', weight:6,
    title:'You cover their legal costs',
    explain:'If someone sues them because of something you did on the service, you agree to pay their costs.',
    tip:'Common in terms, but be careful with what you post or sell through the service.',
    patterns:[/\bindemnif(y|ies|ication)\b/i, /\bhold\b[^.;]{0,30}\bharmless\b/i] },
  { id:'liability', cat:'liability', sev:'low', weight:3, keepNegated:true,
    title:'Limits what they owe you',
    explain:'They cap or exclude responsibility if things go wrong (data loss, outages, damages). Very common.',
    tip:'Don\'t rely on the service as the only copy of anything important.',
    patterns:[/\blimitation of liability\b/i, /\b(shall|will) not be liable\b/i, /\bprovided (on an )?"?as is"?/i,
              /\bmaximum extent permitted by (applicable )?law\b/i] },
  { id:'jurisdiction', cat:'legal_rights', sev:'low', weight:3,
    title:'Disputes handled under another country\'s law',
    explain:'The contract follows a specific country\'s or state\'s law and courts, which may be far from you.',
    tip:'Consumer protection laws in your own country often still apply anyway.',
    patterns:[/\bgoverned by (and construed in accordance with )?the laws? of\b/i, /\bexclusive jurisdiction\b/i] },
];

const GOOD_RULES = [
  { id:'no_sell', weight:10, title:'Says it doesn\'t sell your data',
    explain:'They explicitly commit not to sell your personal data.',
    patterns:[/\b(do not|don't|never|will not|won't|does not|doesn't)\b[^.;]{0,20}\b(sell|rent|trade)\b/i] },
  { id:'user_rights', weight:6, title:'You can access or delete your data',
    explain:'You have a clear way to see, download or delete what they hold about you.',
    patterns:[/\b(right to|you (can|may))\b[^.;]{0,30}\b(access|delete|erase|erasure|correct|rectif\w+|port\w*|export|download)\b/i] },
  { id:'opt_out', weight:3, title:'You can opt out',
    explain:'There is an opt-out for some uses of your data (marketing emails, ads or similar).',
    patterns:[/\bopt[- ]out\b/i, /\bwithdraw (your )?consent\b/i] },
  { id:'notice', weight:6, title:'Warns you before changes',
    explain:'They promise to notify you in advance before the terms change.',
    test:s => /\b(notify|inform|tell|email)\w*\s+you\b[^.;]{0,80}\b(\d+ days|in advance|before|prior to)\b/i.test(s) && /\bchang|\bupdat|\bmodif/i.test(s) },
  { id:'encryption', weight:3, title:'Mentions encryption',
    explain:'Your data is described as encrypted, which reduces the damage of a leak.',
    patterns:[/\bend-to-end encrypt\w*\b/i, /\bencrypt(ed|ion)\b[^.;]{0,40}\b(transit|rest)\b/i] },
  { id:'gdpr', weight:4, title:'Follows privacy law (GDPR / CCPA)',
    explain:'It refers to recognised privacy laws or names a data protection officer you can contact.',
    patterns:[/\bGDPR\b/, /\bGeneral Data Protection Regulation\b/i, /\bCCPA\b/, /\bdata protection officer\b/i] },
  { id:'easy_cancel', weight:4, title:'Easy to cancel',
    explain:'You can cancel at any time without hurdles.',
    patterns:[/\byou (can|may) cancel\b[^.;]{0,40}\b(any ?time|at any time|online|in (your )?(account )?settings)\b/i] },
  { id:'refund', weight:4, title:'Has a refund window',
    explain:'There is a clear period in which you can get your money back.',
    patterns:[/\b\d+[- ]day (refund|money[- ]back)\b/i, /\bfull refund\b/i] },
];

const NEGATION = /\b(not|never|no|don't|won't|doesn't|do not|will not|does not|nor)\b[^.;]{0,25}$/i;

/* Split into sentences, keeping offsets so we can highlight them later. */
function splitSentences(text){
  const out = [];
  const re = /[^.!?;\n]+(?:[.!?;]+|\n+|$)/g;
  let m;
  while((m = re.exec(text))){
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const s = raw.trim();
    if(s.length > 12) out.push({ text:s, start:m.index + lead, end:m.index + lead + s.length });
    if(m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function matchRule(rule, sentence){
  if(rule.test) return rule.test(sentence);
  for(const p of rule.patterns){
    const m = p.exec(sentence);
    if(!m) continue;
    if(!rule.keepNegated && NEGATION.test(sentence.slice(0, m.index + 6))) continue;
    return true;
  }
  return false;
}

function detectDocType(text){
  const t = text.toLowerCase();
  const privacy = (t.match(/privacy|personal (data|information)|cookies?|data protection/g) || []).length;
  const terms = (t.match(/terms (of (service|use)|and conditions)|agreement|liabilit|arbitration|subscription/g) || []).length;
  if(privacy < 2 && terms < 2) return 'other';
  if(privacy > 2 && terms > 2) return 'both';
  return privacy >= terms ? 'privacy' : 'terms';
}

function guessServiceName(text){
  const m = text.match(/\b([A-Z][A-Za-z0-9]+(?: [A-Z][A-Za-z0-9]+)?)(?:,? Inc\.?|,? Ltd\.?|,? LLC|,? SAS)?\s*\(\s*["“]?(?:we|us|the company)/)
         || text.match(/^\s*([A-Z][A-Za-z0-9 ]{2,30}?)\s+(?:Privacy Policy|Terms)/m);
  return m ? m[1].trim() : '';
}

function verdictFor(score){
  if(score >= 55) return 'be_careful';
  if(score >= 25) return 'careful_read';
  return 'fine';
}

function analyzeLocally(text){
  const sentences = splitSentences(text);
  const flags = [];
  for(const rule of RED_RULES){
    const hits = sentences.filter(s => matchRule(rule, s.text));
    if(hits.length) flags.push({ ...rule, quotes:hits.slice(0, 3), count:hits.length });
  }
  // a stronger flag already covers the generic one
  const ids = new Set(flags.map(f => f.id));
  const drop = new Set();
  if(ids.has('ad_sharing') || ids.has('sell_data')) drop.add('third_party');
  if(ids.has('changes_silent')) drop.add('changes_anytime');
  const red = flags.filter(f => !drop.has(f.id));

  const good = [];
  for(const rule of GOOD_RULES){
    const hits = sentences.filter(s => rule.test ? rule.test(s.text) : rule.patterns.some(p => p.test(s.text)));
    if(hits.length) good.push({ ...rule, quotes:hits.slice(0, 2) });
  }

  const raw = red.reduce((a, f) => a + f.weight, 0) - good.reduce((a, g) => a + g.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const order = { high:0, medium:1, low:2 };
  red.sort((a, b) => order[a.sev] - order[b.sev] || b.weight - a.weight);

  return {
    source:'local',
    docType:detectDocType(text),
    serviceName:guessServiceName(text),
    score,
    verdict:verdictFor(score),
    flags:red.map(f => ({
      id:f.id, title:f.title, severity:f.sev, category:f.cat,
      quote:f.quotes[0].text, quotes:f.quotes, count:f.count,
      explanation:f.explain, tip:f.tip,
    })),
    good:good.map(g => ({ title:g.title, quote:g.quotes[0].text, explanation:g.explain })),
    words:(text.match(/\S+/g) || []).length,
    sentences:sentences.length,
  };
}

function localSummary(a){
  const high = a.flags.filter(f => f.severity === 'high');
  if(a.docType === 'other' && a.sentences < 8) return 'This doesn\'t look like terms or a privacy policy. Paste the full legal text for a useful check.';
  if(!a.flags.length) return 'No common red-flag clauses found by the local rules. That\'s a good sign, but rules can miss unusual wording: skim the sections on data sharing and payments anyway.';
  const top = (high.length ? high : a.flags).slice(0, 3).map(f => f.title.toLowerCase());
  const lead = a.verdict === 'be_careful' ? 'Be careful before accepting.'
             : a.verdict === 'careful_read' ? 'Mostly standard, but read a few parts first.'
             : 'Looks fairly standard.';
  return `${lead} ${a.flags.length} clause${a.flags.length > 1 ? 's' : ''} worth knowing about, mainly: ${top.join(', ')}.`
       + (a.good.length ? ` On the plus side: ${a.good.slice(0, 2).map(g => g.title.toLowerCase()).join(', ')}.` : '');
}

function localChecklist(a){
  const tips = a.flags.filter(f => f.severity !== 'low').map(f => f.tip);
  return [...new Set(tips)].slice(0, 5);
}

window.ClauseRules = { analyzeLocally, localSummary, localChecklist, splitSentences, verdictFor, CATEGORIES, RED_RULES, GOOD_RULES };
