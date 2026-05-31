const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('Starting Arknights Tool Editor...');
console.log('=====================================');

// Check if .env file exists
const envPath = path.join(__dirname, 'server', '.env');
const envExamplePath = path.join(__dirname, 'server', '.env.example');

if (!fs.existsSync(envPath)) {
  console.log('\n📝 Creating .env file from .env.example...');
  fs.copyFileSync(envExamplePath, envPath);
  console.log('✅ .env file created. Please edit server/.env with your GitHub credentials.');
}

// Start backend server
console.log('\n🚀 Starting backend server...');
const backend = spawn('node', ['server.js'], {
  cwd: path.join(__dirname, 'server'),
  stdio: 'inherit',
  shell: true
});

// Wait for backend to start, then start frontend
setTimeout(() => {
  console.log('\n🌐 Starting frontend development server...');
  const frontend = spawn('npm', ['run', 'dev'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  frontend.on('close', (code) => {
    console.log(`Frontend process exited with code ${code}`);
    backend.kill();
    process.exit(code);
  });
}, 3000);

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  backend.kill();
  process.exit(0);
});

backend.on('close', (code) => {
  console.log(`Backend process exited with code ${code}`);
  process.exit(code);
});

console.log('\n✅ Servers starting...');
console.log('📍 Backend: http://localhost:3000');
console.log('📍 Frontend: http://localhost:5173');
console.log('\n⚠️  Please edit server/.env with your GitHub credentials before authenticating.');
console.log('📖 See README.md for detailed instructions.\n');
