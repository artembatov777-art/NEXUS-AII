param([switch]$InstallNsis)
$ErrorActionPreference = 'Stop'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-installer-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $bundle = Join-Path $PSScriptRoot '../src-tauri/target/release/bundle'
    $msi = @(Get-ChildItem -Path (Join-Path $bundle 'msi') -Filter '*.msi')
    $nsis = @(Get-ChildItem -Path (Join-Path $bundle 'nsis') -Filter '*.exe')
    if ($msi.Count -ne 1 -or $nsis.Count -ne 1) {
        throw 'Expected one MSI and one NSIS package.'
    }
    $output = Join-Path $root 'extracted'
    $log = Join-Path $root 'msiexec.log'
    $msiArgs = @('/a', ('"{0}"' -f $msi[0].FullName), '/qn', ('TARGETDIR="{0}"' -f $output), '/l*v', ('"{0}"' -f $log))
    $process = Start-Process -FilePath msiexec.exe -ArgumentList $msiArgs -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Get-Content -LiteralPath $log -Tail 60 -ErrorAction SilentlyContinue
        throw "MSI administrative extraction failed with exit code $($process.ExitCode)."
    }
    $hosts = @(Get-ChildItem -LiteralPath $output -Recurse -Filter 'nexus-workspace.exe')
    if ($hosts.Count -ne 1) {
        throw 'The MSI must include the workspace host exactly once.'
    }
    & (Join-Path $PSScriptRoot 'test-windows-host.ps1') -HostPath $hosts[0].FullName
    if ($InstallNsis) {
        # Only the disposable runner opts into installing, then uninstalling, the application.
        $install = Join-Path $root 'nsis-installed'
        $uninstaller = Join-Path $install 'uninstall.exe'
        try {
            # NSIS requires /D as the final argument, with no enclosing quotes.
            $process = Start-Process -FilePath $nsis[0].FullName -ArgumentList "/S /D=$install" -PassThru -Wait
            if ($process.ExitCode -ne 0) {
                throw "NSIS install failed with exit code $($process.ExitCode)."
            }
            $installedHost = Join-Path $install 'nexus-workspace.exe'
            $installedApp = Join-Path $install 'nexus-au.exe'
            foreach ($item in @($installedHost, $installedApp, $uninstaller)) {
                if (!(Test-Path -LiteralPath $item -PathType Leaf)) {
                    throw "NSIS did not install $item in the temporary destination."
                }
            }
            & (Join-Path $PSScriptRoot 'test-windows-host.ps1') -HostPath $installedHost
        } finally {
            if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
                # _?= keeps the uninstaller local and makes the exit status observable.
                $process = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$install" -PassThru -Wait
                if ($process.ExitCode -ne 0) {
                    throw "NSIS uninstall failed with exit code $($process.ExitCode)."
                }
            }
        }
    }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
