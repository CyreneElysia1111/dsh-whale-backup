@echo off
rem Windows scheduled-task entry. Finds node itself: DSH runtime first, then PATH.
setlocal enabledelayedexpansion
set "NODE="

if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
  set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
)

if not defined NODE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if exist "%%D\dependencies\node\bin\node.exe" set "NODE=%%D\dependencies\node\bin\node.exe"
  )
)

if not defined NODE (
  for %%C in (node.exe) do if not "%%~$PATH:C"=="" set "NODE=%%~$PATH:C"
)

if not defined NODE (
  echo [%DATE% %TIME%] failed: node.exe not found>>"%USERPROFILE%\.dsh\whale-backup-task.log"
  exit /b 1
)

rem GitHub REST needs the system certificate store (schannel), otherwise fetch fails.
set "NODE_OPTIONS=--use-system-ca"

set "LOGFILE=%USERPROFILE%\.dsh\whale-backup-task.log"
set "OUT=%TEMP%\whale-backup-out.txt"

rem --if-due: run only if today has no successful backup yet (at most once a day).
"%NODE%" "%~dp0backup-once.mjs" --if-due > "%OUT%" 2>&1
set "RC=%ERRORLEVEL%"
type "%OUT%" >> "%LOGFILE%"
if not "%RC%"=="0" exit /b %RC%

findstr /C:"skip: " "%OUT%" >nul 2>&1
if not errorlevel 1 exit /b 0

rem Push the snapshot to GitHub (private repo). Only after a real backup run.
"%NODE%" "%~dp0push-github.mjs" --private >> "%LOGFILE%" 2>&1
exit /b %ERRORLEVEL%
