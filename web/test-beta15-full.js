import { spawn } from 'child_process';
import { existsSync } from 'fs';

console.log('Full test of ShellOps beta 15 package...\n');

// First install missing dependencies
console.log('Installing missing dependencies...');
const npmInstall = spawn('npm', ['install', 'uuid'], { stdio: 'inherit' });

npmInstall.on('close', (code) => {
  if (code !== 0) {
    console.error('Failed to install dependencies');
    process.exit(1);
  }
  
  console.log('\nDependencies installed. Testing ShellOps...\n');
  
  // Test the CLI command
  const vt = spawn('./node_modules/.bin/shellops', ['--version']);
  
  vt.stdout.on('data', (data) => {
    console.log(`Version output: ${data}`);
  });
  
  vt.stderr.on('data', (data) => {
    console.error(`Version error: ${data}`);
  });
  
  vt.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Version command works!\n');
      
      // Now try to start the server
      console.log('Starting ShellOps server...');
      const server = spawn('./node_modules/.bin/shellops', ['--port', '4021', '--no-auth'], {
        env: { ...process.env, SHELLOPS_NO_AUTH: 'true' }
      });
      
      let serverStarted = false;
      
      server.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`Server: ${output}`);
        if (output.includes('Server running') || output.includes('4021')) {
          serverStarted = true;
        }
      });
      
      server.stderr.on('data', (data) => {
        console.error(`Server error: ${data}`);
      });
      
      // Check after 3 seconds
      setTimeout(() => {
        if (serverStarted) {
          console.log('\n✅ Server started successfully!');
          
          // Test HTTP endpoint
          fetch('http://localhost:4021/api/health')
            .then(res => {
              console.log('Health check status:', res.status);
              return res.text();
            })
            .then(text => {
              console.log('Health check response:', text);
              console.log('\n✅ All tests passed!');
              server.kill();
              process.exit(0);
            })
            .catch(err => {
              console.error('Health check failed:', err.message);
              server.kill();
              process.exit(1);
            });
        } else {
          console.log('\n❌ Server failed to start');
          server.kill();
          process.exit(1);
        }
      }, 3000);
      
    } else {
      console.error(`\n❌ Version command failed with code ${code}`);
      process.exit(1);
    }
  });
});