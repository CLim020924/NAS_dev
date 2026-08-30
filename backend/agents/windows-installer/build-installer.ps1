param(
  [Parameter(Mandatory = $true)][string]$AgentExe,
  [Parameter(Mandatory = $true)][string]$OutputExe,
  [string]$IconPath = ""
)

$ErrorActionPreference = "Stop"
$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw "C# compiler not found: $compiler" }
if (-not (Test-Path -LiteralPath $AgentExe)) { throw "Agent EXE not found: $AgentExe" }
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $OutputExe)) | Out-Null

$arguments = @(
  "/nologo",
  "/target:winexe",
  "/platform:x64",
  "/optimize+",
  "/win32manifest:$sourceDir\app.manifest",
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Web.Extensions.dll",
  "/reference:Microsoft.CSharp.dll",
  "/resource:$AgentExe,NasDrive.Agent",
  "/out:$OutputExe",
  "$sourceDir\Program.cs"
)
if ($IconPath -and (Test-Path -LiteralPath $IconPath)) { $arguments += "/win32icon:$IconPath" }

& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed: $LASTEXITCODE" }
Write-Output $OutputExe
