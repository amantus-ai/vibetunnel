#!/usr/bin/env node

/**
 * Script to find which test is causing memory issues by running tests individually
 */

import { execSync } from 'child_process';
import { readdirSync, statSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const LOG_FILE = 'test-memory-individual.log';

// Clear previous log
writeFileSync(LOG_FILE, `=== Individual Test Run Started at ${new Date().toISOString()} ===\n\n`);

/**
 * Find all test files recursively
 */
function findTestFiles(dir, files = []) {
  const items = readdirSync(dir);
  
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory() && !item.includes('node_modules') && !item.startsWith('.')) {
      findTestFiles(fullPath, files);
    } else if (item.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Run a single test file and measure memory
 */
function runSingleTest(testFile) {
  const startMemory = process.memoryUsage();
  console.log(`\n🧪 Testing: ${testFile}`);
  appendFileSync(LOG_FILE, `\n--- Testing: ${testFile} ---\n`);
  appendFileSync(LOG_FILE, `Start memory: ${JSON.stringify({
    heapUsed: `${(startMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    rss: `${(startMemory.rss / 1024 / 1024).toFixed(2)} MB`
  })}\n`);
  
  try {
    const startTime = Date.now();
    
    // Run the test with memory limit
    execSync(`NODE_OPTIONS='--max-old-space-size=8192' pnpm vitest run ${testFile}`, {
      stdio: 'pipe',
      encoding: 'utf8'
    });
    
    const duration = Date.now() - startTime;
    const endMemory = process.memoryUsage();
    
    console.log(`✅ Passed (${duration}ms)`);
    console.log(`   Memory: heap=${(endMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, rss=${(endMemory.rss / 1024 / 1024).toFixed(2)}MB`);
    
    appendFileSync(LOG_FILE, `Result: PASSED (${duration}ms)\n`);
    appendFileSync(LOG_FILE, `End memory: ${JSON.stringify({
      heapUsed: `${(endMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(endMemory.rss / 1024 / 1024).toFixed(2)} MB`,
      delta: `${((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024).toFixed(2)} MB`
    })}\n`);
    
    return { success: true, duration, memoryDelta: endMemory.heapUsed - startMemory.heapUsed };
    
  } catch (error) {
    const endMemory = process.memoryUsage();
    console.log(`❌ Failed or crashed`);
    console.log(`   Error: ${error.message}`);
    
    appendFileSync(LOG_FILE, `Result: FAILED/CRASHED\n`);
    appendFileSync(LOG_FILE, `Error: ${error.message}\n`);
    appendFileSync(LOG_FILE, `End memory: ${JSON.stringify({
      heapUsed: `${(endMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(endMemory.rss / 1024 / 1024).toFixed(2)} MB`
    })}\n`);
    
    return { success: false, error: error.message };
  }
}

// Main execution
console.log('🔍 Finding all test files...');
const testFiles = findTestFiles('src');
console.log(`📋 Found ${testFiles.length} test files\n`);

const results = [];
let crashedFile = null;

for (let i = 0; i < testFiles.length; i++) {
  console.log(`Progress: ${i + 1}/${testFiles.length}`);
  
  const result = runSingleTest(testFiles[i]);
  results.push({ file: testFiles[i], ...result });
  
  // If we found a crash, note it
  if (!result.success && result.error.includes('JavaScript heap out of memory')) {
    crashedFile = testFiles[i];
    console.log(`\n🚨 FOUND THE PROBLEMATIC TEST: ${crashedFile}`);
    appendFileSync(LOG_FILE, `\n🚨 MEMORY CRASH DETECTED IN: ${crashedFile}\n`);
    break;
  }
  
  // Force garbage collection between tests
  if (global.gc) {
    global.gc();
  }
}

// Summary
console.log('\n📊 Summary:');
console.log(`Total tests run: ${results.length}`);

if (crashedFile) {
  console.log(`\n🚨 The test causing the memory issue is: ${crashedFile}`);
  appendFileSync(LOG_FILE, `\n=== PROBLEMATIC TEST IDENTIFIED: ${crashedFile} ===\n`);
} else {
  // Find tests with highest memory usage
  const sortedByMemory = results
    .filter(r => r.success && r.memoryDelta)
    .sort((a, b) => b.memoryDelta - a.memoryDelta)
    .slice(0, 5);
  
  console.log('\n📈 Top 5 tests by memory usage increase:');
  sortedByMemory.forEach((test, i) => {
    console.log(`${i + 1}. ${test.file}`);
    console.log(`   Memory increase: ${(test.memoryDelta / 1024 / 1024).toFixed(2)} MB`);
  });
  
  appendFileSync(LOG_FILE, '\n=== TOP MEMORY CONSUMERS ===\n');
  sortedByMemory.forEach((test) => {
    appendFileSync(LOG_FILE, `${test.file}: +${(test.memoryDelta / 1024 / 1024).toFixed(2)} MB\n`);
  });
}

console.log(`\n📄 Detailed log saved to: ${LOG_FILE}`);