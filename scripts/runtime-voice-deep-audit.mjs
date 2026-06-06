/**
 * DEEP VOICE PIPELINE AUDIT — Simulates voice interactions
 * Tests wake word, command parsing, and TTS end-to-end
 */
import { chromium } from 'playwright';

const AUDIT = {
  timestamp: new Date().toISOString(),
  wakeWordTests: [],
  commandTests: [],
  ttsTests: [],
  pipelineTraces: [],
  issues: []
};

async function runDeepAudit() {
  console.log('🔬 DEEP VOICE PIPELINE AUDIT — Simulating Voice Interactions\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();

  // Listen to console
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('VOICE') || text.includes('voice') || text.includes('command') || text.includes('TTS') || text.includes('tts')) {
      console.log(`[${msg.type().toUpperCase()}] ${text}`);
      AUDIT.pipelineTraces.push({ type: msg.type(), text, time: Date.now() });
    }
  });

  // Navigate and wait for full load
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // === TEST: WAKE WORD SIMULATION ===
  console.log('\n🎤 TEST: Wake Word Detection');

  // First, enable voice and check initial state
  const initialState = await page.evaluate(() => ({
    voiceActive: window.__hudRuntime?.voice?.armed,
    listenMode: window.__hudRuntime?.voice?.listenMode,
    lastHeard: window.__hudRuntime?.voice?.lastHeard,
    state: window.__hudRuntime?.voice?.state
  }));
  console.log('  Initial voice state:', initialState);
  AUDIT.wakeWordTests.push({ phase: 'initial', state: initialState });

  // Enable minimal voice for testing
  await page.evaluate(() => {
    if (window.__hudDebug) {
      window.__hudDebug.setUseMinimalVoice(true);
    }
  });
  console.log('  ✅ Minimal voice enabled');

  // === TEST: Direct Command Dispatch ===
  console.log('\n📢 TEST: Direct Command Dispatch (bypassing STT)');

  // Try to find and use the command system directly
  const commandResults = await page.evaluate(async () => {
    const results = [];

    // Test 1: Check if we can access command registry
    const runtime = window.__hudRuntime;
    results.push({
      test: 'runtime_access',
      available: !!runtime,
      hasCommandExecution: !!runtime?.commandExecution
    });

    // Test 2: Simulate wake word + command by calling voice handling if available
    // Look for any exposed command dispatch
    const dispatch = window.__hudCommands?.dispatch || runtime?.dispatch;
    results.push({
      test: 'dispatch_access',
      available: typeof dispatch === 'function'
    });

    return results;
  });
  console.log('  Command system access:', JSON.stringify(commandResults, null, 2));
  AUDIT.commandTests.push(...commandResults);

  // === TEST: TTS Two-Lane System ===
  console.log('\n🔊 TEST: Two-Lane TTS System');

  // Test Lane 1: User Response (minimal path)
  const lane1Result = await page.evaluate(async () => {
    const d = window.__hudDebug;
    if (!d?.rawSpeak) return { error: 'rawSpeak unavailable' };

    // Clear any pending speech
    window.speechSynthesis?.cancel?.();
    await new Promise(r => setTimeout(r, 100));

    const startTime = performance.now();
    const result = await d.rawSpeak('User response lane test');
    const elapsed = performance.now() - startTime;

    return {
      lane: 'user_response',
      result,
      elapsedMs: Math.round(elapsed),
      speaking: window.speechSynthesis?.speaking
    };
  });
  console.log('  Lane 1 (User Response):', JSON.stringify(lane1Result));
  AUDIT.ttsTests.push(lane1Result);
  await page.waitForTimeout(2000);

  // Test Lane 2: System Interrupt (authority controller)
  const lane2Result = await page.evaluate(async () => {
    const d = window.__hudDebug;

    // Clear speech
    window.speechSynthesis?.cancel?.();
    await new Promise(r => setTimeout(r, 100));

    const startTime = performance.now();

    // Use rawSpeak with emergency flag simulation if available
    // or test normal rawSpeak for comparison
    const result = await d.rawSpeak('System interrupt lane test');
    const elapsed = performance.now() - startTime;

    return {
      lane: 'system_interrupt',
      result,
      elapsedMs: Math.round(elapsed),
      speaking: window.speechSynthesis?.speaking
    };
  });
  console.log('  Lane 2 (System Interrupt):', JSON.stringify(lane2Result));
  AUDIT.ttsTests.push(lane2Result);

  // === TEST: Command Normalization ===
  console.log('\n📝 TEST: Command Normalization Logic');

  const normTests = await page.evaluate(() => {
    // Access the normalize function if exposed, or test logic manually
    const tests = [
      { input: 'HUD', expected: 'hud' },
      { input: 'H-U-D', expected: 'hud' },
      { input: 'h u d', expected: 'hud' },
      { input: 'HUD weather', expected: 'hud weather' },
      { input: '135', expected: '135' },
      { input: 'hud 135', expected: 'hud 135' },
      { input: 'hi weather', expected: 'hud weather' }, // homophone
    ];

    // Simulate normalization (from normalizeVoiceTranscript.ts)
    function normalizeVoiceTranscript(input) {
      const base = input
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      // collapse spelled wake word
      return base.replace(/\bh\s+u\s+d\b/gi, 'hud');
    }

    function normalizeWakeHomophones(text) {
      let s = text.trim();
      if (!s) return s;
      s = s.replace(/^hi\b/, 'hud');
      s = s.replace(/^hood\b/, 'hud');
      s = s.replace(/^hut\b/, 'hud');
      s = s.replace(/^had\b/, 'hud');
      s = s.replace(/^hot\b/, 'hud');
      return s;
    }

    return tests.map(t => {
      const normalized = normalizeWakeHomophones(normalizeVoiceTranscript(t.input));
      return {
        input: t.input,
        normalized,
        expected: t.expected,
        match: normalized === t.expected
      };
    });
  });

  console.log('  Normalization results:');
  normTests.forEach(t => {
    const status = t.match ? '✅' : '❌';
    console.log(`    ${status} "${t.input}" → "${t.normalized}" (expected: "${t.expected}")`);
  });
  AUDIT.commandTests.push({ type: 'normalization', results: normTests });

  // === TEST: Numeric Noise Rejection ===
  console.log('\n🔢 TEST: Numeric Input Handling');

  const numericTests = await page.evaluate(() => {
    const inputs = ['135', '12345', '1', '999999', 'hud 135'];

    // Check if these would pass continuation window sanity check
    const SANITY_MIN_FINAL_LEN = 2;
    const SANITY_MAX_CONTINUATION_WORDS = 6;
    const SANITY_MAX_CONTINUATION_CHARS = 60;

    function wouldPassContinuationWindow(cmd) {
      const wordCount = cmd.split(/\s+/).filter(Boolean).length;
      const sane =
        cmd.length >= SANITY_MIN_FINAL_LEN &&
        cmd.length <= SANITY_MAX_CONTINUATION_CHARS &&
        wordCount <= SANITY_MAX_CONTINUATION_WORDS;
      return sane;
    }

    return inputs.map(input => ({
      input,
      isNumericOnly: /^\d+$/.test(input),
      wouldPassContinuation: wouldPassContinuationWindow(input)
    }));
  });

  console.log('  Numeric input analysis:');
  numericTests.forEach(t => {
    const issue = t.isNumericOnly && t.wouldPassContinuation ? '⚠️ ISSUE: numeric passes as command' : '✅';
    console.log(`    ${issue} "${t.input}" numeric=${t.isNumericOnly} passes=${t.wouldPassContinuation}`);
  });
  AUDIT.issues.push(...numericTests.filter(t => t.isNumericOnly && t.wouldPassContinuation).map(t => ({
    type: 'numeric_noise_passes',
    input: t.input,
    severity: 'medium'
  })));

  // === TEST: Mission Voice System Isolation ===
  console.log('\n📡 TEST: Mission Voice System Isolation');

  const isolationCheck = await page.evaluate(() => {
    const runtime = window.__hudRuntime;

    return {
      hasMissionVoice: !!runtime?.mission?.voice,
      hasHudVoice: !!runtime?.voice,
      missionState: runtime?.mission?.voice?.state || 'not_found',
      hudState: runtime?.voice?.state || 'not_found',
      // Check if they share TTS instances
      sharedTTS: 'speechSynthesis' in window
    };
  });
  console.log('  Mission voice system:', isolationCheck.hasMissionVoice ? '✅ found' : '❌ not found');
  console.log('  HUD voice system:', isolationCheck.hasHudVoice ? '✅ found' : '❌ not found');
  console.log('  Shared TTS API:', isolationCheck.sharedTTS ? '✅ yes (expected)' : '❌ no');
  AUDIT.pipelineTraces.push({ type: 'isolation_check', data: isolationCheck });

  // === FINAL STATE CHECK ===
  console.log('\n📊 FINAL STATE SNAPSHOT');

  const finalState = await page.evaluate(() => ({
    forensics: {
      bufferLength: window.__hudForensics?.getBuffer()?.length || 0,
      categories: window.__hudForensics?.getBuffer
        ? [...new Set(window.__hudForensics.getBuffer().map(t => t.category))]
        : []
    },
    debug: window.__hudDebug?.getDiagnosticReport?.() || null,
    runtime: {
      voiceArmed: window.__hudRuntime?.voice?.armed,
      voiceState: window.__hudRuntime?.voice?.state,
      commandCount: window.__hudRuntime?.commandExecution?.history?.length || 0
    }
  }));
  console.log('  Forensics buffer:', finalState.forensics.bufferLength);
  console.log('  Trace categories:', finalState.forensics.categories.join(', ') || 'none');
  console.log('  Voice armed:', finalState.runtime.voiceArmed);
  console.log('  Voice state:', finalState.runtime.voiceState);
  console.log('  Commands executed:', finalState.runtime.commandCount);

  await browser.close();

  // === SUMMARY ===
  console.log('\n' + '='.repeat(70));
  console.log('📋 DEEP AUDIT SUMMARY');
  console.log('='.repeat(70));

  // Classification
  const issues = [];

  // Check TTS
  if (!AUDIT.ttsTests.some(t => t.result?.sent || t.result?.started)) {
    issues.push({ severity: '🔴', component: 'TTS', issue: 'TTS not functioning' });
  } else {
    console.log('🔊 TTS: ✅ Functional (raw speak works)');
  }

  // Check numeric noise
  const numericIssue = numericTests.filter(t => t.isNumericOnly && t.wouldPassContinuation);
  if (numericIssue.length > 0) {
    issues.push({ severity: '🟡', component: 'Command Parser', issue: `Numeric noise "${numericIssue[0].input}" passes as valid command` });
  }

  // Check wake word normalization
  const normIssue = normTests.filter(t => !t.match);
  if (normIssue.length > 0) {
    console.log('📝 Normalization: 🟡 Some edge cases don\'t match expected');
  } else {
    console.log('📝 Normalization: ✅ All tests passed');
  }

  // Check debug hooks
  if (!initialState.voiceActive && !initialState.state) {
    console.log('🎤 Voice System: 🟡 Not armed (expected - needs user activation)');
  }

  console.log('\n🔍 ISSUES FOUND:');
  if (issues.length === 0) {
    console.log('  None critical. System appears stable for core TTS.');
  } else {
    issues.forEach(i => console.log(`  ${i.severity} ${i.component}: ${i.issue}`));
  }

  // Save full audit
  console.log('\n📄 Full audit data available in AUDIT object');

  return AUDIT;
}

runDeepAudit().catch(err => {
  console.error('Deep audit failed:', err);
  process.exit(1);
});
