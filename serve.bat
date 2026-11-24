@echo off
cd /d %~dp0
npx --yes http-server . -p 8765 -c-1 -a 127.0.0.1
