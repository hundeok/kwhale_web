import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'backend', 'server_private.js');
const outputPath = path.join(root, 'api', 'index.js');

let source = fs.readFileSync(sourcePath, 'utf8');
source = source.replaceAll("require('./lib/", "require('../backend/lib/");
source = source.replace(
  /const \{ DatabaseSync \} = require\('node:sqlite'\);/,
  "const { createClient } = require('@libsql/client');"
);
source = source.replace(
  /const PORT = Number\(process\.env\.KWHALE_PRIVATE_API_PORT \|\| 3340\);[\s\S]*?db\.exec\('PRAGMA query_only = ON; PRAGMA foreign_keys = ON;'\);\n/,
  `const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: 'number',
});
`
);
source = source.replace(
  /const availableYears = statement\('SELECT DISTINCT period_year AS year FROM disclosure ORDER BY year DESC'\)\n  \.all\(\)\.map\(\(row\) => Number\(row\.year\)\);\nconst defaultYear = availableYears\[0\];\nconst latestCompleteYear = availableYears\[1\] \|\| defaultYear;/,
  `let availableYears = [];
let defaultYear;
let latestCompleteYear;
let initialization;

async function initializeDatabase() {
  if (!initialization) {
    initialization = (async () => {
      const rows = await statement(
        'SELECT DISTINCT period_year AS year FROM disclosure ORDER BY year DESC'
      ).all();
      availableYears = rows.map((row) => Number(row.year));
      defaultYear = availableYears[0];
      latestCompleteYear = availableYears[1] || defaultYear;
    })();
  }
  return initialization;
}`
);
source = source.replace(
  /function statement\(sql\) \{[\s\S]*?\n\}/,
  `function statement(sql) {
  return {
    async all(...args) {
      const result = await db.execute({ sql, args });
      return result.rows;
    },
    async get(...args) {
      const result = await db.execute({ sql, args });
      return result.rows[0];
    },
  };
}`
);
source = source.replace(
  "app.get('/api/health',",
  `app.use(async (req, res, next) => {
  try {
    await initializeDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

app.get('/api/health',`
);
source = source.replace(
  "database: path.basename(databasePath),",
  "database: 'turso:kwhale-public',"
);
source = source.replace(
  /app\.listen\(PORT, '127\.0\.0\.1', \(\) => \{[\s\S]*?\n\}\);\s*$/,
  'module.exports = app;\n'
);

const asyncCalls = new Set([
  'latestCategoryLeaders',
  'latestAssetLeaders',
  'realEstateSnapshot',
  'realEstateAlpha',
  'respondWithRankings',
  'instrumentStats',
]);

function isStatementExecution(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (method !== 'all' && method !== 'get') return false;
  const receiver = node.expression.expression;
  return ts.isCallExpression(receiver)
    && ts.isIdentifier(receiver.expression)
    && receiver.expression.text === 'statement';
}

function isAsyncHelperCall(node) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && asyncCalls.has(node.expression.text);
}

function containsOwnAwait(node) {
  let found = false;
  const scan = (child) => {
    if (found) return;
    if (ts.isAwaitExpression(child)) {
      found = true;
      return;
    }
    if (child !== node && ts.isFunctionLike(child)) return;
    ts.forEachChild(child, scan);
  };
  ts.forEachChild(node, scan);
  return found;
}

const transformer = (context) => {
  const visit = (node) => {
    let visited = ts.visitEachChild(node, visit, context);
    if ((isStatementExecution(visited) || isAsyncHelperCall(visited))
        && !ts.isAwaitExpression(visited.parent)) {
      visited = ts.factory.createAwaitExpression(visited);
    }
    if (ts.isFunctionLike(visited) && containsOwnAwait(visited)) {
      const modifiers = [...(visited.modifiers || [])];
      if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
        modifiers.unshift(ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword));
      }
      if (ts.isFunctionDeclaration(visited)) {
        return ts.factory.updateFunctionDeclaration(
          visited, modifiers, visited.asteriskToken, visited.name,
          visited.typeParameters, visited.parameters, visited.type, visited.body
        );
      }
      if (ts.isFunctionExpression(visited)) {
        return ts.factory.updateFunctionExpression(
          visited, modifiers, visited.asteriskToken, visited.name,
          visited.typeParameters, visited.parameters, visited.type, visited.body
        );
      }
      if (ts.isArrowFunction(visited)) {
        return ts.factory.updateArrowFunction(
          visited, modifiers, visited.typeParameters, visited.parameters,
          visited.type, visited.equalsGreaterThanToken, visited.body
        );
      }
      if (ts.isMethodDeclaration(visited)) {
        return ts.factory.updateMethodDeclaration(
          visited, modifiers, visited.asteriskToken, visited.name,
          visited.questionToken, visited.typeParameters, visited.parameters,
          visited.type, visited.body
        );
      }
    }
    return visited;
  };
  return (node) => ts.visitNode(node, visit);
};

const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const result = ts.transform(file, [transformer]);
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const output = printer.printFile(result.transformed[0]);
result.dispose();

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(`Generated ${path.relative(root, outputPath)}`);
