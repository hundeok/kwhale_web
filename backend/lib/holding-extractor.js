const { normalizeSecurityName, normalizeWhitespace } = require('./normalizer');

function splitItems(rawText = '') {
  const text = String(rawText).replace(/\r\n/g, '\n');
  const items = [];
  let buffer = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if ((char === '\n' || char === ';') && depth === 0) {
      if (buffer.trim()) items.push(buffer.trim());
      buffer = '';
    } else {
      buffer += char;
    }
  }
  if (buffer.trim()) items.push(buffer.trim());
  return items.flatMap(line => {
    const result = [];
    let current = '';
    let parenDepth = 0;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
      const rest = line.slice(index + 1);
      const hasCompletedValue = /[\d.]+\s*(주|좌|구|개)(?:\s|\(|$)/.test(current);
      const isDelimiter = char === ',' && /^\s+[^\d\s]/.test(rest) && (parenDepth === 0 || hasCompletedValue);
      if (isDelimiter) {
        if (current.trim()) result.push(current.trim());
        current = '';
        while (line[index + 1] === ' ') index++;
      } else {
        current += char;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result;
  });
}

function parseQuantity(text, unitPattern) {
  const match = text.match(new RegExp(`([\\d,.]+)\\s*(${unitPattern})(?:\\s|\\(|$)`));
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function parseChange(text, unitPattern) {
  const match = text.match(new RegExp(`\\(([\\d,.]+)\\s*(${unitPattern})?\\s*(증가|감소|신규)\\)`));
  if (!match) return { changeQuantity: null, changeType: null };
  const value = Number(match[1].replace(/,/g, ''));
  return {
    changeQuantity: Number.isFinite(value) ? value : null,
    changeType: match[3] === '감소' ? 'DECREASED' : match[3] === '신규' ? 'ACQUIRED' : 'INCREASED'
  };
}

function extractSecurityHoldings(rawText, assetValuation) {
  const items = splitItems(rawText).map(sourceText => {
    const instrument = normalizeSecurityName(sourceText);
    const change = parseChange(sourceText, '주|좌|구');
    return {
      sourceText,
      canonicalName: instrument.name,
      ticker: instrument.ticker,
      quantity: parseQuantity(sourceText, '주|좌|구'),
      ...change,
      confidence: instrument.confidence
    };
  }).filter(item => item.canonicalName);

  return items.map(item => ({
    ...item,
    declaredValuation: items.length === 1 ? BigInt(assetValuation ?? 0) : null,
    allocationMethod: items.length === 1 ? 'SINGLE_INSTRUMENT_ASSET' : 'UNALLOCATED_MULTI_INSTRUMENT'
  }));
}

function extractCryptoHoldings(rawText, assetValuation) {
  const items = splitItems(rawText).map(sourceText => {
    const ticker = sourceText.match(/\(([A-Z0-9.-]{2,12})\)/)?.[1] ?? null;
    const change = parseChange(sourceText, '개');
    let canonicalName = normalizeWhitespace(String(sourceText).normalize('NFKC'))
      .replace(/^(가상자산|암호화폐|코인)\s*/, '')
      .replace(/\([A-Z0-9.-]{2,12}\)/, '')
      .replace(/\s+[\d,.]+\s*개(?:\s|\(|$).*$/, '')
      .trim();
    const cryptoAliases = {
      BTC: '비트코인',
      비트코인: '비트코인',
      BITCOIN: '비트코인',
      ETH: '이더리움',
      이더리움: '이더리움',
      ETHEREUM: '이더리움',
      XRP: '리플',
      리플: '리플',
      엑스알피: '리플',
      엑스알피리플: '리플',
      RIPPLE: '리플',
      SOL: '솔라나',
      솔라나: '솔라나',
      SOLANA: '솔라나',
      DOGE: '도지코인',
      도지코인: '도지코인',
    };
    const aliasKey = (ticker || canonicalName).toUpperCase().replace(/[\s()._-]/g, '');
    canonicalName = cryptoAliases[aliasKey] || canonicalName;
    return {
      sourceText,
      canonicalName,
      ticker,
      quantity: parseQuantity(sourceText, '개'),
      ...change,
      confidence: canonicalName ? (ticker ? 0.95 : 0.75) : 0
    };
  }).filter(item => item.canonicalName);
  return items.map(item => ({
    ...item,
    declaredValuation: items.length === 1 ? BigInt(assetValuation ?? 0) : null,
    allocationMethod: items.length === 1 ? 'SINGLE_INSTRUMENT_ASSET' : 'UNALLOCATED_MULTI_INSTRUMENT'
  }));
}

module.exports = { splitItems, parseQuantity, parseChange, extractSecurityHoldings, extractCryptoHoldings };
