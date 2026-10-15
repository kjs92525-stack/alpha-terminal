import { runMarketBrief } from '../packages/pipeline/market-brief.mjs';
const i=process.argv.indexOf('--out');
const d=await runMarketBrief({outDir:i>=0?process.argv[i+1]:'data-branch'});
console.log(JSON.stringify({asOf:d.asOf,state:d.decision.state,newsStatus:d.newsStatus,missing:d.missing}));
