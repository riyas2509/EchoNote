# Secure API Key Validator & Secret Manager Upload Script
# Requirements:
# 1. Parameterized secret and project targeting with canary default.
# 2. Reads securely without echoing to terminal.
# 3. Validates printable ASCII [0x20 - 0x7E].
# 4. Does not truncate, trim, or rewrite.
# 5. Resolves gcloud.cmd explicitly on Windows.
# 6. Uploads to Secret Manager via standard input without disk writes or command-line exposure.
# 7. Prevents pipe deadlocks by reading stdout/stderr asynchronously.
# 8. Bounded process wait (terminates hanging child process on timeout).
# 9. Sanitizes all error messages (zero raw child-process stdout/stderr in errors or logs).
# 10. Clears sensitive byte buffers and unmanaged BSTR from memory on all exit paths.

[CmdletBinding()]
param(
    [ValidateSet('echonote-gemini-canary-key', 'echonote-gemini-api-key')]
    [string]$SecretName = 'echonote-gemini-canary-key',

    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$ProjectId = 'echonote-2509'
)

$ErrorActionPreference = 'Stop'

# Validate project ID format (standard GCP project ID format: lowercase letters, digits, hyphens)
if ($ProjectId -notmatch '^[a-z0-9-]+$') {
    Write-Error 'FAILED_VALIDATION: ProjectId must contain only lowercase letters, digits, and hyphens.'
    exit 1
}

Write-Host ''
Write-Host '========================================================================'
Write-Host 'EchoNote Secure Gemini API Key Ingestion'
Write-Host '========================================================================'
Write-Host ('Target Project: ' + $ProjectId)
Write-Host ('Target Secret:  ' + $SecretName)
Write-Host ''
Write-Host 'Please enter the freshly obtained Gemini API key.'
Write-Host 'Input will NOT be echoed to the console.'

# Resolve installed Google Cloud CLI Windows batch wrapper before prompting for secret
$gcloudCmd = (Get-Command 'gcloud.cmd' -ErrorAction SilentlyContinue).Source
if (-not $gcloudCmd) {
    $whereResults = where.exe gcloud.cmd 2>$null
    if ($whereResults) { $gcloudCmd = $whereResults[0] }
}

if (-not $gcloudCmd -or -not (Test-Path $gcloudCmd)) {
    Write-Error 'FAILED_RESOLUTION: Could not resolve gcloud.cmd path on this system.'
    exit 1
}

$secureKey = Read-Host -Prompt 'Enter Gemini API Key' -AsSecureString

if ($null -eq $secureKey -or $secureKey.Length -eq 0) {
    Write-Error 'FAILED_VALIDATION: Credential input was empty.'
    exit 1
}

$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$process = $null
$bytes = $null

try {
    $plainKey = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    
    # Check ASCII printable range [0x20 - 0x7E]
    if ($plainKey -match '[^\x20-\x7E]') {
        Write-Error 'FAILED_VALIDATION: Credential contains characters outside the printable ASCII range [0x20 - 0x7E].'
        exit 1
    }
    
    # Convert directly to UTF-8 bytes for piping
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($plainKey)
    
    Write-Host 'Local validation passed. Uploading new version to Secret Manager...'
    
    # Configure ProcessStartInfo using the resolved full path and validated parameters
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $gcloudCmd
    $psi.Arguments = ('secrets versions add ' + $SecretName + ' --data-file=- --project=' + $ProjectId)
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    
    try {
        $process = [System.Diagnostics.Process]::Start($psi)
    }
    catch {
        Write-Error 'FAILED_LAUNCH: Failed to spawn Google Cloud CLI process.'
        exit 1
    }
    
    if ($null -eq $process) {
        Write-Error 'FAILED_LAUNCH: Process handle returned null.'
        exit 1
    }
    
    # Start async readers prior to writing to avoid buffer deadlocks
    $asyncOut = $process.StandardOutput.ReadToEndAsync()
    $asyncErr = $process.StandardError.ReadToEndAsync()
    
    try {
        # Write validated bytes directly to standard input
        $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $process.StandardInput.BaseStream.Flush()
    }
    catch {
        Write-Error 'FAILED_STREAM_WRITE: Failed to write credential payload to child process standard input.'
        exit 1
    }
    finally {
        try {
            $process.StandardInput.Close()
        }
        catch {
            # Best-effort stream close
        }
    }
    
    # Wait up to 60 seconds for child process completion
    $exitedInTime = $false
    try {
        $exitedInTime = $process.WaitForExit(60000)
    }
    catch {
        Write-Error 'FAILED_PROCESS_WAIT: Error while waiting for child process to terminate.'
        exit 1
    }
    
    if (-not $exitedInTime) {
        try {
            if (-not $process.HasExited) {
                $process.Kill()
                $process.WaitForExit(5000)
            }
        }
        catch {}
        Write-Error 'FAILED_TIMEOUT: Child process timed out after 60 seconds and was terminated.'
        exit 1
    }
    
    # Drain asynchronous read tasks
    try {
        [void][System.Threading.Tasks.Task]::WaitAll(@($asyncOut, $asyncErr), 5000)
    }
    catch {
        # Suppress task wait failures so raw text is never exposed
    }
    
    $exitCode = $process.ExitCode
    
    if ($exitCode -ne 0) {
        Write-Error ('Secret Manager upload failed (child process exited with code ' + $exitCode + ').')
        exit 1
    }
    
    Write-Host 'Secret version creation successful.'
}
finally {
    if ($process -ne $null) {
        try {
            if (-not $process.HasExited) {
                $process.Kill()
                $process.WaitForExit(5000)
            }
        }
        catch {}
        $process.Dispose()
    }
    if ($bytes -ne $null) {
        [System.Array]::Clear($bytes, 0, $bytes.Length)
    }
    if ($bstr -ne [System.IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    $plainKey = $null
    $bytes = $null
    $secureKey = $null
    [System.GC]::Collect()
}
