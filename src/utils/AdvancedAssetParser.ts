export interface ParsedAsset {
  originalString: string;
  assetName: string;
  tags: { text: string; color: string; type: string }[];
}

export class AdvancedAssetParser {
  static parse(rawText: string, category: string): ParsedAsset[] {
    if (!rawText) return [];
    
    // 1. 숫자 주변 줄바꿈 복원 (PDF OCR 에러 보정)
    const cleanText = rawText.replace(/(\d)\s*[\n\r]+\s*(\d)/g, '$1,$2');
    
    // 2. 괄호 안의 쉼표 보호 파싱
    const items: string[] = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (depth < 0) depth = 0;
      
      if (char === '\n' || char === '\r') {
        if (current.trim()) items.push(current.trim());
        current = '';
      } else if (char === ',' && cleanText[i+1] === ' ' && depth === 0) {
        if (current.trim()) items.push(current.trim());
        current = '';
        i++; 
      } else {
        current += char;
      }
    }
    if (current.trim()) items.push(current.trim());
    
    // 3. 항목별 휴리스틱 초정밀 분석 (Pro-Level)
    return items.map(item => this.parseSingleItem(item, category));
  }

  private static parseSingleItem(text: string, category: string): ParsedAsset {
    let mainText = text;
    let changeText = '';
    const tags: { text: string; color: string; type: string }[] = [];

    // [Step 1] 변동사유 추출 "(50,000 감소)"
    const changeMatch = mainText.match(/(.+?)\s*\(([^)]*(?:증가|감소|유지|신규|해지|매도|매수)[^)]*)\)$/);
    if (changeMatch) {
      mainText = changeMatch[1].trim();
      changeText = changeMatch[2].trim();
    }

    // [Step 2] 단위(천원) 자동 주입 로직
    if ((category.includes('예금') || category.includes('채무')) && mainText.match(/[\d,]+$/)) {
      mainText = mainText.replace(/([\d,]+)$/, '$1천원');
    }

    // [Step 3] 도메인 특화 휴리스틱 (Domain-specific Heuristics)
    if (category.includes('자동차')) {
      // e.g. "2020년식 벤츠 E300(배기량 1991cc)"
      const yearMatch = mainText.match(/(\d{4}년식)/);
      if (yearMatch) {
        tags.push({ text: yearMatch[1], color: '#d946ef', type: 'year' });
        mainText = mainText.replace(yearMatch[1], '').trim();
      }
      const ccMatch = mainText.match(/배기량\s*([\d,]+cc)/);
      if (ccMatch) {
        tags.push({ text: ccMatch[1], color: '#8b5cf6', type: 'cc' });
        mainText = mainText.replace(/\(?배기량\s*[\d,]+cc\)?/, '').trim();
      }
    } else if (category.includes('증권')) {
      // e.g. "비상장주식 카카오게임즈 50주"
      const qtyMatch = mainText.match(/\s+([\d,.]+(?:주|개|좌))$/);
      if (qtyMatch) {
        tags.push({ text: qtyMatch[1], color: 'var(--accent-gold)', type: 'quantity' });
        mainText = mainText.replace(qtyMatch[0], '').trim();
      }
      if (mainText.includes('비상장')) {
        tags.push({ text: '비상장', color: '#f97316', type: 'status' });
        mainText = mainText.replace('비상장주식', '').replace('비상장', '').trim();
      } else if (mainText.includes('상장')) {
        tags.push({ text: '상장', color: '#3b82f6', type: 'status' });
        mainText = mainText.replace('상장주식', '').replace('상장', '').trim();
      }
      const nationMatch = mainText.match(/미국|일본|홍콩|중국/);
      if (nationMatch) {
        tags.push({ text: nationMatch[0], color: '#ef4444', type: 'nation' });
      }
    } else if (category.includes('예금') || category.includes('채무')) {
      // e.g. "신한은행(마이너스통장) 50,000천원"
      const bankMatch = mainText.match(/^([가-힣a-zA-Z]+은행|[가-힣a-zA-Z]+증권|[가-힣a-zA-Z]+생명|[가-힣]+농협|[가-힣]+수협|[가-힣a-zA-Z]+보험)/);
      if (bankMatch) {
        tags.push({ text: bankMatch[1], color: category.includes('채무') ? '#ef4444' : '#10b981', type: 'bank' });
        mainText = mainText.replace(bankMatch[1], '').trim();
      }
      const minusMatch = mainText.match(/\(?마이너스통장\)?|\(?대출\)?/);
      if (minusMatch) {
        tags.push({ text: '대출/마이너스', color: '#ef4444', type: 'warning' });
        mainText = mainText.replace(minusMatch[0], '').trim();
      }
      const currencyMatch = mainText.match(/\((USD|EUR|JPY|외화)\)/);
      if (currencyMatch) {
        tags.push({ text: '외환', color: '#6366f1', type: 'currency' });
      }
    } else if (category.includes('건물') || category.includes('토지')) {
      // e.g. "서울특별시 강남구 압구정동 아파트 114.23㎡"
      const areaMatch = mainText.match(/([\d,.]+(?:㎡|평))/);
      if (areaMatch) {
        tags.push({ text: areaMatch[1], color: '#06b6d4', type: 'area' });
        mainText = mainText.replace(areaMatch[1], '').trim();
      }
      const typeMatch = mainText.match(/(아파트|다세대주택|단독주택|오피스텔|상가|복합건물|전세권|임차권)/);
      if (typeMatch) {
        tags.push({ text: typeMatch[1], color: '#3b82f6', type: 'realestate_type' });
      }
    } else if (category.includes('가상자산')) {
      // "비트코인(BTC) 2.54개"
      const coinQty = mainText.match(/\s+([\d,.]+개)$/);
      if (coinQty) {
        tags.push({ text: coinQty[1], color: '#f59e0b', type: 'quantity' });
        mainText = mainText.replace(coinQty[0], '').trim();
      }
      const ticker = mainText.match(/\(([A-Z]{2,6})\)/);
      if (ticker) {
        tags.push({ text: ticker[1], color: '#6366f1', type: 'ticker' });
      }
    }

    // [Step 4] 정제
    // 자산명 자체의 괄호형 별칭(예: 엑스알피(리플))은 보존한다.
    mainText = mainText.replace(/^[,\s]+|[,\s]+$/g, ''); // trim
    mainText = mainText.replace(/\s+/g, ' '); // 띄어쓰기 교정

    // [Step 5] 변동사유 태깅
    if (changeText) {
      if (changeText.match(/^[\d,]+$/)) changeText += '천원 변동'; // 단순 숫자만 있으면
      changeText = changeText.replace(/^([\d,]+)\s*(증가|감소)$/, '$1천원 $2');
      let color = 'var(--text-muted)';
      if (changeText.includes('증가') || changeText.includes('신규') || changeText.includes('매수')) color = '#ef4444';
      if (changeText.includes('감소') || changeText.includes('해지') || changeText.includes('매도')) color = '#3b82f6';
      
      tags.push({ text: changeText, color, type: 'change' });
    }

    return {
      originalString: text,
      assetName: mainText || text,
      tags
    };
  }
}
