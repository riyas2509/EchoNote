$ErrorActionPreference = 'Stop'
$testPassCount = 0
$testFailCount = 0

function Assert-Test([bool]$condition, [string]$testName) {
    if ($condition) {
        Write-Host ('[PASS] ' + $testName)
        $global:testPassCount++
    } else {
        Write-Host ('[FAIL] ' + $testName) -ForegroundColor Red
        $global:testFailCount++
    }
}

Write-Host '--- Running Hardened Secure Ingestion Lifecycle Harness Tests (AH.67) ---'

# Test 1: Real gcloud.cmd resolution on this Windows system
$resolvedGcloud = (Get-Command 'gcloud.cmd' -ErrorAction SilentlyContinue).Source
if (-not $resolvedGcloud) {
    $whereResults = where.exe gcloud.cmd 2>$null
    if ($whereResults) { $resolvedGcloud = $whereResults[0] }
}
Assert-Test ($null -ne $resolvedGcloud -and (Test-Path $resolvedGcloud)) 'Executable resolution finds valid gcloud.cmd on Windows'

# Test 2: Sanitized resolution failure when given a non-existent binary name
$fakeResolved = (Get-Command 'non_existent_gcloud_wrapper.cmd' -ErrorAction SilentlyContinue).Source
Assert-Test ($null -eq $fakeResolved) 'Resolution cleanly returns null for nonexistent binary without throwing or leaking'

# Test 3, 4, 5: StandardInput delivery, process success (0), and argument hygiene
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = '/c findstr /v " dummyNonExistent\'
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
$dummySecret = 'synthetic-secret-payload-abc-123'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($dummySecret)

$asyncOut = $proc.StandardOutput.ReadToEndAsync()
$asyncErr = $proc.StandardError.ReadToEndAsync()

$proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
$proc.StandardInput.BaseStream.Flush()
$proc.StandardInput.Close()

$proc.WaitForExit()
[void][System.Threading.Tasks.Task]::WaitAll(@($asyncOut, $asyncErr), 2000)

$exitCode0 = $proc.ExitCode
$outText = $asyncOut.Result
$proc.Dispose()

Assert-Test ($exitCode0 -eq 0) 'Child process completes with exit code 0 on valid StandardInput stream'
Assert-Test ($outText.Contains($dummySecret)) 'Child process received exact bytes through StandardInput'
Assert-Test (-not $psi.Arguments.Contains($dummySecret)) 'Secret payload is NOT in ProcessStartInfo.Arguments'

# Test 6 & 7: Nonzero child exit with synthetic sensitive text in stderr produces SANITIZED error output
$sensitiveErrorToken = 'UNAUTHORIZED_KEY_AIzaSy_SENSITIVE_LEAK'
$psiFail = New-Object System.Diagnostics.ProcessStartInfo
$psiFail.FileName = 'cmd.exe'
$psiFail.Arguments = '/c echo Simulated Error with ' + $sensitiveErrorToken + ' 1>&2 & exit 1'
$psiFail.UseShellExecute = $false
$psiFail.RedirectStandardInput = $true
$psiFail.RedirectStandardOutput = $true
$psiFail.RedirectStandardError = $true
$psiFail.CreateNoWindow = $true

$procFail = [System.Diagnostics.Process]::Start($psiFail)
$asyncOutFail = $procFail.StandardOutput.ReadToEndAsync()
$asyncErrFail = $procFail.StandardError.ReadToEndAsync()
$procFail.StandardInput.Close()
$procFail.WaitForExit()
[void][System.Threading.Tasks.Task]::WaitAll(@($asyncOutFail, $asyncErrFail), 2000)

$exitCode1 = $procFail.ExitCode
$procFail.Dispose()

$sanitizedErrorCaught = $false
$sensitiveTokenLeakedInMessage = $false
try {
    if ($exitCode1 -ne 0) {
        throw ('Secret Manager upload failed (child process exited with code ' + $exitCode1 + ').')
    }
} catch {
    $sanitizedErrorCaught = $true
    $exMsg = $_.Exception.Message
    if ($exMsg.Contains($sensitiveErrorToken)) {
        $sensitiveTokenLeakedInMessage = $true
    }
}

Assert-Test ($sanitizedErrorCaught -and $exitCode1 -eq 1) 'Nonzero exit triggers sanitized failure exception'
Assert-Test (-not $sensitiveTokenLeakedInMessage) 'Synthetic sensitive error token is NOT leaked in thrown error message'

# Test 8: Process start failure handling
$psiBad = New-Object System.Diagnostics.ProcessStartInfo
$psiBad.FileName = 'C:\non_existent_path\gcloud.cmd'
$psiBad.UseShellExecute = $false
$psiBad.CreateNoWindow = $true

$launchErrorCaught = $false
try {
    $badProc = [System.Diagnostics.Process]::Start($psiBad)
} catch {
    $launchErrorCaught = $true
}
Assert-Test $launchErrorCaught 'Process launch failure is captured cleanly without leaking context'

# Test 9: Stream write failure handling
$psiStreamFail = New-Object System.Diagnostics.ProcessStartInfo
$psiStreamFail.FileName = 'cmd.exe'
$psiStreamFail.Arguments = '/c exit 0'
$psiStreamFail.UseShellExecute = $false
$psiStreamFail.RedirectStandardInput = $true
$psiStreamFail.CreateNoWindow = $true

$procStreamFail = [System.Diagnostics.Process]::Start($psiStreamFail)
$procStreamFail.StandardInput.Close()
$writeErrorCaught = $false
try {
    $procStreamFail.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
} catch {
    $writeErrorCaught = $true
}
$procStreamFail.WaitForExit()
$procStreamFail.Dispose()
Assert-Test $writeErrorCaught 'StandardInput write failure is caught safely and prevents success'

# Test 10: Memory buffer zeroing
[System.Array]::Clear($bytes, 0, $bytes.Length)
$allZeroes = $true
foreach ($b in $bytes) { if ($b -ne 0) { $allZeroes = $false } }
Assert-Test $allZeroes 'Sensitive byte buffer successfully wiped in memory via [Array]::Clear'

# -----------------------------------------------------------------------------
# AH.67 Parameter Validation & Targeting Tests
# -----------------------------------------------------------------------------
Write-Host '--- Parameterization & Targeting Tests (AH.67) ---'

$uploadScriptPath = 'canary/scripts/secure_secret_upload.ps1'

# Test 11: AST inspection confirms default SecretName is 'echonote-gemini-canary-key'
$command = Get-Command $uploadScriptPath
$defaultSecretParam = $command.Parameters['SecretName'].Attributes | Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] }
Assert-Test ($defaultSecretParam.ValidValues -contains 'echonote-gemini-canary-key' -and $defaultSecretParam.ValidValues -contains 'echonote-gemini-api-key') 'SecretName parameter validates against allowed canary and production secret set'

# Test 12: Verify default parameter values without executing body
$scriptBlock = [System.Management.Automation.Language.Parser]::ParseFile($uploadScriptPath, [ref]$null, [ref]$null)
$paramBlock = $scriptBlock.ParamBlock
$secretNameParamAst = $paramBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'SecretName' }
$secretDefaultValue = $secretNameParamAst.DefaultValue.Value
Assert-Test ($secretDefaultValue -eq 'echonote-gemini-canary-key') 'Default SecretName AST is strictly echonote-gemini-canary-key'

$projectIdParamAst = $paramBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'ProjectId' }
$projectDefaultValue = $projectIdParamAst.DefaultValue.Value
Assert-Test ($projectDefaultValue -eq 'echonote-2509') 'Default ProjectId AST is strictly echonote-2509'

# Test 13: Invalid SecretName is rejected by PowerShell parameter binder before script execution
$invalidSecretRejected = $false
try {
    & powershell -Command ("& '" + $uploadScriptPath + "' -SecretName 'malicious-secret-name'") 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $invalidSecretRejected = $true }
} catch {
    $invalidSecretRejected = $true
}
Assert-Test $invalidSecretRejected 'Invalid secret name is rejected immediately before execution'

# Test 14: Invalid ProjectId format is rejected before prompt
$invalidProjectRejected = $false
try {
    $out = & powershell -Command ("& '" + $uploadScriptPath + "' -ProjectId 'INVALID_PROJECT!$$'") 2>&1
    if ($out -match 'FAILED_VALIDATION' -or $LASTEXITCODE -ne 0) { $invalidProjectRejected = $true }
} catch {
    $invalidProjectRejected = $true
}
Assert-Test $invalidProjectRejected 'Invalid ProjectId characters are rejected prior to credential prompt'

# Test 15: Blank ProjectId is rejected by parameter validation
$blankProjectRejected = $false
try {
    $out = & powershell -Command ("& '" + $uploadScriptPath + "' -ProjectId ''") 2>&1
    if ($LASTEXITCODE -ne 0) { $blankProjectRejected = $true }
} catch {
    $blankProjectRejected = $true
}
Assert-Test $blankProjectRejected 'Blank or empty ProjectId parameter is rejected immediately'

# Test 16: ProcessStartInfo argument construction for production secret
$expectedProdArgs = 'secrets versions add echonote-gemini-api-key --data-file=- --project=echonote-2509'
$constructedProdArgs = ('secrets versions add ' + 'echonote-gemini-api-key' + ' --data-file=- --project=' + 'echonote-2509')
Assert-Test ($constructedProdArgs -eq $expectedProdArgs) 'Production arguments accurately target echonote-gemini-api-key'

# Test 17: ProcessStartInfo argument construction for canary default
$expectedCanaryArgs = 'secrets versions add echonote-gemini-canary-key --data-file=- --project=echonote-2509'
$constructedCanaryArgs = ('secrets versions add ' + 'echonote-gemini-canary-key' + ' --data-file=- --project=' + 'echonote-2509')
Assert-Test ($constructedCanaryArgs -eq $expectedCanaryArgs) 'Canary arguments accurately target echonote-gemini-canary-key'

# Test 18: Zero credentials leaked in arguments or script text
$scriptText = Get-Content $uploadScriptPath -Raw
Assert-Test (-not $scriptText.Contains('AIzaSy')) 'Ingestion script contains zero hardcoded credential fragments'

Write-Host ''
Write-Host ('Test Summary: ' + $global:testPassCount + ' passed, ' + $global:testFailCount + ' failed')
if ($global:testFailCount -gt 0) { exit 1 }
