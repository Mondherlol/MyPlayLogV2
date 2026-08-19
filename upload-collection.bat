@echo off
REM ====================================================================
REM  Envoyer la Collection locale sur le site (myplaylog.cc)
REM ====================================================================
REM  Double-clic = tout se fait : export de la base locale, envoi des
REM  nouvelles jaquettes / planches / cartouches, import sur le VPS.
REM
REM  Options (en ligne de commande, si besoin) :
REM    upload-collection.bat -All            renvoyer TOUS les fichiers
REM    upload-collection.bat -Kind comic     un seul rayon
REM ====================================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\upload-collection.ps1" %*
echo.
pause
