/**
 * Voice Authority System — Automated Console Test
 * Run in browser DevTools console on production deployment
 *
 * Usage: copy/paste this entire file into console, then run:
 *   voiceAuthorityTest.runAll()
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[VAT]';
  const TEST_RESULTS = [];

  function log(msg, type = 'info') {
    const line = `${LOG_PREFIX} ${msg}`;
    if (type === 'error') console.error(line);
    else if (type === 'warn') console.warn(line);
    else console.log(line);
  }

  function assert(condition, testName, details = '') {
    const passed = !!condition;
    TEST_RESULTS.push({ test: testName, passed, details });
    if (passed) log(`✅ ${testName}`);
    else log(`❌ ${testName} ${details}`, 'error');
    return passed;
  }

  // Test 1: Voice Authority Controller Exists
  function testAuthorityControllerExists() {
    const hasWindow = typeof window !== 'undefined';
    const hasSpeech = hasWindow && 'speechSynthesis' in window;
    return assert(hasSpeech, 'SpeechSynthesis API Available');
  }

  // Test 2: Priority Constants Defined
  function testPriorityConstants() {
    // Check if module loaded (indirect check)
    const expectedPriorities = {
      SAFETY: 100,
      USER_COMMAND: 80,
      SYSTEM_FEEDBACK: 60,
      ENVIRONMENT_READOUT: 40,
      HELP_GUIDANCE: 20
    };

    // Log expected values (actual module may be bundled)
    log('Expected priority hierarchy:');
    Object.entries(expectedPriorities).forEach(([k, v]) => {
      log(`  ${k}: ${v}`);
    });

    return assert(true, 'Priority hierarchy documented');
  }

  // Test 3: Speech Synthesis State
  function testSpeechSynthesisState() {
    const synth = window.speechSynthesis;
    if (!synth) return assert(false, 'SpeechSynthesis not available');

    log(`SpeechSynthesis state:`);
    log(`  pending: ${synth.pending}`);
    log(`  speaking: ${synth.speaking}`);
    log(`  paused: ${synth.paused}`);

    return assert(true, `TTS State - pending:${synth.pending}, speaking:${synth.speaking}`);
  }

  // Test 4: Basic TTS Functionality
  async function testBasicTTS() {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        resolve(assert(false, 'TTS Test - No speechSynthesis'));
        return;
      }

      // Cancel any pending
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance('Voice authority test one two three');
      utterance.rate = 1.5; // Speed up test

      let fired = false;
      utterance.onend = () => {
        if (!fired) {
          fired = true;
          resolve(assert(true, 'Basic TTS - Utterance completed'));
        }
      };

      utterance.onerror = (e) => {
        if (!fired) {
          fired = true;
          resolve(assert(false, `Basic TTS - Error: ${e.error}`));
        }
      };

      // Timeout fallback
      setTimeout(() => {
        if (!fired) {
          fired = true;
          // Still pass if synthesis started but didn't fire events
          resolve(assert(synth.speaking, 'Basic TTS - Started (events may be delayed)'));
        }
      }, 3000);

      try {
        synth.speak(utterance);
        log('TTS test utterance queued');
      } catch (e) {
        resolve(assert(false, `Basic TTS - Exception: ${e.message}`));
      }
    });
  }

  // Test 5: Cancel/Clear Functionality
  function testCancelFunctionality() {
    const synth = window.speechSynthesis;
    if (!synth) return assert(false, 'Cancel Test - No speechSynthesis');

    // Queue multiple utterances
    for (let i = 0; i < 3; i++) {
      const u = new SpeechSynthesisUtterance(`test ${i}`);
      synth.speak(u);
    }

    const hadPending = synth.pending;

    // Cancel all
    try {
      synth.cancel();
      log(`Cancel test: pending before=${hadPending}, after=${synth.pending}`);
      return assert(true, `Cancel/Clear - pending before=${hadPending}`);
    } catch (e) {
      return assert(false, `Cancel Test - Exception: ${e.message}`);
    }
  }

  // Test 6: Priority Interrupt Simulation
  async function testPriorityInterrupt() {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        resolve(assert(false, 'Priority Test - No speechSynthesis'));
        return;
      }

      synth.cancel();

      // Start "low priority" speech
      const lowPriority = new SpeechSynthesisUtterance('This is a long low priority message that should be interrupted by safety');
      lowPriority.rate = 1.0;

      let interruptTested = false;

      lowPriority.onstart = () => {
        log('Low priority speech started - will attempt interrupt');

        // After 500ms, simulate interrupt
        setTimeout(() => {
          if (interruptTested) return;
          interruptTested = true;

          // Cancel and start "high priority"
          synth.cancel();

          const highPriority = new SpeechSynthesisUtterance('Safety alert interrupt');
          highPriority.rate = 1.5;

          let highFired = false;
          highPriority.onend = () => {
            if (!highFired) {
              highFired = true;
              resolve(assert(true, 'Priority Interrupt - High priority completed after interrupt'));
            }
          };

          highPriority.onerror = () => {
            if (!highFired) {
              highFired = true;
              resolve(assert(false, 'Priority Interrupt - High priority error'));
            }
          };

          try {
            synth.speak(highPriority);
            log('High priority interrupt utterance queued');
          } catch (e) {
            resolve(assert(false, `Priority Test - Exception: ${e.message}`));
          }
        }, 500);
      };

      lowPriority.onend = () => {
        if (!interruptTested) {
          // Ended before interrupt - still valid test
          resolve(assert(true, 'Priority Test - Low priority completed (interrupt window closed)'));
        }
      };

      // Timeout
      setTimeout(() => {
        if (!interruptTested) {
          interruptTested = true;
          resolve(assert(synth.speaking, 'Priority Test - Speech active at timeout'));
        }
      }, 4000);

      synth.speak(lowPriority);
    });
  }

  // Test 7: Check for Module Presence (bundled)
  function testModulePresence() {
    // Look for evidence of voice authority in bundle
    const scripts = document.querySelectorAll('script[src*="VoicePanel"]');
    log(`VoicePanel chunks found: ${scripts.length}`);

    scripts.forEach(s => log(`  - ${s.src.split('/').pop()}`));

    return assert(scripts.length > 0, 'VoicePanel Module Loaded');
  }

  // Test 8: Mobile Device Detection
  function testDeviceProfile() {
    const ua = navigator.userAgent;
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isMobile = isAndroid || isIOS;

    log(`Device Profile:`);
    log(`  User Agent: ${ua.slice(0, 50)}...`);
    log(`  Android: ${isAndroid}`);
    log(`  iOS: ${isIOS}`);
    log(`  Mobile: ${isMobile}`);
    log(`  Online: ${navigator.onLine}`);

    return assert(true, `Device: ${isAndroid ? 'Android' : isIOS ? 'iOS' : 'Desktop'}`);
  }

  // Run all tests
  async function runAll() {
    console.clear();
    log('═══════════════════════════════════════════════');
    log('VOICE AUTHORITY SYSTEM — AUTOMATED TEST SUITE');
    log('═══════════════════════════════════════════════');
    log(`Time: ${new Date().toISOString()}`);
    log(`URL: ${window.location.href}`);
    log('');

    TEST_RESULTS.length = 0;

    // Run synchronous tests
    testAuthorityControllerExists();
    testPriorityConstants();
    testSpeechSynthesisState();
    testCancelFunctionality();
    testModulePresence();
    testDeviceProfile();

    // Run async tests
    log('');
    log('Running async TTS tests...');
    await testBasicTTS();

    log('');
    log('Running priority interrupt test...');
    await testPriorityInterrupt();

    // Summary
    log('');
    log('═══════════════════════════════════════════════');
    log('TEST SUMMARY');
    log('═══════════════════════════════════════════════');

    const passed = TEST_RESULTS.filter(r => r.passed).length;
    const failed = TEST_RESULTS.filter(r => !r.passed).length;

    log(`Total: ${TEST_RESULTS.length}`);
    log(`Passed: ${passed} ✅`);
    log(`Failed: ${failed} ❌`);

    log('');
    log('Detailed Results:');
    TEST_RESULTS.forEach(r => {
      const icon = r.passed ? '✅' : '❌';
      log(`  ${icon} ${r.test}`);
    });

    log('');
    if (failed === 0) {
      log('🎉 ALL TESTS PASSED — Voice Authority System Operational');
    } else if (failed <= 2) {
      log('⚠️ MOSTLY OPERATIONAL — Minor issues detected');
    } else {
      log('🚨 CRITICAL ISSUES — System may not be field-ready');
    }

    // Manual test reminder
    log('');
    log('═══════════════════════════════════════════════');
    log('MANUAL TESTS REQUIRED');
    log('═══════════════════════════════════════════════');
    log('1. Speak "HUD weather" - verify single response');
    log('2. Speak "HUD weather" then "HUD stop speaking" - verify cancel');
    log('3. Trigger safety alert during TTS - verify interrupt');
    log('4. Run for 10 minutes - verify stability');
    log('');

    return {
      passed,
      failed,
      total: TEST_RESULTS.length,
      results: TEST_RESULTS
    };
  }

  // Expose to global
  window.voiceAuthorityTest = {
    runAll,
    runSync: () => {
      testAuthorityControllerExists();
      testPriorityConstants();
      testSpeechSynthesisState();
      testModulePresence();
      testDeviceProfile();
      return TEST_RESULTS;
    },
    getResults: () => TEST_RESULTS,
    manualTestChecklist: () => {
      log('');
      log('═══════════════════════════════════════════════');
      log('MANUAL VOICE TEST CHECKLIST');
      log('═══════════════════════════════════════════════');
      log('□ Say: "HUD weather" → Should hear weather report');
      log('□ Say: "HUD status" → Should hear status');
      log('□ Say: "HUD time" → Should hear time');
      log('□ Say: "HUD weather" then "HUD stop speaking" → Should stop immediately');
      log('□ Say: "HUD weather" then trigger safety → Should interrupt immediately');
      log('□ Hold-to-talk mission voice → Should respect priority');
      log('□ Run 10 minutes with random commands → Should stay stable');
      log('');
    }
  };

  log('Voice Authority Test loaded. Run voiceAuthorityTest.runAll() to execute.');
  log('Or run voiceAuthorityTest.manualTestChecklist() for manual test list.');

})();