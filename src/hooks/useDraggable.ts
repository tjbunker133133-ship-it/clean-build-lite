import { useRef, useCallback, useState } from 'react'

interface Position {
  x: number
  y: number
}

export function useDraggable(initialPos: Position) {
  const [pos, setPos] = useState<Position>(initialPos)
  const dragging = useRef(false)
  const offset = useRef<Position>({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag on the header (data-drag="true")
    const target = e.target as HTMLElement
    if (!target.closest('[data-drag="true"]')) return

    dragging.current = true
    offset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    }

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      setPos({
        x: ev.clientX - offset.current.x,
        y: ev.clientY - offset.current.y,
      })
    }

    const onMouseUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [pos])

  return { pos, onMouseDown }
}