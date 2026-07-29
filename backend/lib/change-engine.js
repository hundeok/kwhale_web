const { normalizeWhitespace } = require('./normalizer');

function makeAssetKey(asset) {
  return [
    asset.officialId,
    asset.normalizedCategory ?? asset.category,
    asset.normalizedSubcategory ?? asset.detailType,
    normalizeWhitespace(asset.owner),
    normalizeWhitespace(asset.address).toLowerCase()
  ].join('|');
}

function compareSnapshots(previousAssets, currentAssets) {
  const previous = new Map(previousAssets.map(asset => [asset.assetKey ?? makeAssetKey(asset), asset]));
  const current = new Map(currentAssets.map(asset => [asset.assetKey ?? makeAssetKey(asset), asset]));
  const keys = new Set([...previous.keys(), ...current.keys()]);

  return [...keys].map(key => {
    const before = previous.get(key);
    const after = current.get(key);
    const previousAmount = BigInt(before?.valuation ?? 0);
    const currentAmount = BigInt(after?.valuation ?? 0);
    const amountChange = currentAmount - previousAmount;
    let action = 'UNCHANGED';
    if (!before && after) action = 'ACQUIRED';
    else if (before && !after) action = 'DISPOSED';
    else if (amountChange > 0n) action = 'INCREASED';
    else if (amountChange < 0n) action = 'DECREASED';

    return {
      assetKey: key,
      action,
      previousAmount,
      currentAmount,
      amountChange,
      previousAssetId: before?.id ?? null,
      currentAssetId: after?.id ?? null,
      confidence: before && after ? 0.95 : 0.8,
      matchMethod: 'NORMALIZED_ASSET_KEY'
    };
  });
}

function rankChanges(changesByOfficial, mode = 'profit') {
  const ranked = changesByOfficial.map(entry => {
    const previousNetWorth = BigInt(entry.previousNetWorth);
    const currentNetWorth = BigInt(entry.currentNetWorth);
    const change = currentNetWorth - previousNetWorth;
    const rate = previousNetWorth > 0n ? Number(change * 10000n / previousNetWorth) / 100 : null;
    return { ...entry, change, rate };
  });
  ranked.sort((a, b) => {
    if (mode === 'yield') return (b.rate ?? -Infinity) - (a.rate ?? -Infinity) || a.name.localeCompare(b.name, 'ko');
    return a.change === b.change ? a.name.localeCompare(b.name, 'ko') : (a.change > b.change ? -1 : 1);
  });
  return ranked;
}

module.exports = { makeAssetKey, compareSnapshots, rankChanges };
