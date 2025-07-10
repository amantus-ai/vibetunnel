export const config = {
  // Maximum size for asciinema cast files (stdout)
  // When exceeded, the file will be truncated to keep only recent output
  MAX_CAST_SIZE: 10 * 1024 * 1024, // 10MB - increased to reduce truncation frequency

  // How often to check cast file size (in milliseconds)
  CAST_SIZE_CHECK_INTERVAL: 30 * 1000, // 30 seconds - check more frequently for large outputs

  // When truncating, what percentage of the max size to keep
  CAST_TRUNCATION_TARGET_PERCENTAGE: 0.8, // 80%
};
