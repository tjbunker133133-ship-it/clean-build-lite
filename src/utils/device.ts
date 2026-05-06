export const getDeviceEnvironment = () => {
  if (typeof window === 'undefined') {
    return {
      isTouchDevice: false,
      isCompactLayout: false,
      isMobileEnvironment: false,
      width: 0,
      height: 0,
    }
  }

  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

  const width = window.innerWidth
  const height = window.innerHeight

  const isCompactLayout = width < 900

  const isMobileEnvironment = isTouchDevice && isCompactLayout

  return {
    isTouchDevice,
    isCompactLayout,
    isMobileEnvironment,
    width,
    height,
  }
}
