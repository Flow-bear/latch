'use client'

import { useEffect, useState } from 'react'

export function useNightMode(): boolean {
  const [isNight, setIsNight] = useState(false)

  useEffect(() => {
    const check = () => {
      const h = new Date().getHours()
      setIsNight(h >= 21 || h < 7)
    }
    check()
    const id = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  return isNight
}
