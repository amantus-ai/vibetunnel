/// <reference types="vitest" />

// Custom matchers for Vitest
declare module 'vitest' {
  interface Assertion {
    toBeValidSession(): this;
  }
  interface AsymmetricMatchersContaining {
    toBeValidSession(): unknown;
  }
}