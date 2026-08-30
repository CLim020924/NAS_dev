param(
  [string]$CertificateThumbprint = $env:NAS_DRIVE_SIGNING_THUMBPRINT,
  [string]$PfxPath = $env:NAS_DRIVE_SIGNING_PFX_PATH,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\dist'))
$targets = @(
  (Join-Path $distDir 'NAS-Sync-Agent.exe'),
  (Join-Path $distDir 'NAS-Drive-Provider.exe')
)

$signtool = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $signtool) {
  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (Test-Path -LiteralPath $kitsRoot) {
    $signtool = Get-ChildItem -LiteralPath $kitsRoot -Filter 'signtool.exe' -Recurse -File |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1 -ExpandProperty FullName
  }
}
if (-not $signtool) { throw 'Windows SDK signtool.exe를 찾을 수 없습니다.' }

$missing = $targets | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) { throw "서명 대상이 없습니다: $($missing -join ', ')" }

$certificateArgs = @()
if ($PfxPath) {
  $resolvedPfx = (Resolve-Path -LiteralPath $PfxPath).Path
  $password = $env:NAS_DRIVE_SIGNING_PFX_PASSWORD
  if (-not $password) { throw 'PFX 사용 시 NAS_DRIVE_SIGNING_PFX_PASSWORD 환경 변수가 필요합니다.' }
  $certificateArgs = @('/f', $resolvedPfx, '/p', $password)
} elseif ($CertificateThumbprint) {
  $cleanThumbprint = ($CertificateThumbprint -replace '\s', '')
  if ($cleanThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw '인증서 thumbprint 형식이 올바르지 않습니다.' }
  $certificateArgs = @('/sha1', $cleanThumbprint)
} else {
  throw 'NAS_DRIVE_SIGNING_THUMBPRINT 또는 NAS_DRIVE_SIGNING_PFX_PATH를 설정해야 합니다.'
}

foreach ($target in $targets) {
  & $signtool sign /fd SHA256 /td SHA256 /tr $TimestampUrl @certificateArgs $target
  if ($LASTEXITCODE -ne 0) { throw "코드 서명 실패: $target" }
  & $signtool verify /pa /all /v $target
  if ($LASTEXITCODE -ne 0) { throw "코드 서명 검증 실패: $target" }
}

$targets | ForEach-Object {
  $signature = Get-AuthenticodeSignature -LiteralPath $_
  [PSCustomObject]@{ Path = $_; Status = $signature.Status; Subject = $signature.SignerCertificate.Subject }
} | Format-Table -AutoSize
