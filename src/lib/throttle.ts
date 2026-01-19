/**
 * Throttle utility - limits how often a function can be called
 */

/**
 * Creates a throttled version of a function that only executes
 * at most once per specified time interval.
 * 
 * @param fn Function to throttle
 * @param wait Minimum time between calls in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  wait: number
): T {
  let lastCall = 0;
  let lastArgs: Parameters<T> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const throttled = (...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= wait) {
      // Enough time has passed, call immediately
      lastCall = now;
      fn(...args);
    } else {
      // Save args for trailing call
      lastArgs = args;
      
      // Schedule trailing call if not already scheduled
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          if (lastArgs) {
            lastCall = Date.now();
            fn(...lastArgs);
            lastArgs = null;
          }
          timeoutId = null;
        }, wait - timeSinceLastCall);
      }
    }
  };

  return throttled as T;
}

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified wait time has elapsed since the last call.
 * 
 * @param fn Function to debounce
 * @param wait Time to wait in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  wait: number
): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, wait);
  };

  return debounced as T;
}
