import { useState } from 'react'
import {
  addTacticalContact,
  isValidEmail,
  markTacticalSetupComplete,
  removeTacticalContact,
  type TacticalProfile,
} from '../lib/tacticalProfile'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchFontMd, touchGapSm, touchMinTarget } from './tokens'

type Props = {
  compact?: boolean
  onSaved?: () => void
}

export default function TacticalProfileEditor({ compact = false, onSaved }: Props) {
  const { profile, assessment, save } = useTacticalProfile()
  const [draft, setDraft] = useState(() => ({
    display_name: profile.display_name,
    reply_to_email: profile.reply_to_email,
    phone: profile.phone,
  }))
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapSm = touchGapSm(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const inputStyle: React.CSSProperties = {
    minHeight: tapMin,
    borderRadius: 6,
    border: '1px solid rgba(199,206,198,0.28)',
    background: 'rgba(10,12,13,0.8)',
    color: '#d3dad3',
    padding: '0 10px',
    fontSize: fontMd,
    width: '100%',
  }

  const saveIdentity = () => {
    setError(null)
    const display_name = draft.display_name.trim()
    const reply_to_email = draft.reply_to_email.trim()
    if (!display_name) {
      setError('Display name is required for emergency alerts.')
      return
    }
    if (!reply_to_email) {
      setError('Reply-to email is required so contacts can reach you.')
      return
    }
    if (!isValidEmail(reply_to_email)) {
      setError('Reply-to email format is invalid.')
      return
    }
    save({
      display_name,
      reply_to_email,
      phone: draft.phone.trim(),
      setup_complete: true,
    })
    markTacticalSetupComplete(true)
    onSaved?.()
  }

  const handleAddContact = () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: addErr } = addTacticalContact({
      name: contactForm.name,
      email: contactForm.email,
      phone: contactForm.phone,
    })
    setBusy(false)
    if (addErr) {
      setError(addErr)
      return
    }
    setContactForm({ name: '', email: '', phone: '' })
    onSaved?.()
  }

  const statusColor = assessment.operationalReady ? '#7dff8a' : '#ffd166'

  return (
    <div style={{ display: 'grid', gap: gapSm }}>
      <div
        style={{
          fontSize: fontSm,
          color: statusColor,
          fontWeight: 700,
          letterSpacing: '0.06em',
        }}
      >
        {assessment.operationalReady ? 'PROFILE READY' : 'SETUP INCOMPLETE'}
      </div>
      {!assessment.operationalReady && assessment.messages.length > 0 && (
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: fontSm,
            color: '#ffb8c8',
            lineHeight: 1.4,
          }}
        >
          {assessment.messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div style={{ fontSize: fontSm, color: '#9ea7a0', letterSpacing: '0.08em' }}>
        OPERATOR IDENTITY
      </div>
      <label style={{ display: 'grid', gap: 4, fontSize: fontSm, color: '#b8c4b8' }}>
        Display name
        <input
          type="text"
          data-no-drag
          value={draft.display_name}
          onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))}
          placeholder="How you appear on alerts"
          style={inputStyle}
        />
      </label>
      <label style={{ display: 'grid', gap: 4, fontSize: fontSm, color: '#b8c4b8' }}>
        Reply-to email
        <input
          type="email"
          data-no-drag
          value={draft.reply_to_email}
          onChange={(e) => setDraft((d) => ({ ...d, reply_to_email: e.target.value }))}
          placeholder="your@email.com"
          style={inputStyle}
        />
      </label>
      {!compact && (
        <label style={{ display: 'grid', gap: 4, fontSize: fontSm, color: '#b8c4b8' }}>
          Phone (optional)
          <input
            type="tel"
            data-no-drag
            value={draft.phone}
            onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
            placeholder="For future SMS"
            style={inputStyle}
          />
        </label>
      )}
      <button
        type="button"
        data-no-drag
        onClick={saveIdentity}
        style={{
          minHeight: tapMin,
          borderRadius: 8,
          border: '1px solid rgba(125,255,138,0.45)',
          background: 'rgba(125,255,138,0.14)',
          color: '#d8f8dd',
          cursor: 'pointer',
          fontSize: fontSm,
          fontWeight: 700,
          letterSpacing: '0.08em',
        }}
      >
        SAVE IDENTITY
      </button>

      <div style={{ fontSize: fontSm, color: '#9ea7a0', letterSpacing: '0.08em', marginTop: 4 }}>
        EMERGENCY CONTACTS (SHARED)
      </div>
      {profile.contacts.length === 0 ? (
        <div style={{ fontSize: fontSm, color: '#9ea7a0' }}>No contacts on file</div>
      ) : (
        <div style={{ display: 'grid', gap: 2 }}>
          {profile.contacts.map((c) => (
            <ContactRow key={c.id} contact={c} busy={busy} onRemove={() => removeTacticalContact(c.id)} />
          ))}
        </div>
      )}
      <input
        type="text"
        data-no-drag
        placeholder="Contact name (recommended)"
        value={contactForm.name}
        onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
        disabled={busy}
        style={inputStyle}
      />
      <input
        type="email"
        data-no-drag
        placeholder="Email (required)"
        value={contactForm.email}
        onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
        disabled={busy}
        style={inputStyle}
      />
      {!compact && (
        <input
          type="tel"
          data-no-drag
          placeholder="Phone (optional)"
          value={contactForm.phone}
          onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))}
          disabled={busy}
          style={inputStyle}
        />
      )}
      <button
        type="button"
        data-no-drag
        onClick={handleAddContact}
        disabled={busy}
        style={{
          minHeight: tapMin,
          borderRadius: 8,
          border: '1px solid rgba(125,255,138,0.45)',
          background: 'rgba(125,255,138,0.14)',
          color: '#d8f8dd',
          cursor: busy ? 'wait' : 'pointer',
          fontSize: fontSm,
          fontWeight: 700,
          letterSpacing: '0.08em',
        }}
      >
        {busy ? 'SAVING…' : 'ADD CONTACT'}
      </button>
      {error && <div style={{ color: '#ff6b87', fontSize: fontSm }}>{error}</div>}
    </div>
  )
}

function ContactRow({
  contact,
  busy,
  onRemove,
}: {
  contact: TacticalProfile['contacts'][number]
  busy: boolean
  onRemove: () => void
}) {
  const valid = isValidEmail(contact.email)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 8,
        padding: '5px 4px',
        borderBottom: '1px solid rgba(199,206,198,0.08)',
      }}
    >
      <div>
        <div style={{ color: valid ? '#d6ddd6' : '#ff9aac' }}>
          {contact.name.trim() || 'Contact'}
          {!valid ? ' · invalid email' : ''}
        </div>
        <div style={{ color: '#9ea7a0', fontSize: 12 }}>
          {contact.email}
          {contact.phone ? ` · ${contact.phone}` : ''}
        </div>
      </div>
      <button
        type="button"
        data-no-drag
        disabled={busy}
        onClick={onRemove}
        style={{
          borderRadius: 6,
          border: '1px solid rgba(255,107,135,0.45)',
          background: 'rgba(255,107,135,0.12)',
          color: '#ffd5dd',
          cursor: busy ? 'wait' : 'pointer',
          fontSize: 11,
          fontWeight: 700,
          padding: '0 10px',
        }}
      >
        REMOVE
      </button>
    </div>
  )
}
