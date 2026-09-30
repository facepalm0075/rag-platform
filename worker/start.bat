@echo off

cd /d "C:\Users\facepalm\personalDirectory\codeProjects\CVprojects\RAG\worker"

echo [%date% %time%] Starting RAG worker >> worker.log

"C:\Program Files\nodejs\node.exe" "dist\worker.js" > worker.log 2>&1

echo [%date% %time%] Node process exited with code %ERRORLEVEL% >> worker.log
