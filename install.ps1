# Deploy the Screen picker mod into a Herdr app home and bind its key (Windows).
#
#   .\install.ps1                     copy the mod in and bind ctrl-shift-o
#   .\install.ps1 -NoKeys             copy only, leave keys.json alone
#   .\install.ps1 -Link               symlink instead of copying (needs Developer
#                                     Mode or an elevated shell)
#   .\install.ps1 -AppHome D:\.herdr-app
[CmdletBinding()]
param(
    [switch]$Link,
    [switch]$NoKeys,
    [string]$AppHome
)

$ErrorActionPreference = "Stop"
$shortcut = "ctrl-shift-o"
$action = "mod.open:screen-picker"

if (-not $AppHome) {
    if ($env:HERDR_APP_HOME) { $AppHome = $env:HERDR_APP_HOME }
    else { $AppHome = Join-Path $env:USERPROFILE ".config\herdr-app" }
}
if (-not (Test-Path -LiteralPath $AppHome)) {
    throw "No Herdr app home at $AppHome. Pass -AppHome or set HERDR_APP_HOME."
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $here "mods\screen-picker"
$target = Join-Path $AppHome "mods\screen-picker"
$mods = Join-Path $AppHome "mods"
if (-not (Test-Path -LiteralPath $mods)) { New-Item -ItemType Directory -Path $mods | Out-Null }

if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
if ($Link) {
    New-Item -ItemType SymbolicLink -Path $target -Target $source | Out-Null
    Write-Host "installed link -> $target"
} else {
    New-Item -ItemType Directory -Path $target | Out-Null
    Copy-Item -LiteralPath (Join-Path $source "main.js") -Destination $target
    Copy-Item -LiteralPath (Join-Path $source "scan.js") -Destination $target
    Copy-Item -LiteralPath (Join-Path $source "mod.json") -Destination $target
    Write-Host "installed copy -> $target"
}

if (-not $NoKeys) {
    $keysPath = Join-Path $AppHome "keys.json"
    if (-not (Test-Path -LiteralPath $keysPath)) {
        Write-Host "No keys.json in $AppHome; add `"$shortcut`": `"$action`" to its global section."
    } else {
        $keys = Get-Content -LiteralPath $keysPath -Raw | ConvertFrom-Json
        if (-not $keys.global) { $keys | Add-Member -MemberType NoteProperty -Name global -Value (New-Object psobject) }
        $current = $keys.global.$shortcut
        if ($current -eq $action) {
            Write-Host "keys.json: $shortcut already $action"
        } else {
            $backup = Join-Path $AppHome ("keys.json.bak-" + (Get-Date -Format "yyyyMMddHHmmss"))
            Copy-Item -LiteralPath $keysPath -Destination $backup
            if ($current) { $keys.global | Add-Member -MemberType NoteProperty -Name $shortcut -Value $action -Force }
            else { $keys.global | Add-Member -MemberType NoteProperty -Name $shortcut -Value $action }
            ($keys | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $keysPath -Encoding utf8
            Write-Host "keys.json: $shortcut -> $action (was $(if ($current) { $current } else { 'unbound' })); backup $(Split-Path -Leaf $backup)"
            if ($current -and $current -ne $action) {
                Write-Host "note: $current has no key now; bind it elsewhere, or restore $backup to undo."
            }
        }
    }
}

Write-Host "check it with: herdr-app check `"$target`""
