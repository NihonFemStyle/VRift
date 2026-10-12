# VRift - checks the tools needed to build the desktop app on Windows.
$ok = $true
function Check($name, $cmd, $hint) {
  $found = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($found) {
    $ver = & $cmd --version 2>$null | Select-Object -First 1
    Write-Host ("[ OK ] {0,-10} {1}" -f $name, $ver) -ForegroundColor Green
  } else {
    Write-Host ("[MISS] {0,-10} {1}" -f $name, $hint) -ForegroundColor Red
    $script:ok = $false
  }
}
Check "node"  "node"  "Install Node.js 20+ from https://nodejs.org"
Check "npm"   "npm"   "Comes with Node.js"
Check "cargo" "cargo" "Install Rust from https://rustup.rs"
Check "rustc" "rustc" "Install Rust from https://rustup.rs"

# MSVC linker (Desktop development with C++)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasMsvc = $false
if (Test-Path $vswhere) {
  $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($path) { $hasMsvc = $true }
}
if ($hasMsvc) {
  Write-Host "[ OK ] MSVC      C++ build tools found" -ForegroundColor Green
} else {
  Write-Host "[MISS] MSVC      Install 'Desktop development with C++' from https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Red
  $ok = $false
}

# WebView2 runtime
$wv = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if ($wv) { Write-Host "[ OK ] WebView2  $($wv.pv)" -ForegroundColor Green }
else { Write-Host "[INFO] WebView2  not detected (usually preinstalled on Windows 10/11; the installer can fetch it)" -ForegroundColor Yellow }

if ($ok) {
  Write-Host "`nAll set. Run: npm install ; npm run app:dev" -ForegroundColor Cyan
} else {
  Write-Host "`nInstall the missing tools above, then open a NEW terminal and run this script again." -ForegroundColor Yellow
}
