/**
 * release.js - 自動化版本發布與標籤管理腳本
 *
 * 用法:
 *   node scripts/release.js [patch | minor | major | X.Y.Z]
 *
 * 功能:
 *   1. 同步升級 manifest.json, package.json 與 AGENT_CONTEXT.md 之版本號
 *   2. 透過 GitHub REST API 建立 Git Tag (例如: v1.0.0)
 *   3. 透過 GitHub REST API 發布官方 GitHub Release
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const packagePath = path.join(rootDir, 'package.json');
const agentContextPath = path.join(rootDir, 'AGENT_CONTEXT.md');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');

function parseSemVer(version) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`無效的 SemVer 版本格式: ${version}`);
  return { major: parseInt(m[1]), minor: parseInt(m[2]), patch: parseInt(m[3]) };
}

function bumpVersion(current, type) {
  const parsed = parseSemVer(current);
  if (type === 'major') {
    return `${parsed.major + 1}.0.0`;
  } else if (type === 'minor') {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  } else if (type === 'patch') {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  } else if (/^\d+\.\d+\.\d+$/.test(type)) {
    return type;
  }
  throw new Error(`未知升版類型或版本號: ${type}，可用選項: patch, minor, major 或具體版本如 1.0.1`);
}

async function main() {
  const arg = process.argv[2] || 'current';
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let newVersion = pkg.version;
  if (arg !== 'current') {
    newVersion = bumpVersion(pkg.version, arg);
    console.log(`📌 版本遞增: ${pkg.version} -> ${newVersion}`);

    // 更新 package.json
    pkg.version = newVersion;
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

    // 更新 manifest.json
    manifest.version = newVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    // 更新 AGENT_CONTEXT.md
    if (fs.existsSync(agentContextPath)) {
      let content = fs.readFileSync(agentContextPath, 'utf8');
      content = content.replace(/agent_rules_version:\s*"[^"]+"/, `agent_rules_version: "${newVersion}"`);
      fs.writeFileSync(agentContextPath, content);
    }
    console.log(`✅ 已同步更新 manifest.json, package.json 與 AGENT_CONTEXT.md`);
  } else {
    console.log(`📌 使用當前版本發布: v${newVersion}`);
  }

  const tagName = `v${newVersion}`;

  // 讀取 GitHub Token
  const mcpConfigPath = 'C:/Users/samma/.gemini/config/mcp_config.json';
  if (!fs.existsSync(mcpConfigPath)) {
    console.log(`⚠️ 未找到 ${mcpConfigPath}，跳過遠端 GitHub Tag 建立。`);
    return;
  }

  const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  const token = mcpConfig.mcpServers?.github?.env?.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    console.log(`⚠️ 未設定 GITHUB_PERSONAL_ACCESS_TOKEN，跳過 GitHub API 標籤建立。`);
    return;
  }

  const owner = 'SunnyChan1010';
  const repo = 'youtube-subscription-folders';
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Antigravity-Release'
  };

  console.log(`🔍 檢查遠端 GitHub 標籤: ${tagName}...`);
  const tagCheckRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/tags/${tagName}`, { headers });
  if (tagCheckRes.ok) {
    console.log(`ℹ️ 標籤 ${tagName} 已存在於 GitHub 遠端。`);
  } else {
    console.log(`🚀 正在獲取 main 分支最新 SHA...`);
    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`, { headers });
    const refData = await refRes.json();
    const commitSha = refData.object.sha;

    console.log(`🏷️ 正在建立 Git Tag ${tagName} (Commit: ${commitSha})...`);
    const createTagRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/tags/${tagName}`,
        sha: commitSha
      })
    });

    if (createTagRes.ok) {
      console.log(`🎉 成功在 GitHub 建立 Git 標籤: ${tagName}!`);
    } else {
      console.warn(`⚠️ 建立 Git 標籤失敗:`, await createTagRes.text());
    }
  }

  // 檢查或建立 GitHub Release
  console.log(`📦 正在建立 GitHub Release: ${tagName}...`);
  let releaseBody = `## YouTube 訂閱分組管理 (Subscription Folders) ${tagName}\n\n正式發布版本，支援自訂分組、側邊欄導覽整合、動態牆過濾與一鍵同步。`;
  if (fs.existsSync(changelogPath)) {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    const sectionMatch = changelog.match(new RegExp(`## \\[${newVersion}\\][\\s\\S]*?(?=## |\$)`));
    if (sectionMatch) {
      releaseBody = sectionMatch[0].trim();
    }
  }

  const releaseRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tag_name: tagName,
      name: `Release ${tagName}`,
      body: releaseBody,
      draft: false,
      prerelease: false
    })
  });

  if (releaseRes.ok) {
    const relData = await releaseRes.json();
    console.log(`🎉 成功發布 GitHub Release: ${relData.html_url}`);
  } else {
    const errText = await releaseRes.text();
    if (errText.includes('already_exists')) {
      console.log(`ℹ️ GitHub Release ${tagName} 已經存在。`);
    } else {
      console.warn(`⚠️ 建立 GitHub Release 失敗:`, errText);
    }
  }
}

main().catch(err => {
  console.error('Release failed:', err);
  process.exit(1);
});
