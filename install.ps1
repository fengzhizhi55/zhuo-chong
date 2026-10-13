<#
  install.ps1 —— 把 patch/ 里的改动覆盖到已安装的 dsh-pet 插件上。

  用法：
    powershell -ExecutionPolicy Bypass -File .\install.ps1
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -PetDir "C:\path\to\dsh-pet"
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -WhatIf      # 只看会改哪些文件

  它会：1) 自动定位已安装的 dsh-pet；2) 校验版本；3) 把被覆盖的原文件备份到 _backup-<时间戳>/；
        4) 覆盖 patch/ 下的文件；5) 打印后续生效步骤。
#>
[CmdletBinding()]
param(
  [string]$Profile = "desktop",
  [string]$PetDir = "",
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$patchRoot = Join-Path $here "patch"
$targetVersion = "0.3.6"

function Find-DshPet {
  if ($PetDir) {
    if (Test-Path (Join-Path $PetDir "package.json")) { return (Resolve-Path $PetDir).Path }
    throw "指定的 -PetDir 里没有 package.json：$PetDir"
  }
  $roots = @()
  if ($env:DSH_HOME) { $roots += $env:DSH_HOME }
  $roots += (Join-Path $env:USERPROFILE ".dsh")
  foreach ($root in $roots) {
    foreach ($prof in @($Profile, "desktop", "web", "default")) {
      $cand = Join-Path $root "profiles\$prof\node_modules\dsh-pet"
      if (Test-Path (Join-Path $cand "package.json")) { return $cand }
    }
  }
  throw "没找到已安装的 dsh-pet。请先装：dsh plugin --profile $Profile add dsh-pet；或用 -PetDir 指定路径。"
}

Write-Host "== zhuo-chong 补丁安装 ==" -ForegroundColor Cyan
$plugin = Find-DshPet
$pkg = Get-Content (Join-Path $plugin "package.json") -Raw | ConvertFrom-Json
Write-Host "插件目录 : $plugin"
Write-Host "插件版本 : $($pkg.version)"

if ($pkg.version -ne $targetVersion) {
  Write-Host "⚠️  本补丁针对 dsh-pet $targetVersion 的构建产物；当前是 $($pkg.version)，改法可能不适用。" -ForegroundColor Yellow
  $ans = Read-Host "仍要继续？(y/N)"
  if ($ans -ne "y") { Write-Host "已取消。"; exit 1 }
}

$files = Get-ChildItem $patchRoot -Recurse -File
Write-Host ("将要覆盖 {0} 个文件：" -f $files.Count)

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $plugin "_backup-$stamp"
$changed = 0
$backed = 0

foreach ($f in $files) {
  $rel = $f.FullName.Substring($patchRoot.Length + 1)
  $dst = Join-Path $plugin $rel
  $status = if (Test-Path $dst) { "覆盖" } else { "新增" }
  Write-Host ("  [{0}] {1}" -f $status, $rel)
  if ($WhatIf) { continue }

  if ((Test-Path $dst) -and -not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Force $backupDir | Out-Null
  }
  if (Test-Path $dst) {
    $bak = Join-Path $backupDir $rel
    New-Item -ItemType Directory -Force (Split-Path $bak -Parent) | Out-Null
    Copy-Item $dst $bak -Force
    $backed++
  }
  New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
  Copy-Item $f.FullName $dst -Force
  $changed++
}

if ($WhatIf) {
  Write-Host "`n(-WhatIf：没有实际改动)" -ForegroundColor Yellow
  exit 0
}

Write-Host "`n完成：覆盖 $changed 个文件，备份 $backed 个 → $backupDir" -ForegroundColor Green
Write-Host @"

接下来让它生效：
  1) 宿主半边（桌面感知 / 设置页保存路由）
     DSH「插件」页把 dsh-pet 禁用再启用（或重启 DSH）
  2) 浏览器半边（设置页列出文件宠物）
     刷新 DSH 页面（F5）
  3) 桌面半边（边缘探头 / 右键设置菜单）
     桌宠右键 →「重载配置」

想还原：把 $backupDir 里的文件按同样的相对路径拷回去即可。
"@ -ForegroundColor Cyan
