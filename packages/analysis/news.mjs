// Rule-based headline tagging. Deterministic and explainable: every tag/sentiment
// point comes from a matched keyword, returned in `matched` so the UI can show why.
// This is NOT an NLP model; it misreads sarcasm, negations and context.

const TAGS = [
  ['EARNINGS', /\b(earnings|EPS|quarterly results|Q[1-4] (results|revenue|sales)|(first|second|third|fourth)[- ]quarter|fiscal (year|quarter) results|reports? (results|revenue))\b/i],
  ['GUIDANCE', /\b(guidance|outlook|forecast)\b/i],
  ['FDA', /\b(FDA|PDUFA|BLA|sNDA|NDA|clinical|phase (1|2|3|I|II|III)\b|trial|topline|breakthrough therapy|fast track|EMA approval)/i],
  ['OFFERING', /\b(offering|private placement|registered direct|at-the-market|ATM program|warrants?|convertible (notes?|senior notes?)|shelf registration|dilut\w*)\b/i],
  ['M&A', /\b(acquir\w*|acquisition|merger|merge|takeover|buyout|tender offer|to be acquired|definitive agreement to (buy|acquire|be acquired))\b/i],
  ['CONTRACT', /\b(contract|partnership|collaborat\w*|purchase order|awarded|supply agreement|licensing agreement)\b/i],
  ['ANALYST', /\b(upgrades?|downgrades?|price target|initiates coverage|reiterates?|overweight|underweight|outperform|underperform)\b/i],
  ['AI', /\b(AI|artificial intelligence|generative|LLM|GPU|data cent(er|re))\b/],
  ['RISK', /\b(lawsuit|class action|investigation|subpoena|delist\w*|bankruptcy|chapter 11|going concern|recall|restatement|default|halted)\b/i],
  ['BUYBACK', /\b(buyback|repurchase|special dividend|dividend (increase|hike))\b/i],
];

const POS = /\b(beats?|tops?|raises?|raised|upgrades?|approv(al|ed|es)|record|surges?|soars?|jumps?|rall(y|ies)|wins?|awarded|exceeds?|strong|accelerat\w*|positive|expands?|outperform|breakthrough|buyback|repurchase)\b/gi;
const NEG = /\b(miss(es|ed)?|cuts?|lowers?|lowered|downgrades?|offering|delist\w*|bankruptcy|plunges?|falls?|drops?|slumps?|lawsuit|recall|weak|suspends?|rejects?|complete response letter|CRL|fails?|failed|halts?|going concern|layoffs?|underperform|dilut\w*|investigation|default)\b/gi;

const IMPORTANCE = { FDA: 5, 'M&A': 5, OFFERING: 4, EARNINGS: 4, RISK: 4, GUIDANCE: 4, CONTRACT: 3, ANALYST: 3, BUYBACK: 3, AI: 2 };

export function classifyHeadline(headline, summary = '') {
  const text = `${headline ?? ''} ${summary ?? ''}`;
  const tags = TAGS.filter(([, re]) => re.test(text)).map(([t]) => t);
  const pos = [...new Set((String(headline ?? '').match(POS) || []).map((w) => w.toLowerCase()))];
  const neg = [...new Set((String(headline ?? '').match(NEG) || []).map((w) => w.toLowerCase()))];
  const raw = pos.length - neg.length;
  const sentiment = raw > 0 ? 'positive' : raw < 0 ? 'negative' : 'neutral';
  const base = tags.reduce((m, t) => Math.max(m, IMPORTANCE[t] ?? 1), 1);
  const importance = Math.min(5, base + (Math.abs(raw) >= 2 ? 1 : 0));
  return { tags, sentiment, sentimentScore: raw, importance, matched: { positive: pos, negative: neg } };
}
