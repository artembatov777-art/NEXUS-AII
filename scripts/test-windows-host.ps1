param([Parameter(Mandatory)][string]$HostPath)
$ErrorActionPreference = 'Stop'
$exe = (Resolve-Path -LiteralPath $HostPath).Path
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("NEXUS preview " + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
try {
    Set-Content -LiteralPath (Join-Path $root 'note.txt') -Value 'workspace smoke' -NoNewline
    $frames = @(
        '{"version":1,"operation":"list","path":""}'
        '{"version":1,"operation":"search","path":"","query":"workspace smoke"}'
        '{"version":1,"operation":"read","path":"note.txt"}'
        '{"version":1,"operation":"read","path":"../note.txt"}'
        '{"version":1,"operation":"edit","path":"note.txt"}'
    ) | & $exe $root
    if ($LASTEXITCODE -ne 0 -or $frames.Count -ne 6) {
        throw 'Workspace host framing failed.'
    }
    $result = @($frames | ForEach-Object { ConvertFrom-Json -InputObject $_ })
    if (!$result[0].ready -or $result[0].edit -or $result[0].editRevision) {
        throw 'Windows host must start with writes disabled.'
    }
    if ('note.txt' -notin $result[1].value.entries -or 'note.txt' -notin $result[2].value.entries) {
        throw 'Workspace list or search failed.'
    }
    if ($result[3].value.content -ne 'workspace smoke' -or $result[3].value.revision -notmatch '^win:') {
        throw 'Workspace revision or read failed.'
    }
    if ($result[4].ok -or $result[5].ok) {
        throw 'Workspace accepted an out-of-scope read or disabled write.'
    }
    if ((Get-Content -LiteralPath (Join-Path $root 'note.txt') -Raw) -ne 'workspace smoke') {
        throw 'Read-only smoke changed the fixture.'
    }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
