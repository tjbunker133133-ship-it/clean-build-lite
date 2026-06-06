/**
 * RUNTIME VOICE AUDIT — STRICT VERIFICATION
 * No code changes, only observation and evidence collection
 */
import { chromium } from 'playwright';

const AUDIT_RESULTS = {
  timestamp: new Date().toISOString(),
  tests: {},
  console: [],
  forensics: null,
  debug: null,
  hudRuntime: null
};

async function runAudit() {
  console.log('🔍 HUD RUNTIME VOICE AUDIT — Starting...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  const context = await browser.newContext({
    permissions: ['microphone']
  });

  const page = await context.newPage();

  // Collect console logs
  page.on('console', msg => {
    const entry = {
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now()
    };
    AUDIT_RESULTS.console.push(entry);
    if (msg.type() === 'error' || msg.text().includes('VOICE') || msg.text().includes('voice')) {
      console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  // Navigate to app
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // === TEST 1: DEBUG HOOKS AVAILABILITY ===
  console.log('\n📋 TEST 1: Debug Hooks Availability');
  const hooksAvailable = await page.evaluate(() => ({
    hudDebug: typeof window.__hudDebug !== 'undefined',
    hudForensics: typeof window.__hudForensics !== 'undefined',
    hudRuntime: typeof window.__hudRuntime !== 'undefined',
    hudMap: typeof window.__hudMap !== 'undefined'
  }));
  AUDIT_RESULTS.tests.debugHooks = hooksAvailable;
  console.log('  __hudDebug:', hooksAvailable.hudDebug ? '✅' : '❌');
  console.log('  __hudForensics:', hooksAvailable.hudForensics ? '✅' : '❌');
  console.log('  __hudRuntime:', hooksAvailable.hudRuntime ? '✅' : '❌');
  console.log('  __hudMap:', hooksAvailable.hudMap ? '✅' : '❌');

  // === TEST 2: TTS AVAILABILITY ===
  console.log('\n📋 TEST 2: TTS System Check');
  const ttsCheck = await page.evaluate(() => ({
    speechSynthesis: typeof window.speechSynthesis !== 'undefined',
    voices: window.speechSynthesis?.getVoices()?.length || 0,
    speaking: window.speechSynthesis?.speaking,
    pending: window.speechSynthesis?.pending,
    paused: window.speechSynthesis?.paused
  }));
  AUDIT_RESULTS.tests.tts = ttsCheck;
  console.log('  speechSynthesis API:', ttsCheck.speechSynthesis ? '✅' : '❌');
  console.log('  Voices available:', ttsCheck.voices);
  console.log('  Currently speaking:', ttsCheck.speaking);
  console.log('  Pending:', ttsCheck.pending);

  // === TEST 3: RAW TTS TEST ===
  console.log('\n📋 TEST 3: Raw TTS Execution');
  const rawTtsResult = await page.evaluate(async () => {
    if (!window.speechSynthesis) return { error: 'TTS not available' };

    const testUtterance = new SpeechSynthesisUtterance('HUD voice audit test');
    testUtterance.rate = 0.9;
    testUtterance.volume = 1;

    let started = false;
    let ended = false;
    let error = null;

    testUtterance.onstart = () => { started = true; };
    testUtterance.onend = () => { ended = true; };
    testUtterance.onerror = (e) => { error = e.error; };

    window.speechSynthesis.speak(testUtterance);

    // Wait up to 5 seconds
    await new Promise(r => setTimeout(r, 5000));

    return { started, ended, error, speaking: window.speechSynthesis.speaking };
  });
  AUDIT_RESULTS.tests.rawTts = rawTtsResult;
  console.log('  TTS started:', rawTtsResult.started ? '✅' : '❌');
  console.log('  TTS ended:', rawTtsResult.ended ? '✅' : '⏳');
  console.log('  Error:', rawTtsResult.error || 'None');

  // === TEST 4: VOICE PANEL STATE ===
  console.log('\n📋 TEST 4: Voice Panel State');
  const voiceState = await page.evaluate(() => {
    // Check for voice-related UI elements
    const voiceButton = document.querySelector('[data-voice-button], [data-no-drag] button');
    const statusText = document.body.innerText.includes('🎤') ||
                       document.body.innerText.includes('voice') ||
                       document.body.innerText.includes('HUD');

    // Get any visible voice-related text
    const allText = document.body.innerText;
    const voiceMatches = allText.match(/🎤[^\n]*/g) || [];

    return {
      voiceButtonFound: !!voiceButton,
      voiceStatusIndicators: voiceMatches.slice(0, 5),
      hasVoiceUI: statusText
    };
  });
  AUDIT_RESULTS.tests.voiceUI = voiceState;
  console.log('  Voice button found:', voiceState.voiceButtonFound ? '✅' : '❌');
  console.log('  Voice status indicators:', voiceState.voiceStatusIndicators.length > 0 ? voiceState.voiceStatusIndicators : 'None visible');

  // === TEST 5: FORENSICS TRACE CHECK ===
  console.log('\n📋 TEST 5: Forensics System');
  if (hooksAvailable.hudForensics) {
    const forensics = await page.evaluate(() => {
      const f = window.__hudForensics;
      return {
        bufferLength: f?.getBuffer()?.length || 0,
        voiceTraces: f?.getTracesByCategory?.('voice')?.length || 0,
        ttsTraces: f?.getTracesByCategory?.('tts')?.length || 0,
        commandTraces: f?.getTracesByCategory?.('command')?.length || 0,
        lastTrace: f?.getBuffer()?.slice(-1)[0] || null
      };
    });
    AUDIT_RESULTS.forensics = forensics;
    console.log('  Trace buffer size:', forensics.bufferLength);
    console.log('  Voice traces:', forensics.voiceTraces);
    console.log('  TTS traces:', forensics.ttsTraces);
    console.log('  Command traces:', forensics.commandTraces);
    if (forensics.lastTrace) {
      console.log('  Last trace:', forensics.lastTrace.type, forensics.lastTrace.payload);
    }
  } else {
    console.log('  ❌ __hudForensics not available');
  }

  // === TEST 6: DEBUG CONFIG CHECK ===
  console.log('\n📋 TEST 6: Debug Configuration');
  if (hooksAvailable.hudDebug) {
    const debugConfig = await page.evaluate(() => {
      const d = window.__hudDebug;
      return {
        rawMode: d?.rawMode,
        voiceSafeMode: d?.voiceSafeMode,
        useMinimalVoice: d?.useMinimalVoice,
        hasRawSpeak: typeof d?.rawSpeak === 'function',
        hasDiagnosticReport: typeof d?.getDiagnosticReport === 'function'
      };
    });
    AUDIT_RESULTS.debug = debugConfig;
    console.log('  rawMode:', debugConfig.rawMode);
    console.log('  voiceSafeMode:', debugConfig.voiceSafeMode);
    console.log('  useMinimalVoice:', debugConfig.useMinimalVoice);
    console.log('  rawSpeak function:', debugConfig.hasRawSpeak ? '✅' : '❌');
    console.log('  getDiagnosticReport:', debugConfig.hasDiagnosticReport ? '✅' : '❌');
  } else {
    console.log('  ❌ __hudDebug not available');
  }

  // === TEST 7: COMMAND REGISTRY CHECK ===
  console.log('\n📋 TEST 7: Command Registry');
  const commandCheck = await page.evaluate(() => {
    // Check if command system is available via runtime snapshot
    const runtime = window.__hudRuntime;
    if (runtime?.commandExecution?.history) {
      return {
        historyCount: runtime.commandExecution.history.length,
        lastCommand: runtime.commandExecution.history[0] || null
      };
    }
    return { historyCount: 0, lastCommand: null, note: 'Command history not available' };
  });
  AUDIT_RESULTS.tests.commands = commandCheck;
  console.log('  Command history entries:', commandCheck.historyCount);
  if (commandCheck.lastCommand) {
    console.log('  Last command:', commandCheck.lastCommand.id, commandCheck.lastCommand.status);
  }

  // === TEST 8: ATTEMPT MINIMAL VOICE TEST ===
  console.log('\n📋 TEST 8: Minimal Voice Path Test');
  if (hooksAvailable.hudDebug) {
    const minimalVoiceResult = await page.evaluate(async () => {
      const d = window.__hudDebug;
      if (!d?.rawSpeak) return { error: 'rawSpeak not available' };

      // Enable minimal voice
      d.useMinimalVoice = true;

      const result = await d.rawSpeak('Minimal voice test');
      return {
        result,
        speakingAfter: window.speechSynthesis?.speaking,
        useMinimalVoice: d.useMinimalVoice
      };
    });
    AUDIT_RESULTS.tests.minimalVoice = minimalVoiceResult;
    console.log('  rawSpeak result:', JSON.stringify(minimalVoiceResult.result));
    console.log('  Speaking after call:', minimalVoiceResult.speakingAfter);
  }

  // === TEST 9: MAP & OVERLAY CHECK ===
  console.log('\n📋 TEST 9: Map & Overlay System');
  if (hooksAvailable.hudMap) {
    const mapState = await page.evaluate(() => {
      const map = window.__hudMap;
      return {
        mapExists: !!map,
        zoom: map?.getZoom?.(),
        center: map?.getCenter?.(),
        styleLoaded: map?.isStyleLoaded?.()
      };
    });
    AUDIT_RESULTS.tests.map = mapState;
    console.log('  Map exists:', mapState.mapExists ? '✅' : '❌');
    console.log('  Current zoom:', mapState.zoom);
    console.log('  Style loaded:', mapState.styleLoaded);
  } else {
    console.log('  ❌ __hudMap not available');
  }

  // Final diagnostics collection
  if (hooksAvailable.hudDebug && hooksAvailable.hudForensics) {
    AUDIT_RESULTS.finalDiagnostics = await page.evaluate(() => ({
      diagnosticReport: window.__hudDebug?.getDiagnosticReport?.() || null,
      recentTraces: window.__hudForensics?.getTracesByCategory?.('voice')?.slice(-5) || []
    }));
  }

  await browser.close();

  // === OUTPUT SUMMARY ===
  console.log('\n' + '='.repeat(60));
  console.log('📊 AUDIT COMPLETE — RAW RESULTS');
  console.log('='.repeat(60));
  console.log(JSON.stringify(AUDIT_RESULTS, null, 2));

  return AUDIT_RESULTS;
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
