const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting PR Resolver Agent (Frontend & Backend)...');

// Helper to prefix stream lines with colors
function prefixLogs(prefix, colorCode, stream) {
  stream.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line) {
        console.log(`\x1b[${colorCode}m${prefix}\x1b[0m ${line}`);
      }
    });
  });
}

// 1. Start backend server (npm start in ./server)
const serverDir = path.join(__dirname, 'server');
const serverProcess = spawn('npm', ['start'], { cwd: serverDir });

prefixLogs('[Server]', '32', serverProcess.stdout); // Green
prefixLogs('[Server]', '31', serverProcess.stderr); // Red

// 2. Start frontend dev server (npm run dev in ./pr-agent)
const frontendDir = path.join(__dirname, 'pr-agent');
const frontendProcess = spawn('npm', ['run', 'dev'], { cwd: frontendDir });

prefixLogs('[Frontend]', '34', frontendProcess.stdout); // Blue
prefixLogs('[Frontend]', '31', frontendProcess.stderr); // Red

// Handle clean shutdown on Ctrl+C or process termination
const cleanUp = () => {
  console.log('\nStopping servers...');
  serverProcess.kill();
  frontendProcess.kill();
  process.exit(0);
};

process.on('SIGINT', cleanUp);
process.on('SIGTERM', cleanUp);
process.on('exit', () => {
  serverProcess.kill();
  frontendProcess.kill();
});
