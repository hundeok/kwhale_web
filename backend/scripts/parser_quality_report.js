const fs = require('fs');
const path = require('path');
const { parseAssetRecord } = require('../lib/asset-parser');

const sourcePath = path.resolve(
  process.env.KWHALE_DATA_PATH || path.join(__dirname, '../../assets/kwhale_data.json')
);
const outputPath = path.resolve(
  process.env.KWHALE_PARSER_REPORT || path.join(__dirname, '../data/quality/parser-latest.json')
);

function ratio(value, total) {
  return total ? Number((value / total).toFixed(6)) : 0;
}

function main() {
  const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const report = {
    generatedAt: new Date().toISOString(),
    parserVersion: require('../lib/normalizer').PARSER_VERSION,
    sourcePath,
    sourceExportDate: data.metadata?.exportDate ?? null,
    totalAssets: 0,
    categories: {},
    securities: { assets: 0, components: 0, withQuantity: 0, suspiciousNames: 0, unallocatedValuation: 0 },
    crypto: { assets: 0, components: 0, withQuantity: 0, suspiciousNames: 0, unallocatedValuation: 0 },
    money: { assets: 0, components: 0, parsedComponents: 0, valuationReconciledAssets: 0 },
    realEstate: { assets: 0, withArea: 0, withAddress: 0 },
    vehicles: { assets: 0, withModelYear: 0, withDisplacement: 0 }
  };

  for (const people of Object.values(data.yearlyData || {})) {
    for (const person of people) {
      for (const asset of person.assets || []) {
        report.totalAssets++;
        report.categories[asset.type] = (report.categories[asset.type] || 0) + 1;
        const parsed = parseAssetRecord(asset);
        if (parsed.category.category === '증권') {
          report.securities.assets++;
          report.securities.components += parsed.components.length;
          for (const component of parsed.components) {
            if (component.quantity !== null) report.securities.withQuantity++;
            if (component.canonicalName.length > 80 || /,\s/.test(component.canonicalName)) report.securities.suspiciousNames++;
            if (component.declaredValuation === null) report.securities.unallocatedValuation++;
          }
        } else if (parsed.category.category === '가상자산') {
          report.crypto.assets++;
          report.crypto.components += parsed.components.length;
          for (const component of parsed.components) {
            if (component.quantity !== null) report.crypto.withQuantity++;
            if (component.canonicalName.length > 80 || /,\s/.test(component.canonicalName)) report.crypto.suspiciousNames++;
            if (component.declaredValuation === null) report.crypto.unallocatedValuation++;
          }
        } else if (parsed.components) {
          report.money.assets++;
          report.money.components += parsed.components.length;
          const parsedComponents = parsed.components.filter(component => component.amount !== null);
          report.money.parsedComponents += parsedComponents.length;
          const componentSum = parsedComponents.reduce((sum, component) => sum + component.amount, 0n);
          const valuation = BigInt(asset.valuation || 0);
          const difference = componentSum > valuation ? componentSum - valuation : valuation - componentSum;
          if (valuation === 0n ? componentSum === 0n : difference * 100n <= valuation) {
            report.money.valuationReconciledAssets++;
          }
        } else if (parsed.realEstate) {
          report.realEstate.assets++;
          if (parsed.realEstate.ownedAreaSqm !== null) report.realEstate.withArea++;
          if (parsed.realEstate.addressText) report.realEstate.withAddress++;
        } else if (parsed.vehicle) {
          report.vehicles.assets++;
          if (parsed.vehicle.modelYear !== null) report.vehicles.withModelYear++;
          if (parsed.vehicle.displacementCc !== null) report.vehicles.withDisplacement++;
        }
      }
    }
  }

  report.rates = {
    securityQuantityCoverage: ratio(report.securities.withQuantity, report.securities.components),
    securitySuspiciousNameRate: ratio(report.securities.suspiciousNames, report.securities.components),
    cryptoQuantityCoverage: ratio(report.crypto.withQuantity, report.crypto.components),
    cryptoSuspiciousNameRate: ratio(report.crypto.suspiciousNames, report.crypto.components),
    moneyComponentCoverage: ratio(report.money.parsedComponents, report.money.components),
    moneyValuationReconciliation: ratio(report.money.valuationReconciledAssets, report.money.assets),
    realEstateAreaCoverage: ratio(report.realEstate.withArea, report.realEstate.assets),
    vehicleModelYearCoverage: ratio(report.vehicles.withModelYear, report.vehicles.assets),
    vehicleDisplacementCoverage: ratio(report.vehicles.withDisplacement, report.vehicles.assets)
  };
  report.gates = {
    securityQuantityCoverage: report.rates.securityQuantityCoverage >= 0.95,
    securitySuspiciousNameRate: report.rates.securitySuspiciousNameRate <= 0.005,
    cryptoQuantityCoverage: report.rates.cryptoQuantityCoverage >= 0.98,
    moneyComponentCoverage: report.rates.moneyComponentCoverage >= 0.9,
    realEstateAreaCoverage: report.rates.realEstateAreaCoverage >= 0.9
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
