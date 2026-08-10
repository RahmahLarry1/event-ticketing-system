Write-Host "== Gatherly / Event Ticketing System — Deploy ==" -ForegroundColor Cyan

$terraformDir = Join-Path $PSScriptRoot "terraform"
Set-Location $terraformDir

Write-Host "`n[1/4] Formatting check..." -ForegroundColor Yellow
terraform fmt -check -recursive
if ($LASTEXITCODE -ne 0) {
    Write-Host "Formatting issues found. Run 'terraform fmt -recursive' to fix, then re-run this script." -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/4] Initializing Terraform..." -ForegroundColor Yellow
terraform init -input=false
if ($LASTEXITCODE -ne 0) {
    Write-Host "terraform init failed." -ForegroundColor Red
    exit 1
}

Write-Host "`n[3/4] Planning changes..." -ForegroundColor Yellow
terraform plan -out=tfplan
if ($LASTEXITCODE -ne 0) {
    Write-Host "terraform plan failed." -ForegroundColor Red
    exit 1
}

Write-Host "`n[4/4] Review the plan above." -ForegroundColor Yellow
$confirm = Read-Host "Type 'yes' to apply these changes, or anything else to cancel"

if ($confirm -eq "yes") {
    terraform apply tfplan
    Write-Host "`nDeployment complete. Outputs:" -ForegroundColor Green
    terraform output
} else {
    Write-Host "Cancelled — no changes were made." -ForegroundColor Yellow
}

Remove-Item tfplan -ErrorAction SilentlyContinue