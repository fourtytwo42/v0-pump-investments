// A singleton service to handle playing and stopping sounds
class SoundService {
  private sounds: Map<string, HTMLAudioElement> = new Map()
  private intervals: Map<string, NodeJS.Timeout> = new Map()
  private autoStopTimers: Map<string, NodeJS.Timeout> = new Map()
  private soundsLoaded = false
  private soundPaths: {
    high: string | null
    low: string | null
    fallback: string | null
  } = {
    high: null,
    low: null,
    fallback: null,
  }

  constructor() {
    // Pre-load sounds when the service is initialized
    if (typeof window !== "undefined") {
      // Check if sound files exist
      this.checkSoundFiles().then((filesExist) => {
        if (filesExist) {
          // Delay preloading until after initial render
          setTimeout(() => this.preloadSounds(), 1000)
        } else {
          console.warn("Sound files not found, sound alerts may not work")
        }
      })
    }
  }

  private preloadSounds() {
    if (typeof window === "undefined") return

    try {
      console.log("Preloading sounds with available paths...")

      // Check if sounds are already loaded
      if (this.soundsLoaded) {
        console.log("Sounds already loaded, skipping preload")
        return
      }

      // Function to create and load a sound with proper error handling
      const loadSound = (id: string, path: string | null) => {
        if (!path) {
          console.log(`No working path available for ${id} sound, skipping preload`)
          return null
        }

        console.log(`Attempting to load sound: ${id} from path: ${path}`)

        const audio = new Audio()

        // Add error handling
        audio.onerror = (e) => {
          console.error(`Error loading sound ${id} from ${path}:`, e)
        }

        // Add load event to confirm sound is loaded
        audio.oncanplaythrough = () => {
          console.log(`Successfully loaded ${id} sound from: ${path}`)
          this.sounds.set(id, audio)

          // If this is the fallback sound, mark sounds as loaded
          if (id === "fallback" && this.sounds.has("fallback")) {
            this.soundsLoaded = true
            console.log("Fallback sound loaded successfully, sound service is ready")
          }
        }

        // Set the source and start loading
        audio.src = path
        audio.load()

        return audio
      }

      // Load sounds with the working paths we found
      loadSound("high", this.soundPaths.high)
      loadSound("low", this.soundPaths.low)
      loadSound("fallback", this.soundPaths.fallback)

      // Set a timeout to mark sounds as loaded even if they fail
      // This ensures the sound service can still function
      setTimeout(() => {
        if (!this.soundsLoaded) {
          console.warn("Sound loading timed out, marking sound service as ready anyway")
          this.soundsLoaded = true
        }
      }, 5000)

      // Log attempt to preload
      console.log("Sound preloading initiated")
    } catch (error) {
      console.error("Error in preloadSounds:", error)
      // Mark as loaded anyway so the service can still function
      this.soundsLoaded = true
    }
  }

  /**
   * Play a sound periodically
   * @param id The sound identifier (high or low)
   * @param intervalMs Interval between plays in milliseconds
   * @param durationMs Total duration to play in milliseconds (0 for indefinite)
   * @returns A function to stop the sound
   */
  playPeriodicSound(id: string, intervalMs = 3000, durationMs = 30000): () => void {
    if (typeof window === "undefined") return () => {}

    // Generate a unique instance ID
    const instanceId = `${id}-${Date.now()}`
    console.log(
      `Starting periodic sound: ${instanceId}, duration: ${durationMs === 0 ? "indefinite" : durationMs + "ms"}`,
    )

    // Play the sound immediately
    const playSound = () => {
      try {
        // Get the requested sound or fallback
        let sound = this.sounds.get(id)

        // If the requested sound isn't available, try the fallback
        if (!sound) {
          console.warn(`Sound "${id}" not found, using fallback sound`)
          sound = this.sounds.get("fallback")
        }

        // If no sounds are available at all, create a temporary audio element
        if (!sound) {
          console.warn("No preloaded sounds available, creating temporary audio element")

          // Try to create a temporary audio element with the appropriate path
          const tempPath =
            this.soundPaths[id as "high" | "low" | "fallback"] ||
            this.soundPaths.fallback ||
            "/sounds/alert-notification.mp3"

          // If we don't have any working paths, use a simple beep
          if (!tempPath) {
            console.warn("No sound paths available, using browser beep")
            // Use a simple beep as last resort
            try {
              window.navigator.vibrate?.(200) // Vibrate on mobile if available
              return // Skip audio playback
            } catch (e) {
              console.error("Vibration failed:", e)
            }
          }

          sound = new Audio(tempPath)

          // Log the attempt
          console.log(`Created temporary audio element for ${id} with path: ${tempPath}`)
        }

        // Try to play the sound
        try {
          // Clone the audio to allow overlapping sounds if needed
          const audioInstance = sound.cloneNode() as HTMLAudioElement

          // Log the sound source for debugging
          console.log(`Attempting to play sound: ${id}, src: ${audioInstance.src}`)

          // Add error handling for play attempt
          audioInstance.play().catch((error) => {
            console.error(`Error playing sound ${id}:`, error)

            // As a last resort, try to use the browser's built-in beep
            try {
              console.log("Trying browser beep as last resort")
              window.navigator.vibrate?.(200) // Vibrate on mobile if available
            } catch (e) {
              console.error("Vibration failed:", e)
            }
          })
        } catch (playError) {
          console.error(`Error playing sound:`, playError)
        }
      } catch (error) {
        console.error(`Error in playSound for ${id}:`, error)
      }
    }

    playSound()

    // Set up interval to play the sound periodically
    const intervalId = setInterval(playSound, intervalMs)
    this.intervals.set(instanceId, intervalId)

    // Set up auto-stop timer if duration is specified and not zero
    if (durationMs > 0) {
      const timerId = setTimeout(() => {
        console.log(`Auto-stopping sound after ${durationMs}ms: ${instanceId}`)
        this.stopSound(instanceId)
      }, durationMs)
      this.autoStopTimers.set(instanceId, timerId)
    }

    // Return a function to stop this specific sound instance
    return () => {
      console.log(`Manually stopping sound: ${instanceId}`)
      this.stopSound(instanceId)
    }
  }

  async checkSoundFiles() {
    if (typeof window === "undefined") return false

    try {
      console.log("Checking if sound files exist using Audio loading...")

      // Define all possible paths to try for sounds
      const possiblePaths = {
        high: [
          "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/high-notification-FDEyPU1XDM5yxauoYLE5bgoLtlxd8F.wav",
          "sounds/high-notification.wav",
          ".https://hebbkx1anhila5yf.public.blob.vercel-storage.com/high-notification-FDEyPU1XDM5yxauoYLE5bgoLtlxd8F.wav",
          "..https://hebbkx1anhila5yf.public.blob.vercel-storage.com/high-notification-FDEyPU1XDM5yxauoYLE5bgoLtlxd8F.wav",
        ],
        low: [
          "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/low-notification-wQTCCirsxSnX1YzGqXqOJhriPwzFmZ.wav",
          "sounds/low-notification.wav",
          ".https://hebbkx1anhila5yf.public.blob.vercel-storage.com/low-notification-wQTCCirsxSnX1YzGqXqOJhriPwzFmZ.wav",
          "..https://hebbkx1anhila5yf.public.blob.vercel-storage.com/low-notification-wQTCCirsxSnX1YzGqXqOJhriPwzFmZ.wav",
        ],
        fallback: [
          "/sounds/alert-notification.mp3",
          "sounds/alert-notification.mp3",
          "./sounds/alert-notification.mp3",
          "../sounds/alert-notification.mp3",
        ],
      }

      // Function to check if a sound file exists at any of the possible paths
      const checkSoundExists = async (soundType: "high" | "low" | "fallback"): Promise<string | null> => {
        for (const path of possiblePaths[soundType]) {
          try {
            // Create a new audio element for each test to avoid caching issues
            const audio = new Audio()

            // Use a promise to handle the load/error events
            const exists = await new Promise<boolean>((resolve) => {
              // Set a timeout in case the events don't fire
              const timeout = setTimeout(() => {
                console.log(`Timeout checking sound file ${path}`)
                resolve(false)
              }, 2000)

              // Success event
              audio.oncanplaythrough = () => {
                clearTimeout(timeout)
                console.log(`Sound file ${path} loaded successfully`)
                resolve(true)
              }

              // Error event
              audio.onerror = (e) => {
                clearTimeout(timeout)
                console.log(`Error loading sound ${soundType} from ${path}:`, e)
                resolve(false)
              }

              // Start loading the audio
              audio.src = path
              audio.load()
            })

            if (exists) {
              console.log(`Found working path for ${soundType} sound: ${path}`)
              return path
            }
          } catch (error) {
            console.error(`Error testing path ${path}:`, error)
            // Continue to the next path
          }
        }

        console.warn(`No working path found for ${soundType} sound`)
        return null
      }

      // Check all sound types and collect working paths
      const workingPaths = {
        high: await checkSoundExists("high"),
        low: await checkSoundExists("low"),
        fallback: await checkSoundExists("fallback"),
      }

      // Store the working paths for later use
      this.soundPaths = workingPaths

      // If at least one sound file exists, we can proceed
      const hasAnySounds = workingPaths.high !== null || workingPaths.low !== null || workingPaths.fallback !== null

      if (hasAnySounds) {
        console.log("At least one sound file exists, sound service can function with available sounds")
        return true
      }

      // If we get here, no sound files were found
      console.warn("No sound files found. Sound alerts will be disabled.")
      return false
    } catch (error) {
      console.error("Error checking sound files:", error)
      // Return true anyway to allow the sound service to try loading sounds
      // It will handle errors gracefully if files don't exist
      return true
    }
  }

  /**
   * Stop a specific sound by its instance ID
   * @param instanceId The sound instance identifier
   */
  stopSound(instanceId: string) {
    // Clear the interval
    if (this.intervals.has(instanceId)) {
      clearInterval(this.intervals.get(instanceId))
      this.intervals.delete(instanceId)
      console.log(`Cleared interval for sound: ${instanceId}`)
    }

    // Clear the auto-stop timer
    if (this.autoStopTimers.has(instanceId)) {
      clearTimeout(this.autoStopTimers.get(instanceId))
      this.autoStopTimers.delete(instanceId)
      console.log(`Cleared auto-stop timer for sound: ${instanceId}`)
    }
  }

  /**
   * Stop all currently playing sounds
   */
  stopAllSounds() {
    console.log(
      `Stopping all sounds. Active intervals: ${this.intervals.size}, Active timers: ${this.autoStopTimers.size}`,
    )

    // Clear all intervals
    this.intervals.forEach((intervalId, instanceId) => {
      clearInterval(intervalId)
      console.log(`Cleared interval for sound: ${instanceId}`)
    })
    this.intervals.clear()

    // Clear all auto-stop timers
    this.autoStopTimers.forEach((timerId, instanceId) => {
      clearTimeout(timerId)
      console.log(`Cleared auto-stop timer for sound: ${instanceId}`)
    })
    this.autoStopTimers.clear()
  }
}

// Export a singleton instance
export const soundService = new SoundService()
