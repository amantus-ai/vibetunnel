import { describe, expect, it } from 'vitest';
import { config } from '../../server/config.js';

describe('AsciinemaWriter Configuration', () => {
  it('should have correct default configuration values', () => {
    expect(config.MAX_CAST_SIZE).toBe(1 * 1024 * 1024); // 1MB
    expect(config.CAST_SIZE_CHECK_INTERVAL).toBe(60 * 1000); // 60 seconds
    expect(config.CAST_TRUNCATION_TARGET_PERCENTAGE).toBe(0.8); // 80%
  });

  it('should calculate target size correctly', () => {
    const targetSize = config.MAX_CAST_SIZE * config.CAST_TRUNCATION_TARGET_PERCENTAGE;
    expect(targetSize).toBe(838860.8); // 80% of 1MB (1048576 * 0.8)
  });
});
