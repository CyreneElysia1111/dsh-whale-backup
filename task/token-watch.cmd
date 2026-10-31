@echo off
rem Windows 计划任务的入口。自己找 node：先看 DSH 自带运行时，再退回 PATH。
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
  echo [%DATE% %TIME%] failed: node.exe not found>>"%USERPROFILE%\.dsh\whale-token-watch.log"
  exit /b 1
)

"%NODE%" "%~dp0token-watch.mjs" >> "%USERPROFILE%\.dsh\whale-token-watch.log" 2>&1
exit /b %ERRORLEVEL%

