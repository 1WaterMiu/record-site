@echo off
chcp 65001 >nul
setlocal

set SITE=C:\personal\record-site
set DESKTOP=C:\Users\WaterMiu\Desktop
set COOKIES=%DESKTOP%\x.com_cookies.txt
set GENERATOR=%DESKTOP%\_build_record.py
set USER_URL=https://x.com/WaterMiuuuuuuu

echo.
echo === [1/4] Fetching new tweets from X ===
if not exist "%COOKIES%" (
    echo WARN: cookies file not found at %COOKIES%, skipping fetch step.
) else (
    gallery-dl --cookies "%COOKIES%" -d "%SITE%" --write-metadata "%USER_URL%"
    if errorlevel 1 (
        echo WARN: gallery-dl returned an error. Continuing with existing files.
    )
)

echo.
echo === [2/4] Regenerating index.html ===
python "%GENERATOR%"
if errorlevel 1 (
    echo ERROR: generator failed.
    pause
    exit /b 1
)

echo.
echo === [3/4] Committing changes ===
cd /d "%SITE%"
git add .
git diff --cached --quiet
if not errorlevel 1 (
    echo No changes to commit. Site is already up to date.
    goto :end
)
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set TODAY=%%a-%%b-%%c-%%d
git commit -m "update %TODAY%"
if errorlevel 1 (
    echo ERROR: commit failed.
    pause
    exit /b 1
)

echo.
echo === [4/4] Pushing to GitHub ===
git push
if errorlevel 1 (
    echo ERROR: push failed. Check network or credentials.
    pause
    exit /b 1
)

echo.
echo === Done. Cloudflare will auto-deploy in 1-2 minutes. ===

:end
echo.
pause
