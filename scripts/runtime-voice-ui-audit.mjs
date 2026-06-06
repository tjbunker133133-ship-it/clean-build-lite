/**
 * UI-LEVEL VOICE AUDIT — Tests actual VoicePanel behavior
 */
import { chromium } from 'playwright';

const UI_AUDIT = {
  timestamp: new Date().toISOString(),
  uiElements: {},
  interactionTests: [],
  stateTransitions: []
};

async function runUIAudit() {
  console.log('🖥️ UI-LEVEL VOICE AUDIT — Testing VoicePanel Behavior\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();

  // Track all voice-related console output
  const voiceLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('VOICE') || text.includes('voice') || text.includes('command') || text.includes('wake')) {
      voiceLogs.push({ type: msg.type(), text, time: Date.now() });
    }
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // === TEST: FIND VOICE PANEL UI ===
  console.log('🔍 TEST: Voice Panel UI Elements');

  // Take screenshot to see current state
  await page.screenshot({ path: 'audit-voice-initial.png' });

  // Find voice-related elements by various selectors
  const voiceElements = await page.evaluate(() => {
    const results = {};

    // Look for mic button
    const micBtn =
      document.querySelector('button[data-voice]') ||
      document.querySelector('button[data-mic]') ||
      document.querySelector('button[aria-label*="voice" i]') ||
      document.querySelector('button[aria-label*="mic" i]');

    // Look for voice panel container
    const voicePanel =
      document.querySelector('[data-panel="voice"]') ||
      document.querySelector('[data-no-drag]');

    // Find any element containing mic emoji or voice text
    const allElements = Array.from(document.querySelectorAll('*'));
    const voiceIndicator = allElements.find(el =>
      el.textContent?.includes('🎤') ||
      el.textContent?.toLowerCase().includes('voice') ||
      el.textContent?.toLowerCase().includes('microphone')
    );

    // Check for status text
    const statusText = document.body.innerText.match(/🎤[^\n]*/)?.[0] || null;

    // Find button with "HUD" text
    const hudButtons = allElements
      .filter(el => el.textContent?.toLowerCase().includes('hud'))
      .slice(0, 3)
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.slice(0, 50),
        clickable: el.tagName === 'BUTTON' || el.onclick !== null
      }));

    return {
      micButtonFound: !!micBtn,
      voicePanelFound: !!voicePanel,
      voiceIndicatorFound: !!voiceIndicator,
      voiceIndicatorText: voiceIndicator?.textContent?.slice(0, 100),
      statusText,
      hudButtons,
      bodyText: document.body.innerText.slice(0, 500)
    };
  });

  console.log('  Mic button:', voiceElements.micButtonFound ? '✅' : '❌');
  console.log('  Voice panel:', voiceElements.voicePanelFound ? '✅' : '❌');
  console.log('  Voice indicator:', voiceElements.voiceIndicatorFound ? '✅' : '❌');
  console.log('  Status text:', voiceElements.statusText || 'None visible');
  console.log('  HUD buttons found:', voiceElements.hudButtons.length);
  UI_AUDIT.uiElements = voiceElements;

  // === TEST: INTERACT WITH VOICE SYSTEM ===
  console.log('\n🖱️ TEST: Voice System Interaction');

  // Try clicking on voice-related elements
  const clickResults = [];

  // Find and click any button that might activate voice
  const clickableResult = await page.evaluate(async () => {
    // Look for the voice arm button (usually has 🎤 or similar)
    const buttons = Array.from(document.querySelectorAll('button'));
    const voiceButton = buttons.find(b =>
      b.textContent?.includes('🎤') ||
      b.textContent?.toLowerCase().includes('voice') ||
      b.textContent?.toLowerCase().includes('mic') ||
      b.getAttribute('data-voice') !== null
    );

    if (voiceButton) {
      const beforeState = {
        voiceActive: window.__hudRuntime?.voice?.armed,
        voiceState: window.__hudRuntime?.voice?.state
      };

      voiceButton.click();

      // Wait a bit
      await new Promise(r => setTimeout(r, 500));

      const afterState = {
        voiceActive: window.__hudRuntime?.voice?.armed,
        voiceState: window.__hudRuntime?.voice?.state
      };

      return {
        clicked: true,
        buttonText: voiceButton.textContent?.slice(0, 50),
        beforeState,
        afterState
      };
    }

    return { clicked: false, reason: 'No voice button found' };
  });

  console.log('  Voice button click:', JSON.stringify(clickableResult, null, 2));
  clickResults.push(clickableResult);

  await page.waitForTimeout(1000);

  // === TEST: SIMULATE COMMAND INPUT ===
  console.log('\n⌨️ TEST: Simulated Voice Command Input');

  // Try to find and use text input for commands
  const commandTest = await page.evaluate(async () => {
    const runtime = window.__hudRuntime;

    // Check if voice is now armed
    const voiceState = {
      armed: runtime?.voice?.armed,
      state: runtime?.voice?.state,
      listenMode: runtime?.voice?.listenMode
    };

    // If we have a way to directly test command parsing, use it
    // Try to access parseAndRun if exposed (it's not, it's internal)

    // Check for any input field we can type in
    const inputs = Array.from(document.querySelectorAll('input'));
    const textInputs = inputs.filter(i =>
      i.type === 'text' &&
      (i.placeholder?.toLowerCase().includes('hud') ||
       i.getAttribute('data-voice-input') !== null)
    );

    return {
      voiceState,
      textInputsFound: textInputs.length,
      inputPlaceholders: textInputs.map(i => i.placeholder)
    };
  });

  console.log('  Voice state after click:', JSON.stringify(commandTest.voiceState, null, 2));
  console.log('  Text inputs found:', commandTest.textInputsFound);

  // Try typing a command if input exists
  if (commandTest.textInputsFound > 0) {
    const input = await page.locator('input[type="text"]').first();
    await input.fill('HUD weather');
    await input.press('Enter');
    await page.waitForTimeout(1000);

    const afterCommand = await page.evaluate(() => ({
      commandHistory: window.__hudRuntime?.commandExecution?.history?.length || 0,
      lastCommand: window.__hudRuntime?.commandExecution?.history?.[0] || null
    }));
    console.log('  After command input:', JSON.stringify(afterCommand, null, 2));
  }

  // === TEST: COLLECT FORENSICS AFTER INTERACTION ===
  console.log('\n📊 TEST: Forensics After Interaction');

  const forensicsAfter = await page.evaluate(() => {
    const f = window.__hudForensics;
    if (!f) return { error: 'Not available' };

    const buffer = f.getBuffer();
    return {
      totalTraces: buffer.length,
      voiceTraces: f.getTracesByCategory?.('voice')?.length || 0,
      ttsTraces: f.getTracesByCategory?.('tts')?.length || 0,
      commandTraces: f.getTracesByCategory?.('command')?.length || 0,
      recentTraces: buffer.slice(-10).map(t => ({
        category: t.category,
        event: t.event,
        time: t.ts
      }))
    };
  });

  console.log('  Total traces:', forensicsAfter.totalTraces);
  console.log('  Voice traces:', forensicsAfter.voiceTraces);
  console.log('  TTS traces:', forensicsAfter.ttsTraces);
  console.log('  Command traces:', forensicsAfter.commandTraces);

  UI_AUDIT.stateTransitions.push({
    voiceLogs: voiceLogs.slice(-20),
    forensicsAfter
  });

  // Final screenshot
  await page.screenshot({ path: 'audit-voice-final.png' });

  await browser.close();

  console.log('\n' + '='.repeat(70));
  console.log('📋 UI AUDIT SUMMARY');
  console.log('='.repeat(70));
  console.log('Voice UI elements found:', Object.values(UI_AUDIT.uiElements).filter(Boolean).length);
  console.log('Interaction results:', clickResults.length);
  console.log('Voice logs captured:', voiceLogs.length);

  return UI_AUDIT;
}

runUIAudit().catch(err => {
  console.error('UI audit failed:', err);
  process.exit(1);
});
