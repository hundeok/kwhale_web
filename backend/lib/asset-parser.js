const { normalizeWhitespace, normalizeCategory, normalizeOwner } = require('./normalizer');
const { extractSecurityHoldings, extractCryptoHoldings } = require('./holding-extractor');

function numberValue(raw) {
  if (raw === null || raw === undefined) return null;
  const value = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function splitMoneyItems(rawText = '') {
  const text = String(rawText).replace(/\r\n/g, '\n');
  const result = [];
  let current = '';
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    const rest = text.slice(index + 1);
    const currentLooksComplete = /-?[\d,]+\s*(?:천원)?(?:\([\d,]+\s*(?:증가|감소|신규)?\s*\))?\s*$/.test(current);
    const commaDelimiter = char === ',' && depth === 0 &&
      /^\s+[^\d\s]/.test(rest) && currentLooksComplete;
    const lineDelimiter = (char === '\n' || char === ';') && depth === 0;
    if (commaDelimiter || lineDelimiter) {
      if (current.trim()) result.push(current.trim());
      current = '';
      while (text[index + 1] === ' ') index += 1;
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function parseMoneyComponents(detail = '', unitMultiplier = 1000) {
  return splitMoneyItems(detail).map(sourceText => {
    const match = sourceText.match(
      /^(.*?)\s+(-?[\d,]+)(?:\s*천원)?(?:\(([\d,]+)\s*(증가|감소|신규)?\s*\))?$/
    );
    if (!match) {
      return { sourceText, name: normalizeWhitespace(sourceText), amount: null, changeAmount: null, changeType: null, confidence: 0.25 };
    }
    const amount = numberValue(match[2]);
    const change = numberValue(match[3]);
    return {
      sourceText,
      name: normalizeWhitespace(match[1]),
      amount: amount === null ? null : BigInt(Math.round(amount * unitMultiplier)),
      changeAmount: change === null ? null : BigInt(Math.round(change * unitMultiplier)),
      changeType: match[4] === '감소' ? 'DECREASED'
        : match[4] === '신규' ? 'ACQUIRED'
          : match[4] === '증가' ? 'INCREASED'
            : null,
      confidence: 0.95
    };
  });
}

function parseRealEstate(detail = '', subType = '') {
  const text = normalizeWhitespace(detail);
  const areas = [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*㎡/g)].map(match => numberValue(match[1]));
  const lotNumber = text.match(/(?:산\s*)?\d+(?:-\d+)?번지/)?.[0] ?? null;
  const share = text.match(/([\d,]+(?:\.\d+)?)㎡\s*중\s*([\d,]+(?:\.\d+)?)㎡/);
  return {
    addressText: text.replace(/\s+[\d,]+(?:\.\d+)?㎡(?:\s*중\s*[\d,]+(?:\.\d+)?㎡)?(?:\s.*)?$/, '').trim() || text,
    lotNumber,
    propertyType: normalizeWhitespace(subType) || null,
    totalAreaSqm: share ? numberValue(share[1]) : (areas[0] ?? null),
    ownedAreaSqm: share ? numberValue(share[2]) : (areas.at(-1) ?? null),
    confidence: areas.length ? 0.9 : 0.6
  };
}

function parseVehicle(detail = '') {
  const text = normalizeWhitespace(detail);
  return {
    modelYear: numberValue(text.match(/(\d{4})년식/)?.[1]),
    model: text.replace(/^\d{4}년식\s*/, '').replace(/\s*배기량.*$/, '').trim() || null,
    displacementCc: numberValue(text.match(/배기량\(?([\d,]+)cc\)?/)?.[1]),
    confidence: /\d{4}년식/.test(text) ? 0.9 : 0.55
  };
}

function parseAssetRecord(asset) {
  const category = normalizeCategory(asset.type || asset.category);
  const owner = normalizeOwner(asset.owner);
  const base = {
    sourceText: asset.detail || '',
    category,
    owner,
    valuation: BigInt(asset.valuation || 0),
    difference: asset.difference === undefined || asset.difference === null
      ? null
      : BigInt(asset.difference)
  };
  if (category.category === '증권') return { ...base, components: extractSecurityHoldings(asset.detail, asset.valuation) };
  if (category.category === '가상자산') return { ...base, components: extractCryptoHoldings(asset.detail, asset.valuation) };
  if (category.category === '예금·보험' || category.category === '채무' || category.category === '채권') {
    const components = parseMoneyComponents(asset.detail);
    if (components.length === 1 && components[0].amount === null && asset.valuation !== undefined) {
      components[0] = {
        ...components[0],
        amount: BigInt(asset.valuation || 0),
        allocationMethod: 'SINGLE_COMPONENT_ASSET_VALUATION',
        confidence: 0.85
      };
    }
    return { ...base, components };
  }
  if (category.category === '현금') {
    return {
      ...base,
      components: [{
        sourceText: asset.detail || '현금',
        name: normalizeWhitespace(asset.detail) || '현금',
        amount: BigInt(asset.valuation || 0),
        changeAmount: asset.difference === undefined || asset.difference === null
          ? null
          : BigInt(asset.difference),
        changeType: null,
        allocationMethod: 'DIRECT_ASSET_VALUATION',
        confidence: 1,
      }],
    };
  }
  if (category.category === '건물' || category.category === '토지') {
    return { ...base, realEstate: parseRealEstate(asset.detail, asset.subType) };
  }
  if (category.category === '자동차·선박·기타동산' && asset.subType?.includes('자동차')) {
    return { ...base, vehicle: parseVehicle(asset.detail) };
  }
  return base;
}

module.exports = {
  numberValue,
  splitMoneyItems,
  parseMoneyComponents,
  parseRealEstate,
  parseVehicle,
  parseAssetRecord
};
