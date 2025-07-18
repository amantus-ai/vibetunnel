#!/usr/bin/env node

// Test display capture with detected settings

import { spawn } from 'child_process';

// Test with :0 display (X11)
console.log('Testing X11 capture with display :0...');

const ffmpeg = spawn('ffmpeg', [
  '-f', 'x11grab',
  '-framerate', '1',
  '-video_size', '640x480',
  '-i', ':0+0,0',
  '-frames:v', '1',
  '-f', 'null',
  '-'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
ffmpeg.stderr.on('data', (data) => {
  output += data.toString();
});

ffmpeg.on('exit', (code) => {
  console.log('FFmpeg exit code:', code);
  if (code !== 0) {
    console.error('FFmpeg stderr:', output);
  } else {
    console.log('✅ X11 capture successful!');
  }
});