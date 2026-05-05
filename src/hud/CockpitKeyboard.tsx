import { useEffect } from 'react'
import { useCockpit } from '../context/CockpitContext'

/** Ctrl+S save, Ctrl+L load, Ctrl+E export layout, Ctrl+Shift+E import, Ctrl+G glass, Ctrl+H contrast */
export default function CockpitKeyboard() {
  const {
    saveScene,
    loadScene,
    cycleGlass,
    toggleHighContrast,
    resetLayout,
    exportLayoutFile,
    importLayoutFile,
  } = useCockpit()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const k = e.key.toLowerCase()
      if (k === 'e' && e.shiftKey) {
        e.preventDefault()
        importLayoutFile()
        return
      }
      if (k === 'e') {
        e.preventDefault()
        exportLayoutFile()
        return
      }
      if (k === 's') {
        e.preventDefault()
        saveScene()
      } else if (k === 'l') {
        e.preventDefault()
        loadScene()
      } else if (k === 'g') {
        e.preventDefault()
        cycleGlass()
      } else if (k === 'h') {
        e.preventDefault()
        toggleHighContrast()
      } else if (k === '0' && e.shiftKey) {
        e.preventDefault()
        resetLayout()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    cycleGlass,
    exportLayoutFile,
    importLayoutFile,
    loadScene,
    resetLayout,
    saveScene,
    toggleHighContrast,
  ])

  return null
}
