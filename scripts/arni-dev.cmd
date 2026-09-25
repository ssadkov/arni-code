@echo off
:: Launches the local source build with the everyday dev profile.
:: Console output goes to a fixed log file and the renderer listens on a fixed
:: CDP port, so an agent can read the log and drive the window without having
:: started it.
setlocal

set "ARNI_UDD=%USERPROFILE%\.vscode-oss-dev"
set "ARNI_LOG=%ARNI_UDD%\arni-dev-console.log"
set ARNI_CDP_PORT=9222

:: A shortcut does not get the shell's node from fnm/nvm, so skip preLaunch.
:: Run it (or npm run compile) from a terminal after git pull.
set VSCODE_SKIP_PRELAUNCH=1

if not exist "%ARNI_UDD%" mkdir "%ARNI_UDD%"
echo [%date% %time%] arni-dev start > "%ARNI_LOG%"

call "%~dp0code.bat" --user-data-dir="%ARNI_UDD%" --remote-debugging-port=%ARNI_CDP_PORT% %* >> "%ARNI_LOG%" 2>&1

endlocal
