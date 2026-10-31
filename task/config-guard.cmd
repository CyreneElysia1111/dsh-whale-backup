@echo off
rem 配置指纹巡检（2026-10-31）：确认 bili-whale.config.json 与 persona.md 没被意外改动
set NODE=
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
if not defined NODE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if exist "%%D\dependencies\node\bin\node.exe" set NODE=%%D\dependencies\node\bin\node.exe
  )
)
if not defined NODE (
  for %%N in (node.exe) do if not "%%~$PATH:N"=="" set NODE=%%~$PATH:N
)
if not defined NODE (
  echo [%DATE% %TIME%] failed: node.exe not found>>"%USERPROFILE%\.dsh\whale-config-guard-task.log"
  exit /b 1
)

"%NODE%" "%~dp0config-guard.mjs" >> "%USERPROFILE%\.dsh\whale-config-guard-task.log" 2>&1
exit /b %ERRORLEVEL%
