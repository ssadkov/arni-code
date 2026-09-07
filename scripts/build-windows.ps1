# Arni Code — Windows Build Script
# Builds Arni Code IDE for Windows x64
# Usage: .\scripts\build-windows.ps1

param(
    [switch]$SkipDependencies,
    [switch]$SkipExtension,
    [switch]$SkipInstaller,
    [switch]$DevBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path "$RepoRoot\product.json")) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
    if (-not (Test-Path "$RepoRoot\product.json")) {
        $RepoRoot = $PSScriptRoot
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Arni Code — Windows Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------------------------------
# Step 1: Check prerequisites
# -------------------------------------------------------------------
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow

# Node.js
$nodeVersion = $null
try { $nodeVersion = (node --version 2>$null) } catch {}
if (-not $nodeVersion) {
    Write-Error "Node.js is not installed. Please install Node.js 20.x LTS from https://nodejs.org/"
    exit 1
}
Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green

# Check Node.js major version
$nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($nodeMajor -lt 20) {
    Write-Error "Node.js 20.x or higher is required. Current version: $nodeVersion"
    exit 1
}

# npm
$npmVersion = $null
try { $npmVersion = (npm --version 2>$null) } catch {}
if (-not $npmVersion) {
    Write-Error "npm is not installed. Please install Node.js with npm."
    exit 1
}
Write-Host "  npm: $npmVersion" -ForegroundColor Green

# Python
$pythonVersion = $null
try { $pythonVersion = (python --version 2>$null) } catch {}
if (-not $pythonVersion) {
    try { $pythonVersion = (python3 --version 2>$null) } catch {}
}
if (-not $pythonVersion) {
    Write-Warning "Python 3 is not found. Native module compilation may fail."
    Write-Warning "Install Python 3.x from https://python.org/"
} else {
    Write-Host "  Python: $pythonVersion" -ForegroundColor Green
}

# Visual Studio Build Tools
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsInstall = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vsInstall) {
        Write-Host "  VS Build Tools: Found at $vsInstall" -ForegroundColor Green
    } else {
        Write-Warning "Visual Studio C++ Build Tools not found. Native compilation may fail."
        Write-Warning "Install 'Desktop development with C++' workload."
    }
} else {
    Write-Warning "vswhere not found. Cannot verify Visual Studio installation."
}

# Inno Setup (optional, for installer)
$innoSetupPath = $null
$innoSetupLocations = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
foreach ($loc in $innoSetupLocations) {
    if (Test-Path $loc) {
        $innoSetupPath = $loc
        break
    }
}
if ($innoSetupPath) {
    Write-Host "  Inno Setup: $innoSetupPath" -ForegroundColor Green
} else {
    Write-Warning "Inno Setup 6 not found. Installer (.exe) will not be created."
    Write-Warning "Install from https://jrsoftware.org/isdl.php"
    if (-not $SkipInstaller) {
        Write-Host "  Continuing without installer build..." -ForegroundColor Yellow
        $SkipInstaller = $true
    }
}

Write-Host ""

# -------------------------------------------------------------------
# Step 2: Install dependencies
# -------------------------------------------------------------------
if (-not $SkipDependencies) {
    Write-Host "[2/7] Installing dependencies..." -ForegroundColor Yellow
    Push-Location $RepoRoot
    try {
        # Set msvs_version for node-gyp
        npm config set msvs_version 2022
        
        npm ci
        Write-Host "  Dependencies installed successfully." -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[2/7] Skipping dependency installation." -ForegroundColor Gray
}

Write-Host ""

# -------------------------------------------------------------------
# Step 3: Build Arni Agent extension
# -------------------------------------------------------------------
if (-not $SkipExtension) {
    Write-Host "[3/7] Building Arni Agent extension..." -ForegroundColor Yellow
    $extensionDir = Join-Path $RepoRoot "extensions\arni-agent"
    if (Test-Path $extensionDir) {
        Push-Location $extensionDir
        try {
            if (Test-Path "package-lock.json") {
                npm ci
            } else {
                npm install
            }
            
            if (Test-Path "esbuild.js") {
                node esbuild.js --production
            } elseif ((Get-Content package.json | ConvertFrom-Json).scripts.build) {
                npm run build
            } else {
                Write-Host "  No build step found for arni-agent. Using source directly." -ForegroundColor Yellow
            }
            Write-Host "  Arni Agent extension built successfully." -ForegroundColor Green
        } finally {
            Pop-Location
        }
    } else {
        Write-Warning "Arni Agent extension not found at $extensionDir"
    }
} else {
    Write-Host "[3/7] Skipping extension build." -ForegroundColor Gray
}

Write-Host ""

# -------------------------------------------------------------------
# Step 4: Compile Code-OSS / Arni Code
# -------------------------------------------------------------------
Write-Host "[4/7] Compiling Arni Code..." -ForegroundColor Yellow
Push-Location $RepoRoot
try {
    if ($DevBuild) {
        Write-Host "  Running development compilation..." -ForegroundColor Yellow
        npm run compile
    } else {
        Write-Host "  Running production build (vscode-win32-x64-min)..." -ForegroundColor Yellow
        npm run gulp "vscode-win32-x64-min"
    }
    Write-Host "  Compilation completed successfully." -ForegroundColor Green
} finally {
    Pop-Location
}

Write-Host ""

# -------------------------------------------------------------------
# Step 5: Build Windows installer
# -------------------------------------------------------------------
if (-not $SkipInstaller -and -not $DevBuild) {
    Write-Host "[5/7] Building Windows installer..." -ForegroundColor Yellow
    Push-Location $RepoRoot
    try {
        npm run gulp "vscode-win32-x64-inno-setup"
        Write-Host "  Installer built successfully." -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[5/7] Skipping installer build." -ForegroundColor Gray
}

Write-Host ""

# -------------------------------------------------------------------
# Step 6: Build portable archive
# -------------------------------------------------------------------
if (-not $DevBuild) {
    Write-Host "[6/7] Building portable archive..." -ForegroundColor Yellow
    Push-Location $RepoRoot
    try {
        npm run gulp "vscode-win32-x64-archive"
        Write-Host "  Archive built successfully." -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[6/7] Skipping archive build (dev mode)." -ForegroundColor Gray
}

Write-Host ""

# -------------------------------------------------------------------
# Step 7: Collect artifacts
# -------------------------------------------------------------------
Write-Host "[7/7] Collecting artifacts..." -ForegroundColor Yellow
$artifactsDir = Join-Path $RepoRoot "artifacts\windows"
New-Item -ItemType Directory -Path $artifactsDir -Force | Out-Null

# Look for built artifacts in common locations
$buildOutputDir = Join-Path (Split-Path $RepoRoot -Parent) "VSCode-win32-x64"
$buildOutputDir2 = Join-Path $RepoRoot ".build\win32-x64"

# Copy installer
$installerPatterns = @(
    "$buildOutputDir2\*Setup*.exe",
    "$buildOutputDir2\inno\*.exe",
    "$RepoRoot\.build\win32-x64\*.exe"
)
foreach ($pattern in $installerPatterns) {
    $files = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        Copy-Item $file.FullName -Destination $artifactsDir -Force
        Write-Host "  Installer: $($file.Name)" -ForegroundColor Green
    }
}

# Copy archive
$archivePatterns = @(
    "$buildOutputDir2\archive\*.zip",
    "$RepoRoot\.build\win32-x64\*.zip",
    "$buildOutputDir2\*.zip"
)
foreach ($pattern in $archivePatterns) {
    $files = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        Copy-Item $file.FullName -Destination $artifactsDir -Force
        Write-Host "  Archive: $($file.Name)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Build Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Artifacts directory: $artifactsDir" -ForegroundColor Green

$artifactFiles = Get-ChildItem -Path $artifactsDir -ErrorAction SilentlyContinue
if ($artifactFiles) {
    Write-Host "Files:" -ForegroundColor Green
    foreach ($f in $artifactFiles) {
        $sizeMB = [math]::Round($f.Length / 1MB, 2)
        Write-Host "  $($f.Name) ($sizeMB MB)" -ForegroundColor Green
    }
} else {
    Write-Host "Note: Artifact files may be in the .build/ directory." -ForegroundColor Yellow
    Write-Host "Check: $RepoRoot\.build\win32-x64\" -ForegroundColor Yellow
}
