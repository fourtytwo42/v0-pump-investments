"use client"

import { useState, useEffect, useMemo } from "react"

export function usePagination<T>({
  items,
  itemsPerPage,
  isPaused,
  dependencies = [],
}: {
  items: T[]
  itemsPerPage: number
  isPaused: boolean
  dependencies?: any[] // Additional dependencies for resetting page
}) {
  const [currentPage, setCurrentPage] = useState<number>(1)

  // Calculate total pages
  const totalPages = Math.ceil(items.length / itemsPerPage)

  // Get paginated items
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return items.slice(startIndex, endIndex)
  }, [items, currentPage, itemsPerPage])

  // Reset to page 1 when items change (but not when paused)
  useEffect(() => {
    if (!isPaused) {
      setCurrentPage(1)
    }
  }, [isPaused, ...dependencies]) // Only reset page when these dependencies change, not on every items change

  return {
    currentPage,
    setCurrentPage,
    totalPages,
    paginatedItems,
  }
}
