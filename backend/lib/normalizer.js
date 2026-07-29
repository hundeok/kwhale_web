const crypto = require('crypto');
const taxonomy = require('../data/category-taxonomy.json');

const PARSER_VERSION = '2.2.0';

const SECURITY_ALIASES = new Map([
  ['에스케이하이닉스', 'SK하이닉스'],
  ['에스케이 하이닉스', 'SK하이닉스'],
  ['SK하이닉스보통주', 'SK하이닉스'],
  ['중소기업은행', 'IBK기업은행'],
  ['기업은행', 'IBK기업은행'],
  ['APPLEINC', '애플'],
  ['APPLECOMINC', '애플'],
  ['NVIDIA', '엔비디아'],
  ['NVIDIACORP', '엔비디아'],
  ['한국조선해양', 'HD한국조선해양'],
  ['삼성전자보통주', '삼성전자'],
  ['테슬라모터스', '테슬라'],
  ['TESLA', '테슬라'],
  ['AMAZONCOMINC', '아마존'],
  ['AMAZON.COMINC', '아마존'],
  ['ALPHABETINCCLASSA', '알파벳A'],
]);

function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeCategory(raw = '') {
  const value = normalizeWhitespace(raw);
  const rule = taxonomy.rules.find(({ match }) => match.some(token => value.includes(token)));
  return {
    raw: value,
    group: rule?.group ?? taxonomy.fallback.group,
    category: rule?.category ?? taxonomy.fallback.category,
    confidence: rule ? 1 : 0.25,
    taxonomyVersion: taxonomy.version
  };
}

function parseKrwAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number') return BigInt(Math.round(raw));

  const text = normalizeWhitespace(raw).replace(/[₩원,\s]/g, '');
  const sign = text.startsWith('-') ? -1n : 1n;
  const unsigned = text.replace(/^[+-]/, '');
  const match = unsigned.match(/^(\d+(?:\.\d+)?)(조|억|만|천원|천)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  const multiplier = {
    조: 1_000_000_000_000,
    억: 100_000_000,
    만: 10_000,
    천원: 1_000,
    천: 1_000
  }[match[2]] ?? 1;
  return sign * BigInt(Math.round(value * multiplier));
}

function classifyChange(text = '') {
  const value = normalizeWhitespace(text);
  if (/(신규|취득|매수|상속|증여받)/.test(value)) return 'ACQUIRED';
  if (/(매도|처분|해지|상환|증여함)/.test(value)) return 'DISPOSED';
  if (/증가/.test(value)) return 'INCREASED';
  if (/감소/.test(value)) return 'DECREASED';
  return 'UNCHANGED_OR_UNKNOWN';
}

function normalizeOwner(raw = '') {
  const value = normalizeWhitespace(raw);
  if (!value) return { value: '미상', relationship: 'UNKNOWN', confidence: 0 };
  if (value === '본인') return { value, relationship: 'SELF', confidence: 1 };
  if (value.includes('배우자')) return { value, relationship: 'SPOUSE', confidence: 1 };
  if (/(장남|차남|아들)/.test(value)) return { value, relationship: 'SON', confidence: 0.9 };
  if (/(장녀|차녀|딸)/.test(value)) return { value, relationship: 'DAUGHTER', confidence: 0.9 };
  if (value.includes('부')) return { value, relationship: 'FATHER', confidence: 0.8 };
  if (value.includes('모')) return { value, relationship: 'MOTHER', confidence: 0.8 };
  return { value, relationship: 'OTHER', confidence: 0.6 };
}

function normalizeSecurityName(raw = '') {
  let value = normalizeWhitespace(String(raw).normalize('NFKC'))
    .replace(/^(상장주식|비상장주식|해외주식|국내주식|주식|증권|채권)\s*/, '')
    .replace(/\s*\(?[\d,.]+\s*(주|좌|구)(?:\s|\(|$).*$/, '')
    .replace(/\((?:미국|일본|홍콩|중국|국내|해외)\)/g, '')
    .trim();
  const ticker = value.match(/\(([A-Z0-9.-]{1,10})\)/)?.[1] ?? null;
  value = value.replace(/\([A-Z0-9.-]{1,10}\)/, '').trim();
  value = value
    .replace(/^(주식회사|㈜|\(주\)|주\)|회사)\s*/i, '')
    .replace(/\s*(주식회사|㈜|\(주\))$/i, '')
    .replace(/(?:보통주|보통주식)$/, '')
    .replace(/\s+(증가|감소|신규)$/, '')
    .replace(/[_·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = value
    .replace(/\btiger\b/ig, 'TIGER')
    .replace(/\bkodex\b/ig, 'KODEX')
    .replace(/\brise\b/ig, 'RISE')
    .replace(/\bnaver\b/ig, 'NAVER')
    .replace(/\bcj\s*enm\b/ig, 'CJ ENM')
    .replace(/\blg(?=[A-Z가-힣])/ig, 'LG')
    .replace(/\bsk(?=[A-Z가-힣])/ig, 'SK');
  if (!ticker && /^[\x20-\x7E]+$/.test(value) && /[A-Za-z]/.test(value)) {
    value = value.toUpperCase();
  }
  const aliasKey = value.toUpperCase().replace(/[\s.]/g, '');
  value = SECURITY_ALIASES.get(value) ?? SECURITY_ALIASES.get(aliasKey) ?? value;
  return {
    name: value,
    ticker,
    confidence: value ? (ticker ? 0.95 : SECURITY_ALIASES.has(aliasKey) ? 0.95 : 0.82) : 0
  };
}

function rowHash(record) {
  const stable = [
    record.disclosureId,
    normalizeWhitespace(record.officialName),
    normalizeWhitespace(record.agency),
    normalizeWhitespace(record.ownerRaw),
    normalizeWhitespace(record.categoryRaw),
    normalizeWhitespace(record.detailRaw),
    normalizeWhitespace(record.amountRaw)
  ].join('|');
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function calculateTotals(assets) {
  let grossAssets = 0n;
  let liabilities = 0n;
  for (const asset of assets) {
    const amount = BigInt(asset.amount ?? asset.valuation ?? 0);
    const normalized = normalizeCategory(asset.categoryRaw ?? asset.category);
    if (normalized.group === '부채') liabilities += amount < 0n ? -amount : amount;
    else if (amount > 0n) grossAssets += amount;
  }
  return { grossAssets, liabilities, netWorth: grossAssets - liabilities };
}

module.exports = {
  PARSER_VERSION,
  normalizeWhitespace,
  normalizeCategory,
  parseKrwAmount,
  classifyChange,
  normalizeOwner,
  normalizeSecurityName,
  rowHash,
  calculateTotals
};
