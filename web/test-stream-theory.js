#!/usr/bin/env node

// Test the theory that FFmpeg exits when stdout is not consumed
import { spawn } from 'child_process';

console.log('Testing FFmpeg behavior with unconsumed stdout...');

const ffmpeg = spawn('ffmpeg', [
  '-f', 'x11grab',
  '-framerate', '5',
  '-video_size', '640x480',
  '-i', ':0',
  '-c:v', 'libvpx',
  '-f', 'webm',
  '-'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

console.log('FFmpeg started, NOT consuming stdout...');

ffmpeg.on('exit', (code, signal) => {
  console.log(`FFmpeg exited: code=${code}, signal=${signal}`);
});

ffmpeg.stderr.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (line.includes('error') || line.includes('Error')) {
      console.log('FFmpeg error:', line);
    }
  }
});

// Wait 3 seconds then start consuming
setTimeout(() => {
  console.log('Now starting to consume stdout...');
  let bytes = 0;
  ffmpeg.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    console.log(`Received ${chunk.length} bytes, total: ${bytes}`);
  });
}, 3000);

// Kill after 10 seconds
setTimeout(() => {
  ffmpeg.kill();
  process.exit(0);
}, 10000);