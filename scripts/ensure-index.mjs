import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const indexPath = resolve(process.cwd(), 'index.html')
const expected = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0a0c0d" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="TacticalHUD" />
    <link rel="apple-touch-icon" href="/hud-icon.svg" />
    <title>Tactical HUD</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`

let current = ''
try {
  current = readFileSync(indexPath, 'utf8')
} catch {
  // File missing or unreadable; rewrite below.
}

if (current !== expected) {
  writeFileSync(indexPath, expected, 'utf8')
  console.log('[ensure:index] Repaired index.html to Vite entry shell')
} else {
  console.log('[ensure:index] index.html is clean')
}
