#!/usr/bin/env node

// Test FFmpeg capture directly with same parameters as the service

import { spawn } from 'child_process';
import { createWriteStream } from 'fs';

const args = [
  '-hide_banner', '-loglevel', 'info', '-stats',
  '-f', 'x11grab',
  '-framerate', '30', 
  '-video_size', '1920x1080',
  '-i', ':0+0,0',
  '-draw_mouse', '1',
  '-c:v', 'libvpx',
  '-quality', 'realtime',
  '-speed', '6',
  '-b:v', '2500k',
  '-maxrate', '3750k', 
  '-bufsize', '5000k',
  '-crf', '28',
  '-g', '60',
  '-deadline', 'realtime',
  '-cpu-used', '4',
  '-pix_fmt', 'yuv420p',
  '-f', 'webm',
  '-'
];

console.log('Starting FFmpeg with args:', args.join(' '));

const ffmpeg = spawn('ffmpeg', args, {
  stdio: ['pipe', 'pipe', 'pipe']
});

console.log('FFmpeg started, PID:', ffmpeg.pid);

// Create output file to verify video is being captured
const outputFile = createWriteStream('test-capture.webm');
let totalBytes = 0;
let frameCount = 0;

ffmpeg.stdout.on('data', (chunk) => {
  totalBytes += chunk.length;
  frameCount++;
  if (frameCount <= 10 || frameCount % 100 === 0) {
    console.log(`Frame ${frameCount}: ${chunk.length} bytes, total: ${totalBytes}`);
  }
  outputFile.write(chunk);
});

ffmpeg.stderr.on('data', (data) => {
  const output = data.toString();
  const lines = output.trim().split('\n');
  for (const line of lines) {
    if (line.includes('frame=') || line.includes('fps=') || line.includes('Error') || line.includes('error')) {
      console.log('FFmpeg:', line);
    }
  }
});

ffmpeg.on('exit', (code, signal) => {
  console.log(`FFmpeg exited: code=${code}, signal=${signal}`);
  console.log(`Total output: ${totalBytes} bytes in ${frameCount} chunks`);
  outputFile.end();
});

ffmpeg.on('error', (error) => {
  console.error('FFmpeg error:', error);
});

// Run for 5 seconds then stop
setTimeout(() => {
  console.log('Sending quit signal to FFmpeg...');
  ffmpeg.stdin.write('q');
  
  setTimeout(() => {
    if (!ffmpeg.killed) {
      console.log('Force killing FFmpeg...');
      ffmpeg.kill();
    }
    process.exit(0);
  }, 2000);
}, 5000);