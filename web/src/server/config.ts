export const config = {
  // Maximum size for asciinema cast files (stdout)
  // When exceeded, the file will be truncated to keep only recent output
  MAX_CAST_SIZE: 1 * 1024 * 1024, // 1MB

  // How often to check cast file size (in milliseconds)
  CAST_SIZE_CHECK_INTERVAL: 60 * 1000, // 1 minute
};
