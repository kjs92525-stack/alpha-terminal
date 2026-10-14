const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function equityScenario({price,marketCap,revenue,netMargin,pe,shareGrowth=0}){
 if(![price,marketCap,revenue,netMargin,pe].every(positive)||!Number.isFinite(shareGrowth)||shareGrowth<0||netMargin>1)return null;
 const profit=revenue*netMargin;const fairPrice=price*(profit*pe/marketCap)/(1+shareGrowth);
 if(!positive(fairPrice)||!positive(profit))return null;
 return {profit,fairPrice,upside:fairPrice/price-1,safetyMargin:1-price/fairPrice,assumptionOnly:true};
}
export function positionRisk({balance,riskPercent,entry,stop,openRisk=0,sectorExposure=0,portfolioLimit=2,sectorLimit=25,adv20=null,cashAvailable=balance}){
 if(![balance,riskPercent,entry,stop,portfolioLimit,sectorLimit].every(positive)||stop>=entry||riskPercent>100||portfolioLimit>100||sectorLimit>100||![openRisk,sectorExposure].every(v=>Number.isFinite(v)&&v>=0))return {valid:false,reason:'계좌·진입·손절·기존 노출을 확인하세요. 손절은 진입가보다 낮아야 합니다.'};
 if(!Number.isFinite(cashAvailable)||cashAvailable<0||cashAvailable>balance)return {valid:false,reason:'사용 가능한 현금은 0 이상이고 계좌 총자산 이하여야 합니다.'};
 const budget=Math.min(balance*(riskPercent/100),balance*(portfolioLimit/100)-openRisk);
 const remaining=balance*(sectorLimit/100)-sectorExposure;
 if(budget<=0||remaining<=0)return {valid:false,reason:'전체 손실 한도 또는 같은 산업 노출 한도를 이미 소진했습니다.'};
 const quantity=Math.floor(Math.min(budget/(entry-stop),cashAvailable/entry,remaining/entry,positive(adv20)?adv20*.01/entry:Infinity));
 if(!Number.isSafeInteger(quantity)||quantity<1)return {valid:false,reason:'설정한 현금·손실·노출·유동성 한도에서 계산 가능한 수량이 없습니다.'};
 const cost=quantity*entry,loss=quantity*(entry-stop);
 return {valid:true,quantity,cost,loss,portfolioRiskPercent:(openRisk+loss)/balance*100,sectorPercent:(sectorExposure+cost)/balance*100,
 gapStressLoss:quantity*(entry-stop*.9),liquidityKnown:positive(adv20),assumptionOnly:true};
}
