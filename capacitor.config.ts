import type { CapacitorConfig } from '@capacitor/cli'
import project from './projects/hud-v1/project.json'

const config: CapacitorConfig = {
  appId: 'com.signalone.hud',
  appName: project.displayName,
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    HudMissionLink: {},
    Share: {},
  },
}

export default config
