import { useEffect, useState } from 'react'

type VoiceState = {
  listening: boolean
  transcript: string
}

export function useVoiceCommands(): VoiceState {
  const [state, setState] = useState<VoiceState>({
    listening: false,
    transcript: '',
  })

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      console.warn('Speech recognition not supported')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onstart = () => {
      setState((s) => ({ ...s, listening: true }))
    }

    recognition.onend = () => {
      setState((s) => ({ ...s, listening: false }))
    }

    recognition.onresult = (event: any) => {
      let transcript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }

      setState((s) => ({ ...s, transcript }))
    }

    recognition.start()

    return () => {
      recognition.stop()
    }
  }, [])

  return state
}