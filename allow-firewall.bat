@echo off
REM Run this ONCE as Administrator (right-click > Run as administrator).
REM Windows blocks incoming connections on hotspot/public networks by default,
REM which is why phones can't reach the server. This opens ports 8080/8443.
net session >nul 2>&1 || (echo Please right-click this file and choose "Run as administrator". & pause & exit /b 1)
netsh advfirewall firewall delete rule name="Yemberzal" >nul 2>&1
netsh advfirewall firewall add rule name="Yemberzal" dir=in action=allow protocol=TCP localport=8080,8443 profile=any
echo.
echo Done! Phones on the same hotspot/WiFi can now reach Yemberzal.
echo Open https://YOUR-LAPTOP-IP:8443 on the phone (IP is shown when the server starts).
pause
