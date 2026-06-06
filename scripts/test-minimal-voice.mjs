/**
 * Test minimal voice path integration
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

async function runMinimalVoiceTest() {
  console.log('=== MINIMAL VOICE PATH TEST ===\n');

  const server = await startServer();
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    const consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    console.log('TEST: Minimal Voice Toggle');
    console.log('───────────────────────────');

    // Check if useMinimalVoice is available
    const test1 = await page.evaluate(() => {
      return {
        hasDebug: !!window.__hudDebug,
        hasUseMinimalVoice: 'useMinimalVoice' in (window.__hudDebug || {}),
        canSet: typeof window.__hudDebug?.setUseMinimalVoice === 'function',
        initialValue: window.__hudDebug?.useMinimalVoice,
        allKeys: window.__hudDebug ? Object.keys(window.__hudDebug) : []
      };
    });
    console.log('  __hudDebug exists:', test1.hasDebug ? 'YES' : 'NO');
    console.log('  useMinimalVoice property:', test1.hasUseMinimalVoice ? 'YES' : 'NO');
    console.log('  setUseMinimalVoice function:', test1.canSet ? 'YES' : 'NO');
    console.log('  Initial value:', test1.initialValue);
    console.log('  Available methods:', test1.allKeys.join(', '));
    console.log();

    // Enable minimal voice
    const test2 = await page.evaluate(() => {
      const before = window.__hudDebug?.useMinimalVoice;
      window.__hudDebug.useMinimalVoice = true;
      const after = window.__hudDebug?.useMinimalVoice;
      return { before, after };
    });
    console.log('  Before toggle:', test2.before);
    console.log('  After toggle:', test2.after);
    console.log('  Toggle worked:', test2.after === true ? 'YES' : 'NO');
    console.log();

    // Verify diagnostic report includes minimal voice state
    const test3 = await page.evaluate(() => {
      const report = window.__hudDebug.getDiagnosticReport();
      return {
        hasMinimalVoiceState: !!report.minimalVoiceState,
        minimalVoiceState: report.minimalVoiceState,
        configUseMinimalVoice: report.config?.useMinimalVoice
      };
    });
    console.log('  Diagnostic report has minimalVoiceState:', test3.hasMinimalVoiceState ? 'YES' : 'NO');
    console.log('  Minimal voice state:', JSON.stringify(test3.minimalVoiceState));
    console.log('  Config reflects toggle:', test3.configUseMinimalVoice === true ? 'YES' : 'NO');
    console.log();

    // Test minimal speak function (via internal module if exposed, or simulate)
    const test4 = await page.evaluate(() => {
      // Try to find the minimal voice state getter
      const report = window.__hudDebug.getDiagnosticReport();
      return {
        minimalVoiceActive: report.minimalVoiceState?.isSpeaking,
        hasUtterance: report.minimalVoiceState?.hasUtterance,
        synthSpeaking: report.minimalVoiceState?.synthSpeaking
      };
    });
    console.log('  Minimal voice state active:', test4.minimalVoiceActive);
    console.log('  Has utterance:', test4.hasUtterance);
    console.log('  Synth speaking:', test4.synthSpeaking);
    console.log();

    console.log('=== MINIMAL VOICE TEST SUMMARY ===');
    console.log();

    const results = {
      toggleAvailable: test1.hasUseMinimalVoice && test1.canSet,
      toggleWorks: test2.after === true,
      diagnosticIncludesState: test3.hasMinimalVoiceState,
      configReflectsToggle: test3.configUseMinimalVoice === true
    };

    console.log('RESULTS:');
    console.log('  Minimal voice toggle available:', results.toggleAvailable ? '✓ YES' : '✗ NO');
    console.log('  Toggle function works:', results.toggleWorks ? '✓ YES' : '✗ NO');
    console.log('  Diagnostic captures state:', results.diagnosticIncludesState ? '✓ YES' : '✗ NO');
    console.log('  Config reflects change:', results.configReflectsToggle ? '✓ YES' : '✗ NO');
    console.log();

    if (results.toggleAvailable && results.toggleWorks) {
      console.log('✓ MINIMAL VOICE PATH IS READY FOR FIELD TESTING');
      console.log();
      console.log('ANDROID FIELD TEST PROTOCOL:');
      console.log('  1. Open app on Android device');
      console.log('  2. Open DevTools Remote');
      console.log('  3. Run: window.__hudDebug.useMinimalVoice = true');
      console.log('  4. Say: "HUD status" repeatedly');
      console.log('  5. Verify: Audio plays each time');
      console.log('  6. Test rapid commands: "HUD weather", "HUD battery"');
      console.log('  7. If stable: minimal path proven');
      console.log('  8. If unstable: investigate platform issue');
    } else {
      console.log('✗ MINIMAL VOICE PATH NOT PROPERLY INTEGRATED');
    }

    return results;

  } catch (error) {
    console.error('TEST FAILED:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

runMinimalVoiceTest().then(results => {
  process.exit(results.error ? 1 : 0);
});
