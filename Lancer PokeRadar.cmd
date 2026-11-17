@echo off
rem PokéRadar : collecte + signaux + alertes toutes les ~10 minutes tant que cette fenêtre est ouverte.
rem Double-clique ce fichier (ou place un raccourci dans le dossier Démarrage de Windows pour qu'il démarre tout seul).
title PokeRadar - radar en direct
cd /d "%~dp0"
node collector\sync.mjs --watch 10
pause
