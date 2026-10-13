<#
  fetch-ffmpeg.ps1 —— 下载带 libvpx-vp9 的 ffmpeg / ffprobe 到 pipeline/.tools/

  为什么需要：透明桌宠动画必须是 VP9-alpha 的 webm，而 **很多现成的 ffmpeg 不能编码 VP9**
  （例如某些软件自带的精简构建只有 vp9 解码器）。本脚本下载的是 ffmpeg-static 的完整构建。

  用法：
    powershell -ExecutionPolicy Bypass -File .\fetch-ffmpeg.ps1
    powershell -ExecutionPolicy Bypass -File .\fetch-ffmpeg.ps1 -Force     # 已存在也重下
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [string]$Version = "b6.1.1"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $here ".tools"
New-Item -ItemType Directory -Force $tools | Out-Null

$base = "https://registry.npmmirror.com/-/binary/ffmpeg-static/$Version"
$jobs = @(
  @{ Name = "ffmpeg.exe";  Url = "$base/ffmpeg-win32-x64"  },
  @{ Name = "ffprobe.exe"; Url = "$base/ffprobe-win32-x64" }
)

foreach ($j in $jobs) {
  $dst = Join-Path $tools $j.Name
  if ((Test-Path $dst) -and -not $Force) {
    Write-Host ("已存在，跳过：{0}（{1:N1} MB）" -f $j.Name, ((Get-Item $dst).Length / 1MB)) -ForegroundColor DarkGray
    continue
  }
  Write-Host ("下载 {0} ..." -f $j.Name) -ForegroundColor Cyan
  # 大文件用流式下载，顺便打印进度
  $req = [System.Net.HttpWebRequest]::Create($j.Url)
  $req.UserAgent = "zhuo-chong/1.0"
  $resp = $req.GetResponse()
  $total = $resp.ContentLength
  $in = $resp.GetResponseStream()
  $out = [System.IO.File]::Create($dst)
  $buf = New-Object byte[] 1048576
  $got = 0
  while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
    $out.Write($buf, 0, $n)
    $got += $n
    if ($total -gt 0) {
      Write-Progress -Activity "下载 $($j.Name)" -PercentComplete ([int]($got * 100 / $total)) -Status ("{0:N1}/{1:N1} MB" -f ($got / 1MB), ($total / 1MB))
    }
  }
  $out.Close(); $in.Close(); $resp.Close()
  Write-Progress -Activity "下载 $($j.Name)" -Completed
  Write-Host ("  完成：{0:N1} MB" -f ((Get-Item $dst).Length / 1MB)) -ForegroundColor Green
}

Write-Host ""
Write-Host "检查 VP9 编码能力（必须为 true）..." -ForegroundColor Cyan
$ff = Join-Path $tools "ffmpeg.exe"
if (Test-Path $ff) {
  $enc = & $ff -hide_banner -encoders 2>&1 | Out-String
  $ok = $enc -match "libvpx-vp9"
  Write-Host ("  libvpx-vp9 : {0}" -f $ok)
  if (-not $ok) { Write-Host "  警告：这个构建不能编码 VP9，请换一个（需要启用 libvpx）" -ForegroundColor Red }
} else {
  Write-Host "  没找到 ffmpeg.exe" -ForegroundColor Red
}

Write-Host ""
Write-Host "就绪。示例：" -ForegroundColor Cyan
Write-Host "  python scripts\make_pet_webm.py 输入.mp4 ..\step03\输出.webm --fps 24 --delogo none"
