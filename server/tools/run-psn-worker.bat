@echo off
REM Double-clique pour traiter les demandes de synchro PSN en attente.
REM Lit la config dans server\.env (PSN_NPSSO, PSN_WORKER_URL, PSN_WORKER_SECRET).
title Worker PSN MyPlayLog
node "%~dp0psn-worker.mjs"
echo.
pause
