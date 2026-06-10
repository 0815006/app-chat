$cargoPath = "$env:USERPROFILE\.cargo\bin"
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($currentPath -notlike "*$cargoPath*") {
    [Environment]::SetEnvironmentVariable('Path', "$currentPath;$cargoPath", 'User')
    Write-Host 'Cargo path added to user PATH'
} else {
    Write-Host 'Cargo path already in PATH'
}