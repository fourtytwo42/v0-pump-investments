type AlertSound = "high" | "low"

class SoundService {
  private context: AudioContext | null = null
  private unlocked = false
  private intervals = new Map<string, ReturnType<typeof setInterval>>()
  private stopTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor() {
    if (typeof window === "undefined") return
    const unlock = () => {
      this.unlocked = true
      if (!this.context) this.context = new AudioContext()
      void this.context.resume()
      window.removeEventListener("pointerdown", unlock)
      window.removeEventListener("keydown", unlock)
    }
    window.addEventListener("pointerdown", unlock, { once: true, passive: true })
    window.addEventListener("keydown", unlock, { once: true })
  }

  private playPattern(type: AlertSound): void {
    if (!this.unlocked || !this.context) return
    const context = this.context
    const start = context.currentTime
    const frequencies = type === "high" ? [740, 980] : [440, 300]
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const noteStart = start + index * 0.16
      oscillator.type = "sine"
      oscillator.frequency.setValueAtTime(frequency, noteStart)
      gain.gain.setValueAtTime(0.0001, noteStart)
      gain.gain.exponentialRampToValueAtTime(0.12, noteStart + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.13)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(noteStart)
      oscillator.stop(noteStart + 0.14)
    })
  }

  playPeriodicSound(type: AlertSound, intervalMs = 3_000, durationMs = 0): () => void {
    const instanceId = `${type}-${Date.now()}-${Math.random()}`
    this.playPattern(type)
    const interval = setInterval(() => this.playPattern(type), intervalMs)
    this.intervals.set(instanceId, interval)
    if (durationMs > 0) {
      this.stopTimers.set(instanceId, setTimeout(() => this.stopSound(instanceId), durationMs))
    }
    return () => this.stopSound(instanceId)
  }

  stopSound(instanceId: string): void {
    const interval = this.intervals.get(instanceId)
    if (interval) clearInterval(interval)
    this.intervals.delete(instanceId)
    const timer = this.stopTimers.get(instanceId)
    if (timer) clearTimeout(timer)
    this.stopTimers.delete(instanceId)
  }

  stopAllSounds(): void {
    for (const id of [...this.intervals.keys()]) this.stopSound(id)
  }
}

export const soundService = new SoundService()
