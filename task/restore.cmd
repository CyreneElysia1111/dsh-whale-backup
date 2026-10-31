@echo off
rem 一键还原的入口。用法： restore.cmd --list / --commit latest --dry / --commit latest --yes
setlocal enabledelayedexpansion

set "NODE="
set "CANDIDATE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if exist "%CANDIDATE%" set "NODE=%CANDIDATE%"

if not defined NODE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if not defined NODE (
      if exist "%%D\dependencies\node\bin\node.exe" set "NODE=%%D\dependencies\node\bin\node.exe"
    )
  )
)

if not defined NODE (
  for %%N in (node.exe) do (
    if not defined NODE set "NODE=%%~$PATH:N"
  )
)

if not defined NODE (
  echo node.exe not found
  exit /b 1
)

"%NODE%" "%~dp0restore.mjs" %*
exit /b %ERRORLEVEL%
