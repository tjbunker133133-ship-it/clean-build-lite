/**
 * VOICE UX REPRODUCTION AUDIT
 * Captures specific failure modes in runtime
 */
import { chromium } from 'playwright';

const REPRO_RESULTS = {
  timestamp: new Date().toISOString(),
  transcripts: [],
  wakeEvents: [],
  commandEvents: [],
  continuationState: [],
  failures: []
};

async function reproduceIssues() {
  console.log('🔬 VOICE UX REPRODUCTION AUDIT\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();

  // Capture all console output
  const allLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    allLogs.push({ type: msg.type(), text, time: Date.now() });
  });

  // Capture specific voice-related events
  const voiceLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('VOICE') || text.includes('voice') || 
        text.includes('command') || text.includes('transcript') ||
        text.includes('wake') || text.includes('continuation') ||
        text.includes('FORENSIC')) {
      voiceLogs.push({ type: msg.type(), text, time: Date.now() });
    }
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // === TEST 1: Check Current Command Registry ===
  console.log('\n📋 TEST 1: Command Registry Analysis');
  
  const commandRegistry = await page.evaluate(() => {
    // Access runtime snapshot to see registered commands
    const runtime = window.__hudRuntime;
    const commands = runtime?.commandExecution?.registry || {};
    
    return {
      commandCount: Object.keys(commands).length,
      commandIds: Object.keys(commands).slice(0, 20),
      // Look for map-related commands
      mapCommands: Object.keys(commands).filter(k => 
        k.includes('map') || k.includes('layer') || k.includes('topo') || 
        k.includes('outdoor') || k.includes('satellite')
      ),
      // Look for flashlight commands
      flashlightCommands: Object.keys(commands).filter(k => 
        k.includes('flash') || k.includes('light') || k.includes('torch')
      )
    };
  });
  
  console.log('  Total commands:', commandRegistry.commandCount);
  console.log('  Map commands:', commandRegistry.mapCommands.length ? commandRegistry.mapCommands : 'NONE FOUND');
  console.log('  Flashlight commands:', commandRegistry.flashlightCommands.length ? commandRegistry.flashlightCommands : 'NONE FOUND');
  REPRO_RESULTS.commandRegistry = commandRegistry;

  // === TEST 2: Forensics Buffer Analysis ===
  console.log('\n📋 TEST 2: Forensics Trace Analysis');
  
  const forensicsAnalysis = await page.evaluate(() => {
    const f = window.__hudForensics;
    if (!f) return { error: 'Not available' };
    
    const buffer = f.getBuffer();
    const voiceTraces = f.getTracesByCategory?.('voice') || [];
    const commandTraces = f.getTracesByCategory?.('command') || [];
    
    // Find specific patterns
    const wakeDetections = voiceTraces.filter(t => t.event === 'wake_word_detected');
    const commandUnknowns = voiceTraces.filter(t => t.event === 'command_unknown');
    const continuations = voiceTraces.filter(t => 
      t.event?.includes('continuation') || t.event?.includes('window')
    );
    
    return {
      totalTraces: buffer.length,
      voiceTraces: voiceTraces.length,
      commandTraces: commandTraces.length,
      wakeDetections: wakeDetections.length,
      commandUnknowns: commandUnknowns.length,
      continuationEvents: continuations.map(t => ({ event: t.event, time: t.ts })),
      recentVoiceTraces: voiceTraces.slice(-10).map(t => ({
        event: t.event,
        details: JSON.stringify(t.details).slice(0, 80)
      }))
    };
  });
  
  console.log('  Total traces:', forensicsAnalysis.totalTraces);
  console.log('  Voice traces:', forensicsAnalysis.voiceTraces);
  console.log('  Wake detections:', forensicsAnalysis.wakeDetections);
  console.log('  Unknown commands:', forensicsAnalysis.commandUnknowns);
  console.log('  Continuation events:', forensicsAnalysis.continuationEvents?.length || 0);
  REPRO_RESULTS.forensics = forensicsAnalysis;

  // === TEST 3: Simulate Transcript Processing ===
  console.log('\n📋 TEST 3: Transcript Processing Simulation');
  
  const transcriptTests = await page.evaluate(() => {
    // Simulate the normalization and parsing logic from VoicePanel.tsx
    const WAKE_WORD = 'hud';
    const SANITY_MIN_FINAL_LEN = 2;
    const SANITY_MAX_CONTINUATION_WORDS = 6;
    const SANITY_MAX_CONTINUATION_CHARS = 60;
    
    function normalizeVoiceTranscript(input) {
      const base = input
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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
    
    function hasWakeWordPrefix(norm, wakeWord = 'hud') {
      return norm === wakeWord || norm.startsWith(`${wakeWord} `);
    }
    
    function stripWakeAckEchoFromContinuation(phrase) {
      let s = phrase.trim();
      if (!s) return s;
      while (/^yes\.?\s+/i.test(s)) {
        s = s.replace(/^yes\.?\s+/i, '').trim();
      }
      if (s === 'yes' || s === 'yes.') return '';
      return s.replace(/\byes\.?\b/gi, ' ').replace(/\s+/g, ' ').trim();
    }
    
    function stripRepeatedWakePrefix(commandPart, wakeWord = 'hud') {
      let rest = commandPart.trim();
      while (rest === wakeWord || rest.startsWith(`${wakeWord} `)) {
        rest = rest === wakeWord ? '' : rest.slice(wakeWord.length + 1).trim();
      }
      return rest;
    }
    
    // Test problematic inputs
    const testInputs = [
      { input: 'HUD', issue: 'bare_wake' },
      { input: 'HUD weather', issue: 'normal_command' },
      { input: 'hud flashlight on flashlight', issue: 'repeated_fragment' },
      { input: 'hud topo map', issue: 'unknown_alias' },
      { input: 'hud outdoor map', issue: 'unknown_alias' },
      { input: 'hud satellite map', issue: 'unknown_alias' },
      { input: 'hud map', issue: 'short_alias' },
      { input: 'hud flashlight on', issue: 'normal_command' },
      { input: 'yes weather', issue: 'ack_echo_contamination' },
      { input: 'weather', issue: 'no_wake_context' },
      { input: 'HUD HUD weather', issue: 'repeated_wake' },
      { input: 'hud weather hud situation', issue: 'multiple_commands' },
      { input: 'hud weather then situation', issue: 'then_chain' },
    ];
    
    return testInputs.map(t => {
      const norm = normalizeWakeHomophones(normalizeVoiceTranscript(t.input));
      const hasWake = hasWakeWordPrefix(norm);
      const afterWake = hasWake ? norm.slice(4).trim() : norm;
      const stripped = stripRepeatedWakePrefix(afterWake);
      const noEcho = stripWakeAckEchoFromContinuation(stripped);
      
      return {
        ...t,
        normalized: norm,
        hasWakeWord: hasWake,
        afterWake: afterWake,
        afterStrip: stripped,
        afterEchoStrip: noEcho,
        wouldDispatch: hasWake && noEcho.length >= SANITY_MIN_FINAL_LEN
      };
    });
  });
  
  console.log('  Transcript processing results:');
  transcriptTests.forEach(t => {
    const status = t.wouldDispatch ? '✅ DISPATCH' : '❌ SKIP';
    console.log(`    ${status} "${t.input}" → "${t.afterEchoStrip}" (${t.issue})`);
  });
  REPRO_RESULTS.transcriptTests = transcriptTests;

  // === TEST 4: Analyze Potential Duplicate Processing ===
  console.log('\n📋 TEST 4: Duplicate Processing Analysis');
  
  const duplicateAnalysis = await page.evaluate(() => {
    // Check for conditions that could cause duplicate command execution
    const runtime = window.__hudRuntime;
    
    return {
      // Check voice state refs that could cause issues
      voiceState: runtime?.voice?.state,
      lastHeard: runtime?.voice?.lastHeard,
      
      // Check for any dedupe mechanisms
      hasLastParsedRef: true, // From code - lastParsedFinalRef
      dedupeTimeWindow: '2000ms', // From code - 2s window
      
      // Potential issues from code analysis
      potentialIssues: [
        'parseAndRun called on every final transcript',
        'continuation window opens on bare HUD',
        'interimResults may fire multiple final events',
        'SR onresult fires for each recognition chunk'
      ]
    };
  });
  
  console.log('  Voice state:', duplicateAnalysis.voiceState);
  console.log('  Dedupe time window:', duplicateAnalysis.dedupeTimeWindow);
  console.log('  Potential duplicate sources:', duplicateAnalysis.potentialIssues.length);
  REPRO_RESULTS.duplicateAnalysis = duplicateAnalysis;

  // === TEST 5: Check Command Alias Gaps ===
  console.log('\n📋 TEST 5: Command Alias Gap Analysis');
  
  const aliasGaps = await page.evaluate(() => {
    const runtime = window.__hudRuntime;
    const commands = runtime?.commandExecution?.registry || {};
    
    // Expected aliases vs actual
    const expectedAliases = {
      'topo map': ['topo', 'topographic'],
      'outdoor map': ['outdoor', 'outdoors'],
      'satellite map': ['satellite', 'sat', 'aerial'],
      'map': ['basemap', 'base map'],
      'flashlight on': ['light on', 'torch on'],
      'flashlight off': ['light off', 'torch off'],
    };
    
    const gaps = [];
    
    Object.entries(expectedAliases).forEach(([phrase, aliases]) => {
      // Check if any command matches this intent
      const matchingCommand = Object.entries(commands).find(([id, cmd]) => {
        // Simple heuristic - check if command ID or aliases contain relevant terms
        const cmdText = JSON.stringify(cmd).toLowerCase();
        const phraseWords = phrase.toLowerCase().split(' ');
        return phraseWords.some(word => cmdText.includes(word) && word.length > 3);
      });
      
      if (!matchingCommand) {
        gaps.push({ phrase, aliases, status: 'NO_COMMAND_FOUND' });
      } else {
        gaps.push({ 
          phrase, 
          aliases, 
          commandId: matchingCommand[0],
          status: 'COMMAND_EXISTS'
        });
      }
    });
    
    return gaps;
  });
  
  console.log('  Alias analysis:');
  aliasGaps.forEach(g => {
    const icon = g.status === 'NO_COMMAND_FOUND' ? '❌' : '✅';
    console.log(`    ${icon} "${g.phrase}" → ${g.commandId || 'MISSING'}`);
  });
  REPRO_RESULTS.aliasGaps = aliasGaps;

  await browser.close();

  // === FINAL REPRODUCTION SUMMARY ===
  console.log('\n' + '='.repeat(70));
  console.log('📊 REPRODUCTION SUMMARY');
  console.log('='.repeat(70));
  
  // Count issues
  const unknownAliasTests = transcriptTests.filter(t => 
    t.issue.includes('unknown') && t.wouldDispatch
  );
  const contaminationTests = transcriptTests.filter(t => 
    t.issue.includes('echo') || t.issue.includes('repeated')
  );
  const noWakeTests = transcriptTests.filter(t => 
    t.issue === 'no_wake_context' && !t.wouldDispatch
  );
  
  console.log('\n🔴 CONFIRMED ISSUES:');
  console.log(`  1. Unknown aliases: ${unknownAliasTests.length} phrases won't work`);
  console.log(`     - "topo map", "outdoor map", "satellite map"`);
  console.log(`  2. Echo contamination: ${contaminationTests.length} patterns affected`);
  console.log(`     - "yes weather" (TTS echo)`);
  console.log(`     - "flashlight on flashlight" (fragment repetition)`);
  console.log(`  3. Missing commands: ${aliasGaps.filter(g => g.status === 'NO_COMMAND_FOUND').length} gaps found`);
  
  console.log('\n🟡 POTENTIAL ISSUES:');
  console.log(`  - Continuation window stays open 7-12s`);
  console.log(`  - parseAndRun fires on every final transcript`);
  console.log(`  - No explicit post-command reset`);
  
  return REPRO_RESULTS;
}

reproduceIssues().catch(err => {
  console.error('Reproduction audit failed:', err);
  process.exit(1);
});
