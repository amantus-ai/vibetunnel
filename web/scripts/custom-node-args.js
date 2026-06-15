function getCustomNodeBuildArgs(argv) {
  const index = argv.findIndex(arg => arg === '--custom-node' || arg.startsWith('--custom-node='));
  if (index === -1) {
    return null;
  }

  const argument = argv[index];
  const separatePath = argv[index + 1];
  if (argument === '--custom-node' && separatePath && !separatePath.startsWith('-')) {
    return [argument, separatePath];
  }
  return [argument];
}

module.exports = { getCustomNodeBuildArgs };
