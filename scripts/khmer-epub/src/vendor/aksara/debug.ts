// Debug logging utility
// All debug modes are OFF by default on page reload.
// Users can enable them via File menu during the session.
//
// Debug modes:
// - aksara-debug-enabled: General debug logging
// - aksara-wordbreaker-debug-enabled: Verbose word breaker logging (very noisy)
// - aksara-cursor-debug-enabled: Cursor/selection debugging
// - aksara-perf-debug-enabled: Performance measurement logging

export function isDebugEnabled(): boolean {
  // Check localStorage - debug is off by default, even in dev mode
  if (typeof window !== "undefined") {
    return localStorage.getItem("aksara-debug-enabled") === "true"
  }
  return false
}

export function setDebugEnabled(enabled: boolean): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("aksara-debug-enabled", String(enabled))
  }
}

export function isWordBreakerDebugEnabled(): boolean {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("aksara-wordbreaker-debug-enabled")
    return stored === "true"
  }
  return false
}

export function setWordBreakerDebugEnabled(enabled: boolean): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("aksara-wordbreaker-debug-enabled", String(enabled))
  }
}

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.log("[v0]", ...args)
  }
}

export function wordBreakerDebugLog(...args: unknown[]): void {
  if (isWordBreakerDebugEnabled()) {
    console.log("[v0:wb]", ...args)
  }
}

export function debugWarn(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.warn("[v0]", ...args)
  }
}

export function debugError(...args: unknown[]): void {
  // Always log errors
  console.error("[v0]", ...args)
}

// Cursor debug mode - for debugging click/selection/cursor jump issues
export function isCursorDebugEnabled(): boolean {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("aksara-cursor-debug-enabled")
    return stored === "true"
  }
  return false
}

export function setCursorDebugEnabled(enabled: boolean): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("aksara-cursor-debug-enabled", String(enabled))
  }
}

export function cursorDebugLog(...args: unknown[]): void {
  if (isCursorDebugEnabled()) {
    console.log("[v0:cursor]", ...args)
  }
}

// Performance debug mode - for measuring operation latency
// Enable via localStorage.setItem('aksara-perf-debug-enabled', 'true')
export function isPerfDebugEnabled(): boolean {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("aksara-perf-debug-enabled")
    return stored === "true"
  }
  return false
}

export function setPerfDebugEnabled(enabled: boolean): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("aksara-perf-debug-enabled", String(enabled))
  }
}

// Performance threshold in ms - operations exceeding this will warn
const PERF_THRESHOLD_MS = 16 // 60fps = 16.67ms per frame

/**
 * Measure execution time of a function and log if debug mode is enabled.
 * Warns if execution exceeds 16ms (1 frame at 60fps).
 *
 * Usage:
 *   const result = measurePerformance('beamSearch', () => breaker.segment(text));
 *
 * @param name - Human-readable name for the operation
 * @param fn - Function to measure
 * @returns The result of the function
 */
export function measurePerformance<T>(name: string, fn: () => T): T {
  // Early return when disabled - minimal overhead
  if (!isPerfDebugEnabled()) {
    return fn()
  }

  const start = performance.now()
  const result = fn()
  const elapsed = performance.now() - start

  if (elapsed > PERF_THRESHOLD_MS) {
    console.warn(`[Perf] ${name} took ${elapsed.toFixed(1)}ms (exceeds ${PERF_THRESHOLD_MS}ms threshold)`)
  } else {
    console.log(`[Perf] ${name}: ${elapsed.toFixed(1)}ms`)
  }

  return result
}

/**
 * Async version of measurePerformance for async functions.
 */
export async function measurePerformanceAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  // Early return when disabled - minimal overhead
  if (!isPerfDebugEnabled()) {
    return fn()
  }

  const start = performance.now()
  const result = await fn()
  const elapsed = performance.now() - start

  if (elapsed > PERF_THRESHOLD_MS) {
    console.warn(`[Perf] ${name} took ${elapsed.toFixed(1)}ms (exceeds ${PERF_THRESHOLD_MS}ms threshold)`)
  } else {
    console.log(`[Perf] ${name}: ${elapsed.toFixed(1)}ms`)
  }

  return result
}

/**
 * Clear all debug modes on page load.
 * Users can re-enable them via File menu during the session.
 */
export function clearAllDebugModes(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("aksara-debug-enabled")
    localStorage.removeItem("aksara-wordbreaker-debug-enabled")
    localStorage.removeItem("aksara-cursor-debug-enabled")
    localStorage.removeItem("aksara-perf-debug-enabled")
  }
}

// Auto-clear debug modes on module load (runs once per page load)
if (typeof window !== "undefined") {
  clearAllDebugModes()
}
