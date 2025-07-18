#!/usr/bin/env node

// Direct test of the capture flow with logging

import { spawn } from 'child_process';

console.log('Testing FFmpeg capture with exact server parameters...');

// These are the exact args from the server based on the code
const args = [
  '-hide_banner', '-loglevel', 'info', '-stats',
  '-f', 'x11grab',
  '-framerate', '30',
  '-video_size', '1920x1080', 
  '-i', ':0+0,0',  // This should now be :0 instead of wayland-0
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

console.log('FFmpeg command:', 'ffmpeg', args.join(' '));

const ffmpeg = spawn('ffmpeg', args, {
  stdio: ['pipe', 'pipe', 'pipe']
});

console.log('FFmpeg started, PID:', ffmpeg.pid);

let frameCount = 0;
let errorOutput = '';

ffmpeg.stdout.on('data', (chunk) => {
  frameCount++;
  if (frameCount <= 5) {
    console.log(`Frame ${frameCount}: ${chunk.length} bytes`);
  }
});

ffmpeg.stderr.on('data', (data) => {
  errorOutput += data.toString();
  const lines = data.toString().trim().split('\n');
  for (const line of lines) {
    if (line.includes('Error') || line.includes('error')) {
      console.error('FFmpeg error:', line);
    }
  }
});

ffmpeg.on('exit', (code, signal) => {
  console.log(`FFmpeg exited: code=${code}, signal=${signal}`);
  if (code !== 0) {
    console.error('Full error output:', errorOutput);
  }
  console.log(`Total frames received: ${frameCount}`);
});

// Run for 3 seconds
setTimeout(() => {
  console.log('Stopping FFmpeg...');
  ffmpeg.stdin.write('q');
  setTimeout(() => process.exit(0), 1000);
}, 3000);