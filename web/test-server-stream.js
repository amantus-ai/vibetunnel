#!/usr/bin/env node

// Simple test to trigger screenshare and watch server logs
import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:4020/screencap');
  await page.waitForSelector('screencap-view', { timeout: 5000 });
  
  // Click Display 1 and Start
  await page.click('text=Display 1');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Start")');
  
  console.log('Capture started, watching for 10 seconds...');
  await page.waitForTimeout(10000);
  
  await browser.close();
}

test().catch(console.error);