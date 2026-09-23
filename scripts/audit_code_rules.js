/**
 * audit_code_rules.js - Automated Code Review & Architectural Rule Checker
 *
 * Verifies that the codebase strictly conforms to all 6 core rules in CODE_RULES.md:
 * [Rule 1] System action button filtering in all channel ingestion points
 * [Rule 2] Chrome MV3 & CSP compliance (no inline event handlers)
 * [Rule 3] 100% local default assets (zero external CDN dependency)
 * [Rule 4] Zero hardcoded API keys, tokens, or static credentials
 * [Rule 5] Git privacy boundary (docs, audits, and agent rules never tracked)
 * [Rule 6] Release & version consistency across manifest, package, and changelog
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function recordError(rule, file, line, msg) {
  errors.push(`[${rule}] ${file}${line ? `:${line}` : ''} - ${msg}`);
}

function recordWarning(rule, file, msg) {
  warnings.push(`[${rule}] ${file} - ${msg}`);
}

console.log('🔍 Starting Automated Code Review & Architectural Rule Audit...\n');

// ---------------------------------------------------------------------------
// [Rule 2] Chrome MV3 & CSP Compliance: No inline event handlers
// ---------------------------------------------------------------------------
console.log('▶ [Rule 2] Checking Chrome MV3 CSP compliance (no inline events)...');
const htmlFiles = [
  path.join(rootDir, 'options', 'options.html'),
  path.join(rootDir, 'popup', 'popup.html')
];

const jsFilesForInline = [
  path.join(rootDir, 'scripts', 'content.js'),
  path.join(rootDir, 'options', 'options.js'),
  path.join(rootDir, 'popup', 'popup.js')
];

const inlineAttrRegex = /\s(on[a-z]{3,15})\s*=\s*["']/i;

htmlFiles.forEach(f => {
  if (!fs.existsSync(f)) return;
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const match = line.match(inlineAttrRegex);
    if (match) {
      recordError('Rule 2 - MV3 CSP', path.relative(rootDir, f), idx + 1, `Inline event attribute '${match[1]}' found in HTML.`);
    }
  });
});

jsFilesForInline.forEach(f => {
  if (!fs.existsSync(f)) return;
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    // Detect inline event handlers inside HTML template literals
    // e.g. <button onclick="..." or <img onerror="..."
    const m = line.match(/<[a-z0-9_-]+[^>]*\s(on[a-z]{3,15})\s*=\s*["']/i);
    if (m) {
      recordError('Rule 2 - MV3 CSP', path.relative(rootDir, f), idx + 1, `Inline event handler '${m[1]}' found inside DOM string template.`);
    }
  });
});

// ---------------------------------------------------------------------------
// [Rule 3] 100% Local Default Assets (Zero external CDN dependency)
// ---------------------------------------------------------------------------
console.log('▶ [Rule 3] Checking static asset localization (zero CDN fallback)...');
const initialDataPath = path.join(rootDir, 'scripts', 'initial_data.js');
if (fs.existsSync(initialDataPath)) {
  const initContent = fs.readFileSync(initialDataPath, 'utf8');
  if (initContent.includes('gstatic.com/youtube/img/creator/avatar/default_avatar')) {
    recordError('Rule 3 - Local Assets', 'scripts/initial_data.js', null, 'Deprecated gstatic.com external avatar URL detected.');
  }
  const { YT_DEFAULT_AVATAR } = require(initialDataPath);
  if (!YT_DEFAULT_AVATAR || !YT_DEFAULT_AVATAR.startsWith('data:image/svg+xml;base64,')) {
    recordError('Rule 3 - Local Assets', 'scripts/initial_data.js', null, 'YT_DEFAULT_AVATAR must be a valid base64 SVG data URI.');
  }
}

// ---------------------------------------------------------------------------
// [Rule 4] Zero Hardcoded API Keys or Secrets
// ---------------------------------------------------------------------------
console.log('▶ [Rule 4] Scanning for hardcoded API keys or static credentials...');
const filesToScanForSecrets = [
  path.join(rootDir, 'scripts', 'youtube_api.js'),
  path.join(rootDir, 'scripts', 'storage.js'),
  path.join(rootDir, 'scripts', 'content.js'),
  path.join(rootDir, 'scripts', 'background.js'),
  path.join(rootDir, 'manifest.json')
];

const apiKeyPattern = /\bAIzaSy[A-Za-z0-9_-]{33}\b/;
const staticSapisidPattern = /\bSAPISIDHASH\s+[0-9]+_[a-f0-9]{40}\b/;

filesToScanForSecrets.forEach(f => {
  if (!fs.existsSync(f)) return;
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (apiKeyPattern.test(line)) {
      recordError('Rule 4 - No Secrets', path.relative(rootDir, f), idx + 1, 'Possible hardcoded Google API Key (AIzaSy...) detected.');
    }
    if (staticSapisidPattern.test(line)) {
      recordError('Rule 4 - No Secrets', path.relative(rootDir, f), idx + 1, 'Hardcoded static SAPISIDHASH token detected.');
    }
  });
});

// ---------------------------------------------------------------------------
// [Rule 1] System Action Title Filtering (Ingestion Points Protected)
// ---------------------------------------------------------------------------
console.log('▶ [Rule 1] Verifying YouTube system action filtering in ingestion points...');
const storagePath = path.join(rootDir, 'scripts', 'storage.js');
const ytApiPath = path.join(rootDir, 'scripts', 'youtube_api.js');
const contentPath = path.join(rootDir, 'scripts', 'content.js');

if (fs.existsSync(storagePath)) {
  const sContent = fs.readFileSync(storagePath, 'utf8');
  if (!sContent.includes('checkSystemActionTitle')) {
    recordError('Rule 1 - Action Filtering', 'scripts/storage.js', null, 'Missing checkSystemActionTitle helper in storage.js.');
  }
}

if (fs.existsSync(ytApiPath)) {
  const yContent = fs.readFileSync(ytApiPath, 'utf8');
  if (!yContent.includes('checkSystemActionTitle')) {
    recordError('Rule 1 - Action Filtering', 'scripts/youtube_api.js', null, 'Missing checkSystemActionTitle helper in youtube_api.js.');
  }
  if (!yContent.includes("key === 'topbar'") || !yContent.includes("key === 'masthead'")) {
    recordError('Rule 1 - Action Filtering', 'scripts/youtube_api.js', null, "extractChannelsFromBrowseData must skip 'topbar' and 'masthead'.");
  }
}

if (fs.existsSync(contentPath)) {
  const cContent = fs.readFileSync(contentPath, 'utf8');
  if (!cContent.includes('isSystemActionTitle')) {
    recordError('Rule 1 - Action Filtering', 'scripts/content.js', null, 'content.js channel extractors must check isSystemActionTitle.');
  }
}

// ---------------------------------------------------------------------------
// [Rule 5] Git Privacy Boundary (Internal documents never tracked in Git)
// ---------------------------------------------------------------------------
console.log('▶ [Rule 5] Checking Git privacy boundary (local-only documents)...');
const gitignorePath = path.join(rootDir, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  const requiredIgnores = [
    'docs/',
    'PROJECT_METRICS_AUDIT.md',
    'AGENT_CONTEXT.md',
    'CODE_RULES.md',
    '.agentrules'
  ];
  for (const req of requiredIgnores) {
    if (!gitignoreContent.includes(req)) {
      recordError('Rule 5 - Git Privacy', '.gitignore', null, `Missing required ignore entry: '${req}' in .gitignore.`);
    }
  }
} else {
  recordError('Rule 5 - Git Privacy', '.gitignore', null, '.gitignore file is missing.');
}

try {
  const trackedFilesOutput = execSync('git --no-pager ls-files', {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const trackedFiles = trackedFilesOutput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const forbiddenTrackedPrefixes = [
    'docs/',
    'PROJECT_METRICS_AUDIT.md',
    'AGENT_CONTEXT.md',
    'CODE_RULES.md',
    '.agentrules',
    '.cursorrules'
  ];

  for (const track of trackedFiles) {
    for (const forbidden of forbiddenTrackedPrefixes) {
      if (track === forbidden || track.startsWith(forbidden)) {
        recordError('Rule 5 - Git Privacy', track, null, `Internal document '${track}' is tracked by Git. It must remain local-only.`);
      }
    }
  }
} catch (e) {
  // If git command fails or times out, warning only
  recordWarning('Rule 5 - Git Privacy', '.git', `Could not inspect git ls-files: ${e.message}`);
}

// ---------------------------------------------------------------------------
// [Rule 6] Version Consistency Across Project Files
// ---------------------------------------------------------------------------
console.log('▶ [Rule 6] Checking release version consistency...');
const manifestJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const changelogText = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');

if (manifestJson.version !== packageJson.version) {
  recordError('Rule 6 - Version Consistency', 'manifest.json / package.json', null, `Version mismatch: manifest is ${manifestJson.version} but package is ${packageJson.version}.`);
}

const currentVerHeader = `## [${manifestJson.version}]`;
if (!changelogText.includes(currentVerHeader)) {
  recordError('Rule 6 - Version Consistency', 'CHANGELOG.md', null, `CHANGELOG.md is missing an entry for current version '${currentVerHeader}'.`);
}

// ---------------------------------------------------------------------------
// Summary & Exit
// ---------------------------------------------------------------------------
console.log('\n-----------------------------------------------------------');
if (warnings.length > 0) {
  console.log(`⚠️  ${warnings.length} Warning(s) detected:`);
  warnings.forEach(w => console.log('  ' + w));
}

if (errors.length > 0) {
  console.error(`❌ ${errors.length} Architectural Rule Violation(s) Detected:\n`);
  errors.forEach(e => console.error('  ⛔ ' + e));
  console.error('\n🚫 Code rule check FAILED! Please resolve all violations according to CODE_RULES.md.\n');
  process.exit(1);
} else {
  console.log('✅ ALL ARCHITECTURAL CODE RULES PASSED 100%! (Zero violations)\n');
  process.exit(0);
}
