/**
 * install_hooks.js - Automatic Git Pre-Commit Hook Installer
 * Installs an unbreakable pre-commit hook into .git/hooks/pre-commit
 * that automatically executes `npm test` before any `git commit`.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const gitHooksDir = path.join(rootDir, '.git', 'hooks');

function installHook() {
  if (!fs.existsSync(gitHooksDir)) {
    console.log('⚠️ .git/hooks directory not found (not a git clone or bare repo). Skipping hook installation.');
    return;
  }

  const preCommitFile = path.join(gitHooksDir, 'pre-commit');
  const hookScript = `#!/bin/sh
# YouTube Subscription Folders - Pre-Commit Automated Architectural & Security Guard

echo "🛡️ [Pre-Commit Hook] Running automated security, performance and architectural audits..."
npm test
TEST_EXIT_CODE=$?

if [ $TEST_EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ [Pre-Commit Guard] AUDIT OR TEST FAILED!"
  echo "⛔ Commit aborted to prevent security vulnerabilities or performance degradations."
  echo "Please inspect and resolve all reported issues before committing."
  echo ""
  exit 1
fi

echo "✅ [Pre-Commit Guard] All security & architectural rules passed! Proceeding with commit."
exit 0
`;

  try {
    fs.writeFileSync(preCommitFile, hookScript, { mode: 0o755 });
    console.log('🎉 Successfully installed .git/hooks/pre-commit guard hook.');
  } catch (err) {
    console.warn('⚠️ Failed to write .git/hooks/pre-commit:', err.message);
  }
}

installHook();
