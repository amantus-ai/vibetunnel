#!/usr/bin/env node

// Direct test of FFmpeg streaming
import { spawn } from 'child_process';

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

let dataReceived = 0;
let chunks = 0;

ffmpeg.stdout.on('data', (chunk) => {
  dataReceived += chunk.length;
  chunks++;
  if (chunks <= 5 || chunks % 100 === 0) {
    console.log(`Chunk ${chunks}: ${chunk.length} bytes, total: ${dataReceived}`);
  }
});

ffmpeg.stderr.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (line.trim() && !line.includes('frame=')) {
      console.log('FFmpeg:', line);
    }
  }
});

ffmpeg.on('exit', (code, signal) => {
  console.log(`FFmpeg exited with code ${code}, signal ${signal}`);
  console.log(`Total data received: ${dataReceived} bytes in ${chunks} chunks`);
});

ffmpeg.on('error', (error) => {
  console.error('FFmpeg error:', error);
});

// Keep running for 5 seconds then quit
setTimeout(() => {
  console.log('Sending quit signal to FFmpeg...');
  ffmpeg.stdin.write('q');
  setTimeout(() => {
    ffmpeg.kill('SIGKILL');
    process.exit(0);
  }, 1000);
}, 5000);