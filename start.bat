@echo off
chcp 65001 >nul
echo ====================================
echo   Arknights Tool Editor Launcher
echo ====================================
echo.

REM Check if .env file exists
if not exist "server\.env" (
    echo [INFO] Creating .env file from template...
    copy "server\.env.example" "server\.env" >nul
    echo [WARN] Please edit server\.env with your GitHub credentials before authenticating!
    echo.
)

REM Start backend server in new window
echo [INFO] Starting backend server...
start "Arknights Backend" cmd /k "cd /d %~dp0server && node server.js"

REM Wait for backend to initialize
echo [INFO] Waiting for backend to initialize...
timeout /t 3 >nul

REM Start frontend server in new window
echo [INFO] Starting frontend server...
start "Arknights Frontend" cmd /k "cd /d %~dp0 && npm run dev"

REM Wait for frontend to start
timeout /t 5 >nul

REM Open browser
echo [INFO] Opening browser...
start http://localhost:5173

echo.
echo ====================================
echo   Servers started successfully!
echo ====================================
echo.
echo [ACCESS] Frontend: http://localhost:5173
echo [ACCESS] Backend:  http://localhost:3000
echo.
echo [NEXT] 1. Edit server\.env with your GitHub credentials
echo [NEXT] 2. Open http://localhost:5173 in your browser
echo [NEXT] 3. Authenticate with GitHub
echo [NEXT] 4. Start editing JSON files!
echo.
echo [EXIT]  Close the server windows to stop the application
echo.
pause
