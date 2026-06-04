#!/usr/bin/env node
/**
 * Generate VAPID keys for Web Push (run once, store private in Supabase secrets).
 * Requires: npm install (web-push is a devDependency).
 */
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()

console.log('Add to .env.local:')
console.log(`VITE_VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log('')
console.log('Add to Supabase Edge Function secrets:')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log('VAPID_SUBJECT=mailto:signalonehud@gmail.com')
console.log('')
console.log('Optional (derived from Supabase URL if omitted):')
console.log('VITE_RESCUE_PUSH_URL=https://YOUR_REF.supabase.co/functions/v1/send-rescue-push')
