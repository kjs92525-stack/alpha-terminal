// Reviewed primary-source industry theses. These are conditional research ideas,
// not ETF holdings, return-correlation membership, price targets or buy signals.
export const SECTOR_STORIES = [
 {id:'grid',name:'전력 인프라·데이터센터 전기·냉각',etfs:['PAVE','XLU'],publishedAt:'2026-02-06',reviewedAt:'2026-10-14',maxAge:365,
  headline:'AI의 병목이 칩에서 전력·배전·냉각으로 넓어진다',
  world:'AI 데이터센터와 전기화가 전력망 연결 수요를 늘리지만, 발전소와 데이터센터보다 전력망 구축이 오래 걸립니다. IEA는 2030년 수요를 충족하려면 연간 전력망 투자가 현재보다 약 50% 늘어야 한다고 추정합니다. 필요한 투자 규모이며 이미 확정된 수주가 아닙니다.',
  chain:'데이터센터 건설 → 전력 연결·현장 발전 → 배전·전력 제어·냉각 주문 → 잔고의 매출 전환 → 마진과 현금흐름. 병목을 해결하는 장비 업체를 보되 일반 유틸리티 전체가 같은 수익을 얻는다고 가정하지 않습니다.',
  leading:'주문/매출 비율, 예산과 계약이 확정된 잔고, 납기, 증설 가동률, 원가 상승분의 가격 전가와 현금 회수를 확인합니다.',
  failure:'연결 허가와 고객 투자 지연, 대형 고객 주문 취소, 증설 후 가동률 저하가 나타나면 수요가 실제 이익으로 이어지는 가설을 재검토합니다.',
  sources:[{label:'IEA Electricity 2026 · 전력망 투자·연결 병목',date:'2026-02-06',url:'https://www.iea.org/reports/electricity-2026/grids'}],symbols:['POWL','NVT'] },
 {id:'semicap',name:'반도체 장비·부품',etfs:['SMH'],publishedAt:'2026-07-14',reviewedAt:'2026-10-14',maxAge:180,
  headline:'AI·HBM 투자가 장비를 거쳐 부품 업체의 이익으로 이어질까',
  world:'SEMI의 2026년 7월 전망은 AI·HBM과 첨단 공정 투자를 근거로 장비 시장 확대를 예상했습니다. 공급망 지역화도 투자 동력이지만 수출 규제·관세·고객 투자 변경은 주문을 제약할 수 있습니다. 산업 전망을 개별 기업의 수주로 간주하지 않습니다.',
  chain:'AI·고대역폭 메모리 수요 → 고객의 설비투자 → 반도체 장비 주문 → 가스·화학 공급 시스템 및 부품 주문 → 생산 물량과 자체 부품 비중 증가 → 마진 개선. 최종 칩 수요와 부품 업체 매출 사이에는 시차가 있습니다.',
  leading:'고객 설비투자 계획이 실제 장비 주문으로 전환되는지, 주문 취소, 부품 매출과 가동률, 재고·매출채권 증가 및 영업현금흐름을 확인합니다.',
  failure:'AI 설비투자 둔화, 메모리 공급 과잉, 수출 제한 강화와 고객 주문 취소가 나타나면 업황 전망을 낮춥니다.',
  sources:[{label:'SEMI · 2026년 7월 장비시장 전망 (예측)',date:'2026-07-14',url:'https://www.semi.org/en/semi-press-release/global-semiconductor-equipment-sales-forecast-to-reach-a-record-229-billion-dollars-in-2028-semi-reports'}],symbols:['ICHR','UCTT'] },
 {id:'defense',name:'드론·대드론·군용 광학',etfs:['ITA'],publishedAt:'2026-08-10',reviewedAt:'2026-10-14',maxAge:180,
  headline:'전장의 변화가 일회성 시제품에서 반복 조달로 넘어갈까',
  world:'드론 운용 확대와 군의 국산 공급망 확보 방향은 광학·디스플레이·무인체계 업체에 기회를 만듭니다. Kopin의 시제품 주문과 AeroVironment의 예산이 확정된 잔고는 서로 다른 조달 단계입니다. 지정학적 긴장만으로 국방 예산 집행이나 특정 업체의 채택을 확정하지 않습니다.',
  chain:'군의 운용 요구 → 예산·시험·업체 선정 → 구속력 있는 주문 → 생산·납품 → 반복 보급과 이익. 조달 목표, 시제품 주문, 계약 한도와 확정 주문을 각각 구분합니다.',
  leading:'프로그램별 실제 예산과 채택, 시제품의 양산 전환, funded backlog 증가, 납품 속도·제품 매출과 현금흐름을 확인합니다.',
  failure:'예산 지연·프로그램 취소·시험 탈락·납기 지연이 나오면 수요 테마보다 해당 계약의 경제성을 먼저 재검토합니다.',
  sources:[{label:'Kopin · 시제품과 제품 매출의 구분',date:'2026-08-10',url:'https://www.kopin.com/press-releases/kopin-corporation-reports-second-quarter-2026-financial-results/'},{label:'AeroVironment · 예산 확정 잔고와 GAAP 손익',date:'2026-09-09',url:'https://investor.avinc.com/news-releases/news-release-details/aerovironment-announces-fiscal-2027-first-quarter-results'}],symbols:['KOPN','AVAV'] },
];
export const BUSINESS_LINKS = {
 ICHR:{name:'Ichor',sector:'semicap',date:'2026-08-04',link:'장비의 가스·화학 공급 시스템과 부품을 공급합니다. 고객 장비 투자가 시스템 주문으로 이어지고 자체 부품 비중이 높아질 때 이익률 개선이 가능합니다.',fact:'2분기 매출 성장 22.7%와 마진 개선은 SEC 10-Q에서 확인됩니다. ATM 발행에 따른 희석도 함께 봐야 합니다.',risk:'고객 투자 둔화·재고 증가·마진 정체·추가 발행',next:'장비 고객 주문과 자체 부품 비중, 발행 후 주당 이익·현금흐름',url:'https://www.sec.gov/Archives/edgar/data/1652535/000165253526000069/ichr-20260626.htm'},
 UCTT:{name:'Ultra Clean',sector:'semicap',date:'2026-08-03',link:'반도체 장비의 핵심 하위 시스템·부품과 세정 서비스를 공급합니다. 설비투자뿐 아니라 장비 가동과 유지보수 수요도 연결고리입니다.',fact:'2분기 회사 발표는 매출 $644.9M과 GAAP 순이익 $8.7M을 보고했습니다. 직전 분기와의 개선이며 전년 동기 성장률로 바꿔 말하지 않습니다.',risk:'장비 고객 의존·투자 지연·GAAP와 조정 이익 차이·운전자금 부담',next:'제품·서비스의 동반 성장과 영업현금흐름, 매출채권·재고',url:'https://www.prnewswire.com/news-releases/ultra-clean-reports-second-quarter-2026-financial-results-302841520.html'},
 POWL:{name:'Powell Industries',sector:'grid',date:'2026-08-03',link:'전기 제어·배전 시스템을 통해 데이터센터 현장 발전과 산업 전력 설비의 병목에 노출됩니다. 수요 기대보다 계약 잔고의 납품·마진 전환이 핵심입니다.',fact:'회사는 회계연도 3분기에 $400M 초과 데이터센터 주문과 $2.4B 잔고를 발표했습니다. 잔고 전체가 데이터센터 주문은 아닙니다.',risk:'대형 프로젝트 집중·납기 및 원가·계약 취소·기대의 주가 선반영',next:'대형 주문의 매출 전환, 계약 조건과 마진·현금 회수',url:'https://powellindustriesinc.gcs-web.com/news-releases/news-release-details/powell-industries-announces-third-quarter-fiscal-2026-results'},
 NVT:{name:'nVent',sector:'grid',date:'2026-07-31',link:'전기 연결·보호와 데이터센터 액체 냉각을 공급합니다. 서버의 전력 밀도가 높아질 때 냉각·전력 인프라의 중요성이 커지는 경로입니다.',fact:'회사는 AI·고성능 컴퓨팅 수요에 대응한 액체 냉각 생산 공간 확대를 발표했습니다. 생산 능력 확대는 확정 고객 주문과 다릅니다.',risk:'설비투자 선행·고객 투자 지연·증설 후 가동률·기대 선반영',next:'실제 냉각 주문·가동률·수익성·현금흐름',url:'https://investors.nvent.com/press-releases/press-release-details/2026/nVent-Expands-Data-Center-Liquid-Cooling-Capacity/default.aspx'},
 KOPN:{name:'Kopin',sector:'defense',date:'2026-08-10',link:'드론 영상과 주변 시야를 함께 보는 광학·디스플레이 기술을 공급합니다. 군용 드론 확대가 매출이 되려면 고객 장비의 시제품 평가를 넘어 양산 채택으로 이어져야 합니다.',fact:'시제품 주문은 확인됐지만 제품 매출 성장은 약 2%였습니다. 영업적자와 소송 담보로 묶인 현금도 있습니다.',risk:'시제품의 양산 전환 실패·소송·자금 소진·희석',next:'확정 주문의 금액·납기와 제품 매출·영업손실 변화',url:'https://www.sec.gov/Archives/edgar/data/771266/000149315226036857/ex99-1.htm'},
 AVAV:{name:'AeroVironment',sector:'defense',date:'2026-09-09',link:'무인체계·정밀타격·대드론 기술을 공급하는 조달 연결 후보입니다. 시제품 중심 업체와 달리 예산이 배정된 계약 잔고를 추적할 수 있습니다.',fact:'회사는 회계연도 2027년 1분기 funded backlog $1.5B를 보고했습니다. GAAP 순손실 $5.1M이 남아 있고 조정 이익과 차이가 있습니다.',risk:'정부 프로그램 취소·납기·인수 통합·조정 이익과 실제 현금의 차이',next:'예산 확정 잔고의 납품 전환과 GAAP·영업현금흐름 개선',url:'https://investor.avinc.com/news-releases/news-release-details/aerovironment-announces-fiscal-2027-first-quarter-results'},
};
const DAY=86400000;
export function sectorStory(id,asOf){const r=SECTOR_STORIES.find(r=>r.id===id);return r&&Date.parse(r.publishedAt)<=Date.parse(asOf)&&Date.parse(asOf)-Date.parse(r.publishedAt)<=r.maxAge*DAY?r:null;}
export function businessLink(ticker,asOf){const r=BUSINESS_LINKS[ticker];return r&&Date.parse(r.date)<=Date.parse(asOf)&&Date.parse(asOf)-Date.parse(r.date)<=180*DAY?r:null;}
export function companyMacro(ticker,asOf){
 const link=businessLink(ticker,asOf);const sector=link&&sectorStory(link.sector,asOf);
 if(sector)return {sector,link};
 const extras={
  FF:{name:'정책·에너지 가격과 바이오연료',date:'2026-08-10',world:'회사는 청정연료 세액공제와 의무 혼합량 관련 규제 명확성이 생산 회복에 영향을 줬다고 설명했습니다. 지정학적 긴장에 따른 에너지 가격 변화는 판매가격뿐 아니라 원료비와 헤지 손익도 움직입니다.',chain:'정책·가격 변화 → 고객 주문과 원료 조달 → 가동률 → 헤지 영향을 분리한 이익·현금흐름. 에너지 가격 상승을 자동적인 수혜로 계산하지 않습니다.',link:'새 화학 고객의 주문과 바이오연료 가동률을 각각 추적해야 합니다.',risk:'원료비·정책 변화·헤지 시점 효과가 회복 이익을 상쇄할 수 있습니다.',next:'원료비 대비 판매가격과 신규 고객의 반복 물량',url:'https://www.sec.gov/Archives/edgar/data/1337298/000143774926026783/ex_966478.htm'},
  KODK:{name:'산업 수요·원자재와 인쇄·소재',date:'2026-08-04',world:'회사는 인쇄·소재의 가격·물량 개선과 은·알루미늄 비용 상승을 함께 보고했습니다. 세계정세가 공급망과 원자재 비용을 흔들 때, 매출 증가만큼 가격 전가와 고객 수요 유지가 중요합니다.',chain:'산업 고객 주문 → 가격·물량 → 원자재 원가 → 본업 마진·현금. 인프라 투자나 원자재 가격 상승을 Kodak의 수주로 직접 연결하지 않습니다.',link:'카메라 브랜드보다 현재 인쇄·소재 사업의 주문과 원가가 핵심입니다.',risk:'가격 인상 후 물량 감소와 원가 상승, 부채·우선주 부담',next:'물량과 가격 효과를 분리한 성장 및 정상 현금 창출',url:'https://investor.kodak.com/news-releases/news-release-details/kodak-reports-second-quarter-2026-financial-results'},
  ARVN:{name:'바이오 자금 환경과 임상·상업화',date:'2026-08-04',world:'금리 하락이나 바이오 투자심리 개선이 생긴다면 장기 개발 사업의 자금 환경에 도움이 될 수 있다는 조건부 해석입니다. 현재 금리 방향이나 섹터 반등을 확정한 사실은 아닙니다. 실제 기업가치는 개별 임상과 계약상 귀속 수익으로 검증해야 합니다.',chain:'자금 환경 → 개발 지속 능력 → 후보별 임상 결과 → 상업화·계약 수익 → 주당 가치. 섹터 자금 유입은 임상 성공이나 후속 자금 조달 불필요의 증거가 아닙니다.',link:'첫 승인 제품과 후속 후보물질을 나눠 평가하며 일회성 라이선스 매출을 반복 판매로 간주하지 않습니다.',risk:'임상 실패·경쟁 약물·상업화 부진·현금 소진',next:'회사 귀속 판매·계약 수익과 후보별 임상 데이터',url:'https://ir.arvinas.com/news-releases/news-release-details/arvinas-reports-second-quarter-2026-financial-results-and'},
 };
 const e=extras[ticker];if(!e||Date.parse(e.date)>Date.parse(asOf)||Date.parse(asOf)-Date.parse(e.date)>180*DAY)return null;
 return {sector:{id:ticker,name:e.name,etfs:[],publishedAt:e.date,reviewedAt:'2026-10-14',headline:e.name,world:e.world,chain:e.chain,leading:e.next,failure:e.risk,sources:[{label:'회사 발표 · 산업 연결은 조건부 해석',date:e.date,url:e.url}],symbols:[ticker]},link:{name:ticker,sector:ticker,date:e.date,link:e.link,fact:'기업 원문과 조건부 산업 해석을 구분합니다.',risk:e.risk,next:e.next,url:e.url}};
}
export function buildSectorRadar({asOf,groups=[],stocks={}}){
 const rank={EARLY:0,BASING:1,NEUTRAL:2,DOWN:3,LEADING:4,LATE:5,UNKNOWN:6};
 return {asOf,method:'산업 원문 검토와 ETF 가격 국면을 결합한 관찰 우선순위. 사업 연결은 원문으로 확인하며 가격 상관만으로 공급망을 추정하지 않습니다. 매수·상승 확률 판정이 아닙니다.',ideas:SECTOR_STORIES.map(s=>sectorStory(s.id,asOf)).filter(Boolean).map(s=>{
   const proxies=s.etfs.map(etf=>groups.find(g=>g.etf===etf)).filter(Boolean);
   const anchor=proxies[0];const phase=anchor?.phase??'UNKNOWN';
   const stance=phase==='EARLY'?'산업 동력·가격 전환 동시 관찰':phase==='BASING'?'수요 동력 확인·가격 전환 대기':phase==='LEADING'||phase==='LATE'?'수요 확대 중·가격 초입 아님':phase==='DOWN'?'수요 가설 유지·하락 전환 위험':'산업 동력 관찰·가격 초입 미확인';
   return {...s,proxies,phase,stance,priority:rank[phase],related:s.symbols.map(ticker=>{
     const link=businessLink(ticker,asOf);if(!link)return null;
     const q=stocks[ticker]??{};const cap=q.marketCap;const hot=Number.isFinite(q.ret63)&&q.ret63>.5||Number.isFinite(q.ret21)&&q.ret21>.3;
     const fresh=q.lastDate&&Number.isFinite(Date.parse(q.lastDate))&&Date.parse(q.lastDate)<=Date.parse(asOf)&&Date.parse(asOf)-Date.parse(q.lastDate)<=4*DAY;
     const warnings=[...(!fresh?['시세 누락·오래됨 — 가격 판단 보류']:[]),...(!Number.isFinite(cap)?['시총 미확인']:cap<1e8||cap>2e9?['EARLY ALPHA 소형주 범위 밖']:[]),...(hot?['이미 급등 — 초입 매수 후보에서 제외']:[])];
     return {ticker,...link,...q,warnings,role:'사업 연결 관찰 후보 · 매수 검증 미완성'};
   }).filter(Boolean)};
 }).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))};
}
