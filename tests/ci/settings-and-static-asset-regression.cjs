const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function source(path) {
  return fs.readFileSync(path, 'utf8');
}

const apiPath = 'src/lib/api.ts';
const apiSource = source(apiPath);
const apiAst = ts.createSourceFile(apiPath, apiSource, ts.ScriptTarget.Latest, true);
const bootstrapFn = apiAst.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === 'bootstrapToState',
);
assert.ok(bootstrapFn, 'bootstrapToState not found');
const bootstrapCode = ts.transpileModule(
  bootstrapFn.getText(apiAst).replace(/^export\s+/, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
const context = vm.createContext({});
vm.runInContext(bootstrapCode, context);
const state = context.bootstrapToState({
  tasks: [],
  credentials: [],
  trackingRecords: [],
  settings: {
    notifyMinutesBefore: 15,
    shakeEnabled: false,
    soundEnabled: false,
    theme: 'dark',
    mail: {},
    branding: { companyName: 'Test', companyLogoDataUrl: '' },
    backup: {},
  },
});
assert.ok(Array.isArray(state.settings.branding.quickLinks), 'missing branding.quickLinks must normalize to []');
assert.equal(state.settings.branding.quickLinks.length, 0);

const serverSource = source('server/src/index.ts');
const bootstrapStart = serverSource.indexOf("app.get('/api/bootstrap'");
const bootstrapEnd = serverSource.indexOf("app.", bootstrapStart + 20);
assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'bootstrap route not found');
const bootstrapBlock = serverSource.slice(bootstrapStart, bootstrapEnd);
const brandingStart = bootstrapBlock.indexOf('branding: {');
assert.ok(brandingStart >= 0, 'bootstrap branding block not found');
assert.match(
  bootstrapBlock.slice(brandingStart, brandingStart + 500),
  /quickLinks\s*:\s*parseBrandingQuickLinks\(settings\.quickLinksJson\)/,
  'bootstrap response must include normalized quickLinks',
);

const appSource = source('src/App.tsx');
const updateStart = appSource.indexOf('const updateSettings = async');
const updateEnd = appSource.indexOf('const triggerAlert', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart, 'updateSettings block not found');
assert.match(
  appSource.slice(updateStart, updateEnd),
  /settings:\s*\{\s*\.\.\.current\.settings,\s*\.\.\.saved\s*\}/s,
  'partial settings responses must merge into existing settings state',
);

const productionStart = serverSource.indexOf("if (process.env.NODE_ENV === 'production')");
const errorMiddlewareStart = serverSource.indexOf('app.use((error:', productionStart);
assert.ok(productionStart >= 0 && errorMiddlewareStart > productionStart, 'production static routing block not found');
const productionBlock = serverSource.slice(productionStart, errorMiddlewareStart);
assert.match(productionBlock, /path\.extname\(req\.path\)/, 'missing static asset requests must be identified');
assert.match(productionBlock, /res\.status\(404\)/, 'missing static assets must return 404');

console.log('SETTINGS_AND_STATIC_ASSET_REGRESSION_PASS');
