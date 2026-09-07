# Generate ICO file from JPG/PNG source using .NET
# Usage: .\scripts\generate-ico.ps1

Add-Type -AssemblyName System.Drawing

$sourceImage = "resources\win32\arni-code-source.jpg"
$icoOutput = "resources\win32\code.ico"
$pngOutput = "resources\win32\code_150x150.png"
$pngOutput70 = "resources\win32\code_70x70.png"

if (-not (Test-Path $sourceImage)) {
    Write-Error "Source image not found: $sourceImage"
    exit 1
}

Write-Host "Loading source image: $sourceImage"
$original = [System.Drawing.Image]::FromFile((Resolve-Path $sourceImage))

# Generate PNG files for Visual Elements
$sizes = @(
    @{ Width = 150; Height = 150; Output = $pngOutput },
    @{ Width = 70; Height = 70; Output = $pngOutput70 }
)

foreach ($size in $sizes) {
    $resized = New-Object System.Drawing.Bitmap($size.Width, $size.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($resized)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($original, 0, 0, $size.Width, $size.Height)
    $graphics.Dispose()
    $resized.Save((Join-Path $PWD $size.Output), [System.Drawing.Imaging.ImageFormat]::Png)
    $resized.Dispose()
    Write-Host "Created: $($size.Output) ($($size.Width)x$($size.Height))"
}

# Generate ICO with multiple resolutions
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$memStream = New-Object System.IO.MemoryStream

# ICO header
$writer = New-Object System.IO.BinaryWriter($memStream)
$writer.Write([int16]0)        # Reserved
$writer.Write([int16]1)        # Type (1 = ICO)
$writer.Write([int16]$icoSizes.Count)  # Image count

# Calculate offset for first image data
$headerSize = 6  # ICO header
$directorySize = 16 * $icoSizes.Count  # 16 bytes per entry
$currentOffset = $headerSize + $directorySize

# Create PNG data for each size
$pngDataList = @()
foreach ($size in $icoSizes) {
    $resized = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($resized)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($original, 0, 0, $size, $size)
    $graphics.Dispose()
    
    $pngStream = New-Object System.IO.MemoryStream
    $resized.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngData = $pngStream.ToArray()
    $pngDataList += ,@($pngData)
    $pngStream.Dispose()
    $resized.Dispose()
}

# Write directory entries
for ($i = 0; $i -lt $icoSizes.Count; $i++) {
    $size = $icoSizes[$i]
    $pngData = $pngDataList[$i]
    
    $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))  # Width
    $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))  # Height
    $writer.Write([byte]0)    # Color count
    $writer.Write([byte]0)    # Reserved
    $writer.Write([int16]1)   # Color planes
    $writer.Write([int16]32)  # Bits per pixel
    $writer.Write([int32]$pngData.Length)  # Image data size
    $writer.Write([int32]$currentOffset)   # Offset
    
    $currentOffset += $pngData.Length
}

# Write image data
for ($i = 0; $i -lt $icoSizes.Count; $i++) {
    $writer.Write($pngDataList[$i])
}

$writer.Flush()
$icoPath = Join-Path $PWD $icoOutput
[System.IO.File]::WriteAllBytes($icoPath, $memStream.ToArray())
$writer.Dispose()
$memStream.Dispose()

Write-Host "Created: $icoOutput (multi-resolution ICO with $($icoSizes.Count) sizes)"

$original.Dispose()

Write-Host ""
Write-Host "Icon generation complete!" -ForegroundColor Green
