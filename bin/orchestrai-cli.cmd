@echo off
set ELECTRON_RUN_AS_NODE=1
"%ORCHESTRAI_NODE%" "%~dp0orchestrai.js" %*
