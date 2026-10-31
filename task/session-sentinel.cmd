@echo off
rem 会话哨兵（2026-10-31）：检查"正在被写的会话"是不是我认识的那条 + 上下文是不是该迁了
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
  echo [%DATE% %TIME%] failed: node.exe not found>>"%USERPROFILE%\.dsh\whale-session-sentinel-task.log"
  exit /b 1
)

"%NODE%" "%~dp0session-sentinel.mjs" >> "%USERPROFILE%\.dsh\whale-session-sentinel-task.log" 2>&1
exit /b %ERRORLEVEL%
