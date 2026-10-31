@echo off
rem Weekly code snapshot (added 2026-10-31). Scheduled task: WhaleCodeWeekly, Sunday 04:20.
rem ASCII only on purpose: cmd.exe reads .cmd as ANSI, UTF-8 Chinese breaks parsing.
setlocal
set LOG=%USERPROFILE%\.dsh\whale-code-task.log
set NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
if exist "%NODE%" goto run
for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
  if exist "%%D\dependencies\node\bin\node.exe" set NODE=%%D\dependencies\node\bin\node.exe
)
if exist "%NODE%" goto run
where node >nul 2>nul
if errorlevel 1 (
  echo [%DATE% %TIME%] node not found >> "%LOG%"
  exit /b 1
)
set NODE=node

:run
cd /d "%USERPROFILE%\.dsh\whale-work\whale-backup-plugin"
"%NODE%" task\code-snapshot.mjs >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
