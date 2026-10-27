param()
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $argsForAdmin = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'))
    $child = Start-Process -FilePath "$PSHOME\powershell.exe" -Verb RunAs -ArgumentList $argsForAdmin -Wait -PassThru
    exit $child.ExitCode
}
try {
    $qzFolder = Join-Path $env:ProgramFiles 'QZ Tray'
    $console = Join-Path $qzFolder 'qz-tray-console.exe'
    if (-not (Test-Path -LiteralPath $console)) { throw 'Instale o QZ Tray oficial primeiro: https://qz.io/download/' }
    if (Get-Process -Name 'qz-tray' -ErrorAction SilentlyContinue) { throw 'Feche o QZ Tray pelo icone ao lado do relogio e execute este instalador novamente.' }
    $rootFile = Join-Path $PSScriptRoot 'bansir-qz-root.crt'
    $leafFile = Join-Path $PSScriptRoot 'digital-certificate.txt'
    if ((Get-FileHash -LiteralPath $rootFile -Algorithm SHA256).Hash -ne '__ROOT_SHA__') { throw 'O certificado raiz difere do pacote original. Baixe novamente o pacote Bansir.' }
    if ((Get-FileHash -LiteralPath $leafFile -Algorithm SHA256).Hash -ne '__LEAF_SHA__') { throw 'O certificado de assinatura difere do pacote original. Baixe novamente o pacote Bansir.' }
    $override = Join-Path $qzFolder 'override.crt'
    if ((Test-Path -LiteralPath $override) -and ((Get-FileHash -LiteralPath $override -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $rootFile -Algorithm SHA256).Hash)) { throw 'O QZ ja usa outra raiz personalizada. Solicite configuracao ao suporte; nenhum certificado foi sobrescrito.' }
    Copy-Item -LiteralPath $rootFile -Destination $override -Force
    & $console --allow $leafFile
    if ($LASTEXITCODE -ne 0) { throw 'O QZ nao confirmou a autorizacao do certificado. Confira a instalacao.' }
    $userAllowed = Join-Path $env:APPDATA 'qz\allowed.dat'
    if (-not (Test-Path -LiteralPath $userAllowed)) { throw 'A lista de confianca do QZ nao foi encontrada.' }
    $shared = Join-Path $env:ProgramData 'qz'
    New-Item -ItemType Directory -Path $shared -Force | Out-Null
    $sharedAllowed = Join-Path $shared 'allowed.dat'
    $lines = @()
    if (Test-Path -LiteralPath $sharedAllowed) {
        Copy-Item -LiteralPath $sharedAllowed -Destination ($sharedAllowed + '.backup-' + (Get-Date -Format 'yyyyMMddHHmmss'))
        $lines += [IO.File]::ReadAllLines($sharedAllowed)
    }
    $pem = [IO.File]::ReadAllText($leafFile)
    $der = [Convert]::FromBase64String(($pem -replace '-----[^-]+-----','' -replace '\s',''))
    $sha1 = [Security.Cryptography.SHA1]::Create()
    try { $fingerprint = ([BitConverter]::ToString($sha1.ComputeHash($der))).Replace('-','') } finally { $sha1.Dispose() }
    $bansirLines = @([IO.File]::ReadAllLines($userAllowed) | Where-Object { $_.Replace(':','').IndexOf($fingerprint,[StringComparison]::OrdinalIgnoreCase) -ge 0 })
    if (-not $bansirLines.Count) { throw 'O QZ nao registrou o certificado Bansir esperado. Nenhuma permissao de outro sistema foi copiada.' }
    $lines += $bansirLines
    [IO.File]::WriteAllLines($sharedAllowed, [string[]]($lines | Select-Object -Unique), (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Confianca Bansir configurada apenas no QZ Tray. A confianca geral do Windows nao foi alterada.' -ForegroundColor Green
    Write-Host 'Reabra o QZ Tray normalmente, recarregue o Bansir e selecione a impressora. Depois ative Impressao: automatica.'
    Write-Host 'O navegador ainda pode pedir permissao inicial de acesso a rede local. Autorize somente o site do Bansir.'
    Read-Host 'Pressione Enter para fechar'
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Pressione Enter para fechar'
    exit 1
}
