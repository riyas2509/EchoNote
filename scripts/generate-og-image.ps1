Add-Type -AssemblyName System.Drawing

$width = 1200
$height = 630

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# 1. Background gradient (Deep Brand Navy #112250 to #0b1533)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point $width, $height),
    ([System.Drawing.ColorTranslator]::FromHtml('#112250')),
    ([System.Drawing.ColorTranslator]::FromHtml('#0a1329'))
)
$graphics.FillRectangle($bgBrush, 0, 0, $width, $height)

# 2. Subtle decorative accent curve or glow
$glowColor = [System.Drawing.Color]::FromArgb(35, 93, 169, 255)
$glowBrush = New-Object System.Drawing.SolidBrush($glowColor)
$graphics.FillEllipse($glowBrush, 850, -100, 600, 600)

$accentGlowColor = [System.Drawing.Color]::FromArgb(25, 234, 196, 53)
$accentGlowBrush = New-Object System.Drawing.SolidBrush($accentGlowColor)
$graphics.FillEllipse($accentGlowBrush, -150, 350, 500, 500)

# 3. Load EchoNote Logo-2.png
$logoPath = Join-Path $PSScriptRoot "public\Logo-2.png"
if (Test-Path $logoPath) {
    $logo = [System.Drawing.Image]::FromFile($logoPath)
    # Draw logo icon on left
    $logoSize = 140
    $logoX = 90
    $logoY = 90
    
    # Outer rounded badge behind logo
    $badgeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 255, 255))
    $graphics.FillRectangle($badgeBrush, ($logoX - 15), ($logoY - 15), ($logoSize + 30), ($logoSize + 30))
    $graphics.DrawImage($logo, $logoX, $logoY, $logoSize, $logoSize)
    $logo.Dispose()
}

# 4. Brand Typography
$titleFont = New-Object System.Drawing.Font("Segoe UI", 42, [System.Drawing.FontStyle]::Bold)
$titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$graphics.DrawString("EchoNote", $titleFont, $titleBrush, 270, 115)

$taglineFont = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#EAC435')) # Gold Accent
$graphics.DrawString("DECISION & EXECUTION MEMORY FOR TEAMS", $taglineFont, $accentBrush, 275, 185)

# 5. Core Positioning Headline
$headlineFont = New-Object System.Drawing.Font("Segoe UI", 32, [System.Drawing.FontStyle]::Bold)
$headlineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$headlineRect = New-Object System.Drawing.RectangleF(90, 290, 1020, 150)
$headlineText = "Turn conversations into structured decisions, clear ownership, and traceable organizational memory."
$graphics.DrawString($headlineText, $headlineFont, $headlineBrush, $headlineRect)

# 6. Workflow Badge Bar
$workflowFont = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$subtextBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#CBD5E1'))
$workflowText = "Conversation Ingestion  ->  Decision Intelligence  ->  Task Ownership  ->  Execution Tracking"
$graphics.DrawString($workflowText, $workflowFont, $subtextBrush, 90, 480)

# 7. Domain Footer Badge
$footerFont = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Regular)
$domainBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#94A3B8'))
$graphics.DrawString("https://echonote-25.vercel.app", $footerFont, $domainBrush, 90, 545)

# Save high-quality PNG
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot "public\og-preview.png"
if (Test-Path $outputPath) { Remove-Item -Force $outputPath }
$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Successfully generated $outputPath (1200x630)"
