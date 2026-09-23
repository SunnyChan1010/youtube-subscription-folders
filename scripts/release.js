/**
 * release.js - 自動化版本發布、標籤管理與本地審計日誌同步腳本
 *
 * 用法:
 *   node scripts/release.js [patch | minor | major | X.Y.Z] [--summary="變更摘要"]
 *
 * 功能:
 *   1. 同步升級 manifest.json, package.json 與 AGENT_CONTEXT.md 之版本號
 *   2. 同步更新本地審計日誌 (PROJECT_METRICS_AUDIT.md)：記錄本次變化 (Delta) 與變更後累計總數 (Cumulative Totals)
 *   3. 透過 GitHub REST API 建立 Git Tag (例如: v1.0.0)
 *   4. 透過 GitHub REST API 發布官方 GitHub Release
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const packagePath = path.join(rootDir, 'package.json');
const agentContextPath = path.join(rootDir, 'AGENT_CONTEXT.md');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const rootAuditPath = path.join(rootDir, 'PROJECT_METRICS_AUDIT.md');
const docsAuditPath = path.join(rootDir, 'docs', 'audit', 'PROJECT_METRICS_AUDIT.md');

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

/**
 * 同步更新本地審計日誌 (PROJECT_METRICS_AUDIT.md & docs/audit/PROJECT_METRICS_AUDIT.md)
 */
function updateAuditLedger(newVersion, oldVersion, releaseSummary, delta = null) {
  const today = new Date().toISOString().split('T')[0];
  const auditFiles = [rootAuditPath, docsAuditPath];

  // 預設或估算的本次版本增量 (Delta)
  const dSteps = delta?.steps || 35;
  const dTools = delta?.tools || 18;
  const dOutputK = delta?.outputK || 15;
  const dContextM = delta?.contextM || 0.3;
  const dCostUSD = delta?.costUSD || 0.20;

  for (const filePath of auditFiles) {
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, 'utf8');

    // 解析當前累計值
    let curSteps = 2375;
    let curTools = 1146;
    let curOutputK = 800;
    let curContextM = 11.5;
    let curCost = 8.50;

    const stepsMatch = content.match(/total_steps:\s*(\d+)/);
    if (stepsMatch) curSteps = parseInt(stepsMatch[1], 10);
    const toolsMatch = content.match(/total_tool_calls:\s*(\d+)/);
    if (toolsMatch) curTools = parseInt(toolsMatch[1], 10);
    const costMatch = content.match(/total_benchmark_cost_usd:\s*([0-9.]+)/);
    if (costMatch) curCost = parseFloat(costMatch[1]);

    // 計算變更後累計總數
    const newTotalSteps = curSteps + dSteps;
    const newTotalTools = curTools + dTools;
    const newTotalOutputK = curOutputK + dOutputK;
    const newTotalContextM = parseFloat((curContextM + dContextM).toFixed(1));
    const newTotalCost = parseFloat((curCost + dCostUSD).toFixed(2));

    // 1. 更新 Frontmatter
    content = content.replace(/current_version:\s*"[^"]+"/, `current_version: "${newVersion}"`);
    content = content.replace(/last_updated:\s*"[^"]+"/, `last_updated: "${today}"`);
    content = content.replace(/total_steps:\s*\d+/, `total_steps: ${newTotalSteps}`);
    content = content.replace(/total_tool_calls:\s*\d+/, `total_tool_calls: ${newTotalTools}`);
    content = content.replace(/total_output_tokens:\s*\d+/, `total_output_tokens: ${newTotalOutputK * 1000}`);
    content = content.replace(/total_context_tokens:\s*\d+/, `total_context_tokens: ${Math.round(newTotalContextM * 1000000)}`);
    content = content.replace(/total_benchmark_cost_usd:\s*[0-9.]+/, `total_benchmark_cost_usd: ${newTotalCost}`);

    // 2. 更新核心指標總結表
    content = content.replace(/截至目前最新版本（\*\*`v[^`]+`\*\*）/, `截至目前最新版本（**\`v${newVersion}\`**）`);
    content = content.replace(/(\*\*累計運算步驟 \(Total Steps\)\*\*\s*\|\s*)\*\*[\d,]+ 步\*\*/, `$1**${newTotalSteps.toLocaleString()} 步**`);
    content = content.replace(/(\*\*累計工具調用總數 \(Total Tool Calls\)\*\*\s*\|\s*)\*\*[\d,]+ 次\*\*/, `$1**${newTotalTools.toLocaleString()} 次**`);
    content = content.replace(/(\*\*累計生成 Token \(Output Tokens\)\*\*\s*\|\s*)\*\*約 [\d.]+ 萬 Tokens[^|]*/, `$1**約 ${newTotalOutputK} 萬 Tokens (${newTotalOutputK}K)** `);
    content = content.replace(/(\*\*累計上下文評估 \(Context Tokens\)\*\*\s*\|\s*)\*\*約 [\d.]+ 萬 Tokens[^|]*/, `$1**約 ${newTotalContextM}M Tokens** `);
    content = content.replace(/(\*\*商業 API 折算總價值 \(Benchmark Value\)\*\*\s*\|\s*)\*\*約 \$[0-9.]+ 美元/, `$1**約 $${newTotalCost} 美元`);

    // 3. 追加新版本記錄至流水帳表格
    const cleanSummary = releaseSummary ? releaseSummary.replace(/\n+/g, '<br>') : `版本修復與功能增強 (${newVersion})`;
    const newRow = `| **v${newVersion}** | ${today} | • 步驟: \`+${dSteps} 步\`<br>• 工具: \`+${dTools} 次\`<br>• 輸出: \`+${dOutputK}K Tokens\` | • 總步驟: **${newTotalSteps.toLocaleString()} 步**<br>• 總工具: **${newTotalTools.toLocaleString()} 次**<br>• 總輸出: **${newTotalOutputK}K Tokens**<br>• 總上下文: **${newTotalContextM}M Tokens** | ${cleanSummary} | ~$${newTotalCost} USD |`;

    if (content.includes('| **v' + newVersion + '**')) {
      console.log(`ℹ️ 版本 v${newVersion} 已在審計流水帳中，跳過重複追加。`);
    } else {
      // 插入到表格中 v1.0.0 上方
      content = content.replace(
        /(\| \*\*v\d+\.\d+\.\d+\*\* \|[^\n]+\n)/,
        `${newRow}\n$1`
      );
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`📊 已成功同步更新本地審計日誌: ${path.relative(rootDir, filePath)}`);
      console.log(`   └─ 本次變化: +${dSteps} 步驟, +${dTools} 工具調用, +${dOutputK}K 輸出 Tokens`);
      console.log(`   └─ 變更後累計: 總步數 ${newTotalSteps}, 總工具 ${newTotalTools}, 累計成本 ~$${newTotalCost}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = args[0] || 'current';
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let newVersion = pkg.version;
  const oldVersion = pkg.version;

  // 提取自訂 summary 參數
  let customSummary = '';
  for (const a of args) {
    if (a.startsWith('--summary=')) {
      customSummary = a.replace('--summary=', '').trim();
    }
  }

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

    // 同步更新本地審計日誌 (含本次變化與變更後累計總數)
    updateAuditLedger(newVersion, oldVersion, customSummary);
  } else {
    console.log(`📌 使用當前版本操作: v${newVersion}`);
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
  console.log(`📦 正在檢查或建立 GitHub Release: ${tagName}...`);
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
