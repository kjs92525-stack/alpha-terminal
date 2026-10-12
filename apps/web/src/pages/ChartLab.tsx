import { useState } from 'react';
import { useTerminal } from '../lib/store';
import { ChartWorkspace } from '../components/ChartWorkspace';
import { PanelHead } from '../components/ui';

export function ChartLab() {
  const { selected, select, universe } = useTerminal();
  const [compare, setCompare] = useState('');
  return (
    <>
      <section className="panel">
        <PanelHead kicker="CHART LAB" title={`Technical Intelligence · ${selected}`} right={
          <div className="symbol-picker">
            <select value={selected} onChange={(e) => select(e.target.value)} aria-label="종목">{[...new Set([selected, ...universe])].map((s) => <option key={s}>{s}</option>)}</select>
            <select value={compare} onChange={(e) => setCompare(e.target.value)} aria-label="비교 종목"><option value="">비교 차트 없음</option>{universe.filter((s) => s !== selected).map((s) => <option key={s}>{s}</option>)}</select>
          </div>
        } />
        <ChartWorkspace symbol={selected} full />
      </section>
      {compare && (
        <section className="panel" style={{ marginTop: 12 }}>
          <PanelHead kicker="COMPARE" title={compare} />
          <ChartWorkspace symbol={compare} height={380} />
        </section>
      )}
      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="DEFINITIONS" title="신호 정의와 미래 데이터 사용 규칙" />
        <div className="method-grid">
          <div><b>스윙 피벗</b><p>좌우 3봉보다 높은 고점/낮은 저점. 오른쪽 3봉이 마감돼야 확정 → 확정 봉 = 피벗 + 3.</p></div>
          <div><b>BOS / CHoCH</b><p>확정된 최근 스윙을 <u>종가</u>로 돌파. 기존 구조 방향이면 BOS, 반대 방향 첫 돌파면 CHoCH.</p></div>
          <div><b>FVG</b><p>3캔들 갭: 3번째 봉 저가 &gt; 1번째 봉 고가(상방). 3번째 봉 마감 시 확정, 가격이 갭을 완전히 통과하면 충족.</p></div>
          <div><b>Order Block</b><p>구조 돌파 직전 마지막 반대색 캔들. 돌파 확정 시점에 확정, 가격 재진입 시 소진.</p></div>
          <div><b>VWAP</b><p>분/시간봉: 뉴욕 세션마다 초기화. 일/주봉: 표시 구간 시작점 앵커드 VWAP.</p></div>
          <div><b>거래량 프로파일</b><p>각 봉의 거래량을 고가–저가 범위에 균등 분배한 근사치(틱 데이터 아님). POC와 70% 가치영역 표시.</p></div>
        </div>
        <p className="footnote pad">진행 중인 마지막 봉에서 발생한 신호는 회색 “?”로 표시되며 확정 신호가 아닙니다.</p>
      </section>
    </>
  );
}
