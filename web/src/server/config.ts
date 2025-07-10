export const config = {
  // Maximum size for asciinema cast files (stdout)
  // When exceeded, the file will be truncated to keep only recent output
  MAX_CAST_SIZE: 100 * 1024, // 100KB

  // How often to check cast file size (in milliseconds)
  CAST_SIZE_CHECK_INTERVAL: 60 * 1000, // 1 minute

  // When truncating, what percentage of the max size to keep
  CAST_TRUNCATION_TARGET_PERCENTAGE: 0.8, // 80%
};
