// Reviewed weekly report, deliberately independent of price-based cycle scores.
// Do not infer fund subscriptions from ETF returns, turnover, or AUM changes.
export const FLOW_REPORT = {
 periodStart:'2026-10-05',periodEnd:'2026-10-09',publishedAt:'2026-10-13',reviewedAt:'2026-10-15',expiresAt:'2026-10-20',
 source:'Seeking Alpha / TradingView · ETF Database 집계 인용',
 url:'https://www.tradingview.com/news/seekingalpha:e8a4773bd094b:0-weekly-etfs-all-11-sectors-record-inflows-gold-leads-outflows/',
 quality:'보도 집계 · ETF Database 원천 시계열 직접 대조 미완료',
 rows:[['XLK','기술',1500],['XLE','에너지',737.06],['XLC','커뮤니케이션',667.35],['XLU','유틸리티',636.62],['XLF','금융',492.86],['XLI','산업재',301.29],['XLP','필수소비재',288.03],['XLV','헬스케어',278.44],['XLY','경기소비재',138.09],['XLRE','부동산',45.06],['XLB','소재',14.83]].map(([etf,name,netMillions])=>({etf,name,netMillions}))
};
const eia={label:'EIA · 10월 전망 (예측)',date:'2026-10-06',url:'https://www.eia.gov/outlooks/steo/archives/oct26.pdf'};
export const FLOW_STORIES = {
 XLK:{headline:'AI 투자가 칩을 넘어 전력·냉각 장비 주문으로 이어지는가',
 story:'더 많은 연산을 한 랙에 집약하면 전력 밀도와 제거해야 할 열이 커집니다. 공랭만으로 목표 온도를 유지하기 어려운 설계에서는 칩·랙 가까이에 액체 냉각을 붙이고 전원 장비도 바꿔야 합니다. 이것이 냉각·전력 인프라의 투자 논리입니다. 다만 AI 성능 향상 자체가 전력 소비의 무조건적 증가를 뜻하지는 않습니다. 효율 개선과 실제 설치 대수·가동률을 함께 봐야 합니다.',
 evidence:'Vertiv는 3월 30일 액체 냉각·냉수 시스템 생산 확대를 발표했습니다. 증설 가동 목표는 2027년 2분기입니다. 이는 공급 능력 계획이며 신규 수주 확정과 다릅니다.',
 profits:'설계 채택 → 확정 발주 → 생산·납품 → 유지보수로 연결돼야 매출이 됩니다. 자체 기술·서비스 비중이 높아져도 증설비·원가·보증 비용이 더 빨리 늘면 주당 현금흐름은 개선되지 않을 수 있습니다.',
 check:'고객 설비투자 대비 실제 주문, 취소 조건, 잔고의 납품 전환, 영업마진과 영업현금흐름을 확인합니다. 현재 기업별 밸류에이션 대조는 미완료이므로 성장의 선반영 정도는 미판정입니다.',
 failure:'클라우드 수익화 지연, 자금조달 비용 상승, 전력 인입 지연으로 고객이 투자를 미루거나 냉각 단가·마진이 떨어지면 가설을 낮춥니다.',
 related:'VRT: 냉각·전원 공급, NVT: 전기 보호·냉각, POWL: 배전·제어. 사업 연결 관찰 예시이며 XLK 구성종목 목록이나 바닥권 추천이 아닙니다.',
 sources:[{label:'Vertiv · 냉각 생산 증설 계획',date:'2026-03-30',url:'https://www.vertiv.com/en-us/about/news-and-events/corporate-news/2026/vertiv-to-expand-ohio-manufacturing-to-boost-u.s.-production-of-critical-thermal-management-technologies-for-ai-data-centers/'}]},
 XLE:{headline:'공급 차질로 생긴 에너지 강세와 수요 성장을 구별해야 한다',
 story:'원유·연료의 공급과 운송이 막히면 재고가 줄고 가격이 오를 수 있습니다. 생산업체에는 판매 단가 상승이 이익 기회지만, 소비자에게는 비용 상승이어서 결국 수요를 깎습니다. 따라서 전쟁이 길어질수록 에너지 기업이 모두 좋아진다는 단순한 스토리는 성립하지 않습니다.',
 evidence:'IEA의 10월 보고서는 공급 제약과 동시에 2026년 세계 석유 수요 감소를 전망했습니다. 공급 부족에 따른 가격 지지와 고유가에 따른 수요 파괴가 함께 존재합니다.',
 profits:'상류 생산은 실현 유가·생산량에서 채굴비·세금·투자를 뺀 현금이 핵심입니다. 정유는 원유 가격 자체보다 제품과 원유의 가격 차이, 가동률이 중요하고, 운송은 계약·물량 구조가 중요합니다.',
 check:'주간 재고, 수출·운송 정상화, 제품 수요, 정제마진, 기업별 손익분기 유가와 부채를 구분해 확인합니다. 현물 고유가를 영구 이익으로 환산하지 말고 정상화 가격에서도 현금이 남는지 봅니다.',
 failure:'공급 회복·휴전, 경기 둔화, 정제마진 축소, 생산 중단·운송 비용 증가가 나타나면 높은 유가와 주주 수익의 연결이 끊길 수 있습니다.',
 related:'우선 XLE로 대형 에너지 기업 집합을 관찰합니다. 생산·정유·운송을 같은 수혜로 묶어 개별 소형주를 자동 추천하지 않습니다.',
 sources:[eia,{label:'IEA · 10월 석유시장 보고서 (예측)',date:'2026-10-14',url:'https://www.iea.org/reports/oil-market-report-october-2026'}]},
 XLC:{headline:'광고·클라우드의 AI 수익화가 막대한 인프라 지출을 회수할까',
 story:'AI가 검색·추천의 품질을 높이고 광고주 전환율을 개선하면 광고 단가와 예산을 끌어올릴 수 있습니다. 기업이 AI 서비스를 실제 업무에 쓰면 클라우드 사용량도 늘 수 있습니다. 반면 응답 한 번의 추론 비용과 데이터센터 감가상각이 증가합니다. 이용자 증가만으로 이익 개선을 단정할 수 없는 이유입니다.',
 evidence:'Alphabet의 2026년 2분기 10-Q는 클라우드 영업이익 증가와 상반기 설비투자 확대를 함께 보고했습니다. 수요 성장과 자본 부담을 동시에 확인해야 하는 사례입니다.',
 profits:'검색·광고 매출과 클라우드 계약 → 이용량·매출 → 추론·전력·감가상각을 차감한 영업이익 → 설비투자 차감 후 현금흐름으로 검증합니다. 평가이익은 본업 현금과 분리합니다.',
 check:'광고 전환율·단가, 유료 사용량, 클라우드 잔고의 매출 전환, CapEx/매출과 잉여현금흐름, 주식 보상·발행 후 주당 수치를 봅니다. ETF 유입만으로 이익 회수 속도는 알 수 없습니다.',
 failure:'검색 점유율 하락, 광고 경기 둔화, 규제·반독점 조치, 투자액이 매출보다 더 빨리 늘면 가설이 약해집니다.',
 related:'GOOGL은 사업 구조를 확인할 대표 사례입니다. 대형 플랫폼의 유입을 적자 AI 소형주 전체의 수혜로 확대하지 않습니다.',
 sources:[{label:'Alphabet · 2026년 2분기 10-Q',date:'2026-07-23',url:'https://www.sec.gov/Archives/edgar/data/1652044/000165204426000071/goog-20260630.htm'}]},
 XLU:{headline:'전력 수요가 늘어도 모든 유틸리티의 이익이 같은 속도로 늘지는 않는다',
 story:'데이터센터는 서버를 설치해도 전력 연결이 없으면 가동할 수 없습니다. 지역별 발전·송배전 부족이 연결 투자와 장기 공급 계약을 유발할 수 있습니다. 그러나 전력 수요가 늘었다는 사실과 주주에게 돌아오는 수익은 다릅니다. 규제 유틸리티는 투자비를 요금과 허용 수익률에 반영하는 승인이 필요합니다.',
 evidence:'EIA 10월 전망은 데이터센터가 포함된 상업 부문의 2027년 전력 수요 증가를 예상합니다. 동시에 지역별 도매가격 차이와 일부 지역의 2027년 가격 하락도 전망합니다. 전국 공통의 전력 가격 급등 가정은 부적절합니다.',
 profits:'신규 연결 계약 → 발전·송배전 투자 → 요금 기반 편입·허용 수익률 → 자금조달 비용 차감 후 주당 이익으로 연결됩니다. 비규제 발전사는 계약 가격·발전 비용·헤지 비중으로 따로 분석해야 합니다.',
 check:'접속 대기 신청과 확정 계약을 구분하고, 최소 사용량·취소 위약금, 규제 승인, 만기 차입금·이자 비용, 증자 후 주당 이익을 확인합니다.',
 failure:'고객의 프로젝트 취소, 규제 승인 지연, 금리 상승, 비용 초과 또는 증자로 늘어난 주식 수가 이익 성장을 상쇄하면 전력 수요 증가만으로 투자 논리가 성립하지 않습니다.',
 related:'XLU로 규제·비규제 사업 비중을 먼저 확인합니다. POWL·NVT 같은 장비 공급사는 유틸리티와 다른 사업이며 위 산업 스토리에서 별도로 봅니다.',sources:[eia]}
};
export function sectorFlowReport(now=new Date().toISOString().slice(0,10)) {
 const valid=/^\d{4}-\d{2}-\d{2}$/.test(now)&&Number.isFinite(Date.parse(now));
 const status=!valid||now<FLOW_REPORT.reviewedAt?'unavailable':now>FLOW_REPORT.expiresAt?'expired':'reviewed';
 return {...FLOW_REPORT,status,rows:status==='reviewed'?FLOW_REPORT.rows.map(r=>({...r,story:FLOW_STORIES[r.etf]??null})):[]};
}
