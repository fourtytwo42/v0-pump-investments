"use client"

import { useState, useEffect, useRef } from "react"

export function useLocalStorage<T>(key: string, initialValue: T) {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(initialValue)

  // Flag to track if this is the first render
  const isFirstRender = useRef(true)

  // Initialize on client side
  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key)
      // Parse stored json or if none return initialValue
      if (item) {
        const parsedItem = JSON.parse(item)
        // This prevents undefined errors when new settings are added
        if (typeof initialValue === "object" && initialValue !== null && !Array.isArray(initialValue)) {
          setStoredValue({ ...initialValue, ...parsedItem } as T)
        } else {
          setStoredValue(parsedItem)
        }
      }
    } catch (error) {
      // If error also return initialValue
      console.log(error)
    }

    // Mark first render as complete
    isFirstRender.current = false
  }, [key])

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage.
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value
      // Save state
      setStoredValue(valueToStore)
      // Save to local storage
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore))
      }
    } catch (error) {
      // A more advanced implementation would handle the error case
      console.log(error)
    }
  }

  return [storedValue, setValue] as const
}
