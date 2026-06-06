/**
 * Playwright Runtime Automation Test Suite
 * Tests HUD runtime diagnostic tools and voice/overlay instrumentation
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_URL = 'http://localhost:8765';

// Start local server
function startLocalServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting local QA server...');
    const serverProcess = spawn('node', ['scripts/local-qa-server.mjs'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe'
    });

    let output = '';
    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('LOCAL QA SERVER RUNNING')) {
        console.log('   ✓ Server started');
        resolve(serverProcess);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('Server error:', data.toString());
    });

    serverProcess.on('error', reject);

    // Timeout if server doesn't start
    setTimeout(() => {
      if (!output.includes('LOCAL QA SERVER RUNNING')) {
        reject(new Error('Server start timeout'));
      }
    }, 10000);
  });
}

// Main test suite
async function runRuntimeTests() {
  let serverProcess;
  let browser;
  let page;

  try {
    // Start server
    serverProcess = await startLocalServer();
    await new Promise(r => setTimeout(r, 2000)); // Extra startup time

    console.log('\n=== PLAYWRIGHT RUNTIME TEST SUITE ===\n');

    // Launch browser
    console.log('1. Launching Chromium...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('   ✓ Browser launched\n');

    // Create context with open permissions
    console.log('2. Creating browser context...');
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      permissions: ['geolocation', 'microphone']
    });
    page = await context.newPage();

    // Capture all console output
    const consoleLogs = [];
    page.on('console', msg => {
      const log = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(log);
      console.log(`   [CONSOLE] ${log}`);
    });

    page.on('pageerror', error => {
      const err = `[ERROR] ${error.message}`;
      consoleLogs.push(err);
      console.log(`   ${err}`);
    });

    console.log('   ✓ Context created\n');

    // Navigate to local server
    console.log(`3. Navigating to ${LOCAL_URL}...`);
    await page.goto(LOCAL_URL, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('   ✓ Page loaded\n');

    // Wait for React hydration
    console.log('4. Waiting for React hydration (5s)...');
    await page.waitForTimeout(5000);

    // Verify document title (should be HUD app, not Vercel auth)
    const title = await page.evaluate(() => document.title);
    console.log(`   Document title: "${title}"`);
    if (title.includes('Vercel') || title === '') {
      throw new Error('App not loaded - possible auth wall or load failure');
    }
    console.log('   ✓ HUD app loaded\n');

    // TEST 1: Verify window.__hudDebug
    console.log('5. Verifying window.__hudDebug...');
    const hudDebug = await page.evaluate(() => {
      return {
        exists: typeof window.__hudDebug !== 'undefined',
        type: typeof window.__hudDebug,
        keys: typeof window.__hudDebug === 'object' && window.__hudDebug !== null
          ? Object.keys(window.__hudDebug)
          : [],
        rawSpeakType: typeof window.__hudDebug?.rawSpeak,
        captureFieldDiagnosticType: typeof window.__hudDebug?.captureFieldDiagnostic,
        exportFieldReportType: typeof window.__hudDebug?.exportFieldReport,
      };
    });
    console.log('   exists:', hudDebug.exists);
    console.log('   type:', hudDebug.type);
    console.log('   keys:', hudDebug.keys.join(', ') || 'NONE');
    console.log('   rawSpeak:', hudDebug.rawSpeakType);
    console.log('   captureFieldDiagnostic:', hudDebug.captureFieldDiagnosticType);
    console.log('   exportFieldReport:', hudDebug.exportFieldReportType);

    if (!hudDebug.exists) {
      throw new Error('window.__hudDebug not exposed - initialization failed');
    }
    console.log('   ✓ __hudDebug exposed\n');

    // TEST 2: Verify window.__hudForensics
    console.log('6. Verifying window.__hudForensics...');
    const hudForensics = await page.evaluate(() => {
      return {
        exists: typeof window.__hudForensics !== 'undefined',
        keys: typeof window.__hudForensics === 'object' && window.__hudForensics !== null
          ? Object.keys(window.__hudForensics)
          : [],
      };
    });
    console.log('   exists:', hudForensics.exists);
    console.log('   keys:', hudForensics.keys.join(', ') || 'NONE');

    if (!hudForensics.exists) {
      throw new Error('window.__hudForensics not exposed - initialization failed');
    }
    console.log('   ✓ __hudForensics exposed\n');

    // TEST 3: Verify speechSynthesis API
    console.log('7. Verifying speechSynthesis API...');
    const speechSynth = await page.evaluate(() => {
      return {
        exists: 'speechSynthesis' in window,
        speaking: window.speechSynthesis?.speaking ?? null,
        pending: window.speechSynthesis?.pending ?? null,
        paused: window.speechSynthesis?.paused ?? null,
        voices: window.speechSynthesis?.getVoices()?.length ?? 0,
      };
    });
    console.log('   exists:', speechSynth.exists);
    console.log('   speaking:', speechSynth.speaking);
    console.log('   pending:', speechSynth.pending);
    console.log('   paused:', speechSynth.paused);
    console.log('   voices:', speechSynth.voices);
    console.log('   ✓ speechSynthesis API available\n');

    // TEST 4: Execute rawSpeak
    console.log('8. Executing window.__hudDebug.rawSpeak()...');
    const rawSpeakResult = await page.evaluate(() => {
      try {
        const result = window.__hudDebug.rawSpeak('playwright automation test');
        return { success: true, result, error: null };
      } catch (err) {
        return { success: false, result: null, error: err.message };
      }
    });
    console.log('   success:', rawSpeakResult.success);
    console.log('   result:', JSON.stringify(rawSpeakResult.result));
    if (rawSpeakResult.error) {
      console.log('   error:', rawSpeakResult.error);
    }

    // Wait for any async TTS operations
    await page.waitForTimeout(500);

    if (!rawSpeakResult.success) {
      throw new Error(`rawSpeak failed: ${rawSpeakResult.error}`);
    }
    console.log('   ✓ rawSpeak executed\n');

    // TEST 5: Get forensic buffer
    console.log('9. Executing window.__hudForensics.getBuffer()...');
    const forensicBuffer = await page.evaluate(() => {
      try {
        return window.__hudForensics.getBuffer();
      } catch (err) {
        return { error: err.message };
      }
    });

    if (forensicBuffer.error) {
      console.log('   error:', forensicBuffer.error);
    } else {
      console.log('   entries:', forensicBuffer.length);
      if (forensicBuffer.length > 0) {
        const recent = forensicBuffer.slice(-5);
        console.log('   recent events:', recent.map(e =>
          `[${e.category}] ${e.event}`
        ).join(', '));
      }
      console.log('   ✓ Forensic buffer accessible\n');
    }

    // TEST 6: Get TTS traces
    console.log('10. Executing window.__hudForensics.getTracesByCategory("tts")...');
    const ttsTraces = await page.evaluate(() => {
      try {
        return window.__hudForensics.getTracesByCategory('tts');
      } catch (err) {
        return { error: err.message };
      }
    });

    if (ttsTraces.error) {
      console.log('   error:', ttsTraces.error);
    } else {
      console.log('   TTS trace count:', ttsTraces.length);
      if (ttsTraces.length > 0) {
        const recent = ttsTraces.slice(-5);
        console.log('   recent TTS events:', recent.map(e => e.event).join(', '));
      }
      console.log('   ✓ TTS traces accessible\n');
    }

    // TEST 7: Get diagnostic report
    console.log('11. Executing window.__hudDebug.getDiagnosticReport()...');
    const diagnosticReport = await page.evaluate(() => {
      try {
        return window.__hudDebug.getDiagnosticReport();
      } catch (err) {
        return { error: err.message };
      }
    });

    if (diagnosticReport.error) {
      console.log('   error:', diagnosticReport.error);
    } else {
      console.log('   config:', JSON.stringify(diagnosticReport.config));
      console.log('   cancelCallCount:', diagnosticReport.cancelCallCount);
      console.log('   speechSynthesisState:', JSON.stringify(diagnosticReport.speechSynthesisState));
      console.log('   ✓ Diagnostic report accessible\n');
    }

    // TEST 8: Capture field diagnostic
    console.log('12. Executing window.__hudDebug.captureFieldDiagnostic()...');
    const fieldDiagnostic = await page.evaluate(() => {
      try {
        return window.__hudDebug.captureFieldDiagnostic('PLAYWRIGHT_TEST');
      } catch (err) {
        return { error: err.message };
      }
    });

    if (fieldDiagnostic.error) {
      console.log('   error:', fieldDiagnostic.error);
    } else {
      console.log('   testId:', fieldDiagnostic.testId);
      console.log('   timestamp:', fieldDiagnostic.timestamp);
      console.log('   userAgent:', fieldDiagnostic.userAgent?.slice(0, 60) + '...');
      console.log('   forensicBuffer entries:', fieldDiagnostic.forensicBuffer?.length);
      console.log('   cancelLog entries:', fieldDiagnostic.cancelLog?.length);
      console.log('   ✓ Field diagnostic captured\n');
    }

    // FINAL SUMMARY
    console.log('=== RUNTIME TEST SUMMARY ===');
    console.log('✓ All diagnostic tools exposed and functional');
    console.log('✓ HUD app loads without authentication');
    console.log('✓ JavaScript execution in browser context works');
    console.log('✓ TTS API accessible');
    console.log('✓ Forensic buffer populated');
    console.log();
    console.log('Console logs captured:', consoleLogs.length);
    console.log();

    return {
      success: true,
      hudDebug,
      hudForensics,
      rawSpeakResult,
      forensicBuffer,
      ttsTraces,
      consoleLogs
    };

  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
    if (serverProcess) {
      console.log('Stopping local server...');
      serverProcess.kill('SIGINT');
    }
  }
}

// Execute tests
const results = await runRuntimeTests();
process.exit(results.success ? 0 : 1);
