import { describe, expect, it } from 'vitest';
import { config } from '../../server/config.js';

describe('AsciinemaWriter Configuration', () => {
  it('should have correct default configuration values', () => {
    expect(config.MAX_CAST_SIZE).toBe(10 * 1024 * 1024); // 10MB
    expect(config.CAST_SIZE_CHECK_INTERVAL).toBe(30 * 1000); // 30 seconds
    expect(config.CAST_TRUNCATION_TARGET_PERCENTAGE).toBe(0.8); // 80%
  });

  it('should calculate target size correctly', () => {
    const targetSize = config.MAX_CAST_SIZE * config.CAST_TRUNCATION_TARGET_PERCENTAGE;
    expect(targetSize).toBe(8388608); // 80% of 10MB (10485760 * 0.8)
  });
});
