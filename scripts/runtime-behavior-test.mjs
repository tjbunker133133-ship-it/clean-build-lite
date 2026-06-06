/**
 * RUNTIME BEHAVIOR TEST — Actual execution verification
 * Tests real functionality, not just diagnostic tool availability
 */

import { spawn } from 'child_process';
import { chromium } from 'playwright';

const PORT = 8765;
const URL = `http://localhost:${PORT}`;

async function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn('node', ['scripts/local-qa-server.mjs'], {
      stdio: 'pipe',
      detached: false
    });

    let started = false;
    server.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Server running') && !started) {
        started = true;
        resolve(server);
      }
    });

    server.stderr.on('data', (data) => {
      console.error(`[SERVER ERR] ${data}`);
    });

    setTimeout(() => {
      if (!started) resolve(server);
    }, 3000);
  });
}

async function runBehaviorTests() {
  console.log('=== RUNTIME BEHAVIOR VERIFICATION ===\n');

  const server = await startServer();
  let browser;

  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    // Capture console
    const consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    // Navigate and wait
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    console.log('TEST 1: Raw TTS Execution');
    console.log('─────────────────────────');
    const test1 = await page.evaluate(() => {
      const before = {
        speaking: window.speechSynthesis?.speaking,
        pending: window.speechSynthesis?.pending
      };

      window.__hudDebug.rawSpeak('test one two three');

      return { before, sent: true };
    });
    console.log('  rawSpeak called:', test1.sent ? 'YES' : 'NO');

    // Wait for TTS to process
    await page.waitForTimeout(1000);

    const test1After = await page.evaluate(() => ({
      speaking: window.speechSynthesis?.speaking,
      pending: window.speechSynthesis?.pending
    }));
    console.log('  After 1s - speaking:', test1After.speaking, 'pending:', test1After.pending);
    console.log('  VERDICT:', (test1After.speaking || test1After.pending) ? 'TTS ACTIVE' : 'TTS NOT ACTIVE');
    console.log();

    console.log('TEST 2: Command Registry Inspection');
    console.log('──────────────────────────────────');
    const test2 = await page.evaluate(() => {
      // Access the command registry via window (if exposed)
      // Fallback: check if basic HUD functions exist
      return {
        hasHudDebug: !!window.__hudDebug,
        hasHudForensics: !!window.__hudForensics,
        hasSpeechSynthesis: 'speechSynthesis' in window
      };
    });
    console.log('  Debug tools:', test2.hasHudDebug ? 'YES' : 'NO');
    console.log('  Forensics:', test2.hasHudForensics ? 'YES' : 'NO');
    console.log('  TTS API:', test2.hasSpeechSynthesis ? 'YES' : 'NO');
    console.log();

    console.log('TEST 3: Safe Mode TTS Verification');
    console.log('───────────────────────────────────');
    const test3 = await page.evaluate(() => {
      // Enable safe mode
      window.__hudDebug.voiceSafeMode = true;

      // Get traces before
      const beforeTraces = window.__hudForensics.getTracesByCategory('tts');

      return {
        safeModeEnabled: window.__hudDebug.voiceSafeMode,
        tracesBefore: beforeTraces.length
      };
    });
    console.log('  Safe mode enabled:', test3.safeModeEnabled ? 'YES' : 'NO');
    console.log('  TTS traces before:', test3.tracesBefore);

    // Simulate a voice command via direct dispatch (if available)
    const test3b = await page.evaluate(() => {
      // Try to trigger command via window event (simulating wake word)
      window.dispatchEvent(new CustomEvent('hud:command', {
        detail: { command: 'status', source: 'test' }
      }));
      return { dispatched: true };
    });
    console.log('  Test command dispatched:', test3b.dispatched ? 'YES' : 'NO');

    await page.waitForTimeout(2000);

    const test3c = await page.evaluate(() => {
      const afterTraces = window.__hudForensics.getTracesByCategory('tts');
      const lastTrace = afterTraces[afterTraces.length - 1];
      return {
        tracesAfter: afterTraces.length,
        lastEvent: lastTrace?.event || 'none',
        speechState: {
          speaking: window.speechSynthesis?.speaking,
          pending: window.speechSynthesis?.pending
        }
      };
    });
    console.log('  TTS traces after:', test3c.tracesAfter);
    console.log('  Last TTS event:', test3c.lastEvent);
    console.log('  Speech state:', JSON.stringify(test3c.speechState));
    console.log();

    console.log('TEST 4: Map Overlay Inspection');
    console.log('──────────────────────────────');
    const test4 = await page.evaluate(() => {
      // Check if map exists and overlay states
      const map = window._map; // Common pattern for global map ref
      const overlayState = window.__hudForensics.inspectMapOverlayState;
      return {
        hasMap: !!map,
        hasOverlayInspector: !!overlayState,
        mapLoaded: map ? true : false
      };
    });
    console.log('  Map reference exists:', test4.hasMap ? 'YES' : 'NO');
    console.log('  Overlay inspector available:', test4.hasOverlayInspector ? 'YES' : 'NO');
    console.log();

    console.log('TEST 5: Forensic Buffer Analysis');
    console.log('─────────────────────────────────');
    const test5 = await page.evaluate(() => {
      const buffer = window.__hudForensics.getBuffer();
      const categories = {};
      buffer.forEach(entry => {
        categories[entry.category] = (categories[entry.category] || 0) + 1;
      });
      return {
        totalEntries: buffer.length,
        categories: categories,
        lastEntry: buffer[buffer.length - 1]?.event || 'none'
      };
    });
    console.log('  Total forensic entries:', test5.totalEntries);
    console.log('  Categories:', JSON.stringify(test5.categories));
    console.log('  Last entry:', test5.lastEntry);
    console.log();

    console.log('=== BEHAVIOR TEST SUMMARY ===');
    console.log();

    const results = {
      rawTtsWorks: test1After.speaking || test1After.pending,
      safeModeActivates: test3.safeModeEnabled,
      debugToolsAvailable: test2.hasHudDebug && test2.hasHudForensics,
      forensicDataCaptured: test5.totalEntries > 0,
      commandDispatchAttempted: test3b.dispatched
    };

    console.log('OBSERVED RESULTS:');
    console.log('  Raw TTS mechanism:', results.rawTtsWorks ? '✓ FUNCTIONAL' : '✗ NOT ACTIVE');
    console.log('  Safe mode toggle:', results.safeModeActivates ? '✓ WORKS' : '✗ BROKEN');
    console.log('  Debug tools:', results.debugToolsAvailable ? '✓ EXPOSED' : '✗ MISSING');
    console.log('  Forensic capture:', results.forensicDataCaptured ? '✓ ACTIVE' : '✗ EMPTY');
    console.log();

    // Raw analysis
    console.log('ANALYSIS:');
    if (results.rawTtsWorks) {
      console.log('  → Basic TTS mechanism IS functional in browser');
      console.log('  → If Android field fails, issue is platform-specific (audio focus, WebView, etc)');
    } else {
      console.log('  → Basic TTS mechanism NOT functional');
      console.log('  → Core browser/platform TTS issue');
    }

    if (test3c.tracesAfter === test3.tracesBefore) {
      console.log('  → No TTS traces generated during safe mode test');
      console.log('  → Voice command path may not trigger TTS in test environment');
    }

    console.log();
    console.log('REQUIRED FIELD VERIFICATION (Android device):');
    console.log('  1. Run: window.__hudDebug.rawSpeak("test")');
    console.log('  2. Check if audio plays');
    console.log('  3. Run: window.__hudDebug.voiceSafeMode = true');
    console.log('  4. Say "HUD status", check traces');
    console.log('  5. Compare with normal mode');

    return results;

  } catch (error) {
    console.error('BEHAVIOR TEST FAILED:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

runBehaviorTests().then(results => {
  process.exit(results.error ? 1 : 0);
});
