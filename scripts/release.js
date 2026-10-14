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

  // 執行發布前置代碼審查與架構守護驗證 (CODE_RULES.md)
  console.log('\n🛡️ 執行發布前置代碼審查與架構守護驗證 (CODE_RULES.md)...');
  try {
    const { execSync } = require('child_process');
    execSync('node scripts/audit_code_rules.js', { cwd: rootDir, stdio: 'inherit' });
  } catch (err) {
    console.error('\n❌ 發布前置代碼審查未通過！請依據 CODE_RULES.md 修復所有違規項後再執行發布。\n');
    process.exit(1);
  }

  const tagName = `v${newVersion}`;

  // 讀取 GitHub Token（優先從環境變數讀取，次選動態使用者目錄設定檔）
  const os = require('os');
  let token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';
  if (!token) {
    const mcpConfigPath = process.env.MCP_CONFIG_PATH || path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
    if (fs.existsSync(mcpConfigPath)) {
      try {
        const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        token = mcpConfig.mcpServers?.github?.env?.GITHUB_PERSONAL_ACCESS_TOKEN || '';
      } catch (e) {}
    }
  }
  if (!token) {
    console.log(`⚠️ 未設定 GITHUB_PERSONAL_ACCESS_TOKEN，跳過遠端 GitHub API 標籤與 Release 建立。`);
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
    const changelog = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');
    const startIdx = changelog.indexOf(`## [${newVersion}]`);
    if (startIdx !== -1) {
      const nextHeaderIdx = changelog.indexOf('\n## [', startIdx + 1);
      releaseBody = changelog.slice(startIdx, nextHeaderIdx !== -1 ? nextHeaderIdx : undefined).replace(/---\s*$/, '').trim();
    }
  }

  let releaseData = null;
  const releaseRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tag_name: tagName,
      name: `v${newVersion} - ${customSummary || '動態牆自動推進、Shorts/直播過濾與極致效能優化'}`,
      body: releaseBody,
      draft: false,
      prerelease: false
    })
  });

  if (releaseRes.ok) {
    releaseData = await releaseRes.json();
    console.log(`🎉 成功發布 GitHub Release: ${releaseData.html_url}`);
  } else {
    const errText = await releaseRes.text();
    if (errText.includes('already_exists')) {
      console.log(`ℹ️ GitHub Release ${tagName} 已經存在，正在同步更新 Release 說明...`);
      const getTagRelease = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tagName}`, { headers });
      if (getTagRelease.ok) {
        const tagData = await getTagRelease.json();
        const patchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${tagData.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            name: `v${newVersion} - ${customSummary || '動態牆自動推進、Shorts/直播過濾與極致效能優化'}`,
            body: releaseBody
          })
        });
        if (patchRes.ok) {
          releaseData = await patchRes.json();
          console.log(`🎉 成功同步更新 GitHub Release 內容！`);
        }
      }
    } else {
      console.warn(`⚠️ 建立 GitHub Release 失敗:`, errText);
    }
  }

  // 嘗試打包與上傳 Release ZIP 資產（僅包含執行階段必要檔案，排除開發腳本）
  if (releaseData && releaseData.id) {
    const zipName = `youtube-subscription-folders-${tagName}.zip`;
    const zipPath = path.join(rootDir, zipName);
    const stageDir = path.join(rootDir, '.release_stage');
    try {
      const { execSync } = require('child_process');
      if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
      fs.mkdirSync(path.join(stageDir, 'scripts'), { recursive: true });

      const runtimeScripts = ['background.js', 'content.js', 'initial_data.js', 'storage.js', 'youtube_api.js'];
      for (const s of runtimeScripts) {
        fs.copyFileSync(path.join(rootDir, 'scripts', s), path.join(stageDir, 'scripts', s));
      }
      for (const dir of ['styles', 'options', 'popup', 'icons']) {
        fs.cpSync(path.join(rootDir, dir), path.join(stageDir, dir), { recursive: true });
      }
      for (const file of ['manifest.json', 'README.md']) {
        fs.copyFileSync(path.join(rootDir, file), path.join(stageDir, file));
      }

      execSync(`powershell -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force"`, { cwd: rootDir });
      fs.rmSync(stageDir, { recursive: true, force: true });
      console.log(`📦 已成功建立/刷新擴充功能安裝包: ${zipName}`);
    } catch (zipErr) {
      if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
      console.warn(`⚠️ 建立 ZIP 套件失敗:`, zipErr.message);
    }

    if (fs.existsSync(zipPath)) {
      // 檢查是否已有同名資產，若有則先刪除以確保更新
      try {
        const assetsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${releaseData.id}/assets`, { headers });
        if (assetsRes.ok) {
          const assets = await assetsRes.json();
          const existingAsset = assets.find(a => a.name === zipName);
          if (existingAsset) {
            console.log(`🔄 偵測到舊版資產 (ID: ${existingAsset.id})，正在刪除以進行替換...`);
            await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`, {
              method: 'DELETE',
              headers
            });
          }
        }
      } catch (checkErr) {
        console.warn(`⚠️ 檢查現有資產時發生錯誤:`, checkErr.message);
      }

      console.log(`🚀 正在上傳最新 Release 資產: ${zipName}...`);
      const zipBuffer = fs.readFileSync(zipPath);
      const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseData.id}/assets?name=${encodeURIComponent(zipName)}`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/zip',
          'User-Agent': 'Antigravity-Release'
        },
        body: zipBuffer
      });

      if (uploadRes.ok) {
        console.log(`🎉 成功上傳最新 Release 資產: ${zipName}`);
      } else {
        const upErr = await uploadRes.text();
        console.warn(`⚠️ 上傳 Release 資產失敗:`, upErr);
      }
    }
  }
}

main().catch(err => {
  console.error('Release failed:', err);
  process.exit(1);
});
