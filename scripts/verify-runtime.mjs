/**
 * Runtime browser validation script
 * Uses Playwright to verify production deployment diagnostic tools
 */

import { chromium } from 'playwright';

const QA_URL = 'https://hud-v1-d2xlflxng-tjbunker133133-9220s-projects.vercel.app';

async function validateRuntime() {
  console.log('=== PLAYWRIGHT RUNTIME VALIDATION ===\n');

  let browser;
  let page;

  try {
    // Launch browser
    console.log('1. Launching Chromium...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('   ✓ Browser launched\n');

    // Create context and page
    console.log('2. Creating browser context...');
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    page = await context.newPage();

    // Capture console logs
    page.on('console', msg => {
      console.log(`   [BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', error => {
      console.log(`   [BROWSER ERROR] ${error.message}`);
    });

    console.log('   ✓ Context created\n');

    // Navigate to QA deployment
    console.log(`3. Navigating to ${QA_URL}...`);
    await page.goto(QA_URL, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('   ✓ Page loaded\n');

    // Wait for hydration
    console.log('4. Waiting for app hydration...');
    await page.waitForTimeout(3000);
    console.log('   ✓ Hydration wait complete\n');

    // Test 1: Verify window.__hudDebug exists
    console.log('5. Verifying window.__hudDebug...');
    const hudDebug = await page.evaluate(() => {
      return {
        exists: typeof window.__hudDebug !== 'undefined',
        keys: typeof window.__hudDebug === 'object' ? Object.keys(window.__hudDebug) : [],
        rawSpeakExists: typeof window.__hudDebug?.rawSpeak === 'function',
        captureFieldDiagnosticExists: typeof window.__hudDebug?.captureFieldDiagnostic === 'function',
        exportFieldReportExists: typeof window.__hudDebug?.exportFieldReport === 'function',
        getDiagnosticReportExists: typeof window.__hudDebug?.getDiagnosticReport === 'function'
      };
    });
    console.log('   __hudDebug exists:', hudDebug.exists);
    console.log('   Available methods:', hudDebug.keys.join(', '));
    console.log('   rawSpeak:', hudDebug.rawSpeakExists ? '✓' : '✗');
    console.log('   captureFieldDiagnostic:', hudDebug.captureFieldDiagnosticExists ? '✓' : '✗');
    console.log('   exportFieldReport:', hudDebug.exportFieldReportExists ? '✓' : '✗');
    console.log('   getDiagnosticReport:', hudDebug.getDiagnosticReportExists ? '✓' : '✗');
    console.log();

    // Test 2: Verify window.__hudForensics exists
    console.log('6. Verifying window.__hudForensics...');
    const hudForensics = await page.evaluate(() => {
      return {
        exists: typeof window.__hudForensics !== 'undefined',
        keys: typeof window.__hudForensics === 'object' ? Object.keys(window.__hudForensics) : [],
        getBufferExists: typeof window.__hudForensics?.getBuffer === 'function',
        getTracesByCategoryExists: typeof window.__hudForensics?.getTracesByCategory === 'function',
        inspectSpeechSynthesisExists: typeof window.__hudForensics?.inspectSpeechSynthesis === 'function'
      };
    });
    console.log('   __hudForensics exists:', hudForensics.exists);
    console.log('   Available methods:', hudForensics.keys.join(', '));
    console.log('   getBuffer:', hudForensics.getBufferExists ? '✓' : '✗');
    console.log('   getTracesByCategory:', hudForensics.getTracesByCategoryExists ? '✓' : '✗');
    console.log('   inspectSpeechSynthesis:', hudForensics.inspectSpeechSynthesisExists ? '✓' : '✗');
    console.log();

    // Test 3: Verify speechSynthesis API
    console.log('7. Verifying speechSynthesis API...');
    const speechSynth = await page.evaluate(() => {
      return {
        exists: 'speechSynthesis' in window,
        speaking: window.speechSynthesis?.speaking ?? null,
        pending: window.speechSynthesis?.pending ?? null,
        paused: window.speechSynthesis?.paused ?? null,
        voices: window.speechSynthesis?.getVoices()?.length ?? 0
      };
    });
    console.log('   speechSynthesis exists:', speechSynth.exists);
    console.log('   speaking:', speechSynth.speaking);
    console.log('   pending:', speechSynth.pending);
    console.log('   paused:', speechSynth.paused);
    console.log('   voice count:', speechSynth.voices);
    console.log();

    // Test 4: Attempt rawSpeak execution (we can validate it runs even if we can't hear it)
    console.log('8. Executing window.__hudDebug.rawSpeak()...');
    const rawSpeakResult = await page.evaluate(() => {
      try {
        const result = window.__hudDebug.rawSpeak('playwright runtime test');
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    console.log('   rawSpeak executed:', rawSpeakResult.success ? '✓' : '✗');
    if (!rawSpeakResult.success) {
      console.log('   Error:', rawSpeakResult.error);
    } else {
      console.log('   Result:', JSON.stringify(rawSpeakResult.result));
    }
    console.log();

    // Test 5: Get diagnostic report
    console.log('9. Executing window.__hudDebug.getDiagnosticReport()...');
    const diagnosticReport = await page.evaluate(() => {
      try {
        return window.__hudDebug.getDiagnosticReport();
      } catch (err) {
        return { error: err.message };
      }
    });
    console.log('   Diagnostic report retrieved:', diagnosticReport.error ? '✗' : '✓');
    if (!diagnosticReport.error) {
      console.log('   Config:', JSON.stringify(diagnosticReport.config));
      console.log('   Speech synthesis state:', JSON.stringify(diagnosticReport.speechSynthesisState));
    }
    console.log();

    // Test 6: Get forensic buffer
    console.log('10. Executing window.__hudForensics.getBuffer()...');
    const forensicBuffer = await page.evaluate(() => {
      try {
        return window.__hudForensics.getBuffer();
      } catch (err) {
        return { error: err.message };
      }
    });
    console.log('   Forensic buffer retrieved:', forensicBuffer.error ? '✗' : '✓');
    if (!forensicBuffer.error) {
      console.log('   Buffer entries:', forensicBuffer.length);
      if (forensicBuffer.length > 0) {
        console.log('   Recent events:', forensicBuffer.slice(-5).map(e => e.event || e.category).join(', '));
      }
    }
    console.log();

    // Test 7: Get TTS traces
    console.log('11. Executing window.__hudForensics.getTracesByCategory("tts")...');
    const ttsTraces = await page.evaluate(() => {
      try {
        return window.__hudForensics.getTracesByCategory('tts');
      } catch (err) {
        return { error: err.message };
      }
    });
    console.log('   TTS traces retrieved:', ttsTraces.error ? '✗' : '✓');
    if (!ttsTraces.error) {
      console.log('   TTS trace count:', ttsTraces.length);
    }
    console.log();

    // Final Summary
    console.log('=== VALIDATION SUMMARY ===');
    const allPassed = hudDebug.exists && hudForensics.exists && rawSpeakResult.success;
    console.log('Overall Status:', allPassed ? '✓ RUNTIME TOOLS AVAILABLE' : '✗ SOME TOOLS MISSING');
    console.log();
    console.log('Verified capabilities:');
    console.log('  - Chromium browser automation: ✓');
    console.log('  - Page navigation and hydration: ✓');
    console.log('  - JavaScript execution in page context: ✓');
    console.log('  - HUD debug object exposure:', hudDebug.exists ? '✓' : '✗');
    console.log('  - HUD forensics object exposure:', hudForensics.exists ? '✓' : '✗');
    console.log('  - TTS API detection:', speechSynth.exists ? '✓' : '✗');
    console.log('  - Function execution (rawSpeak):', rawSpeakResult.success ? '✓' : '✗');
    console.log();

    return {
      success: allPassed,
      hudDebug,
      hudForensics,
      speechSynth,
      rawSpeakResult,
      diagnosticReport,
      forensicBuffer
    };

  } catch (error) {
    console.error('VALIDATION FAILED:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      console.log('\nClosing browser...');
      await browser.close();
    }
  }
}

// Execute
const results = await validateRuntime();
process.exit(results.success ? 0 : 1);
