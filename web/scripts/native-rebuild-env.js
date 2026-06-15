const path = require('path');

function createNativeRebuildEnv(sourceEnv, nodeExecutable, nodeVersion, arch) {
  const toolDirs = [
    sourceEnv.VIBETUNNEL_NODE_SHIM_DIR,
    path.dirname(nodeExecutable),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].filter(Boolean);

  const cleanEnv = {
    ...sourceEnv,
    PATH: [...new Set(toolDirs)].join(':'),
    npm_config_runtime: 'node',
    npm_config_target: nodeVersion.replace(/^v/, ''),
    npm_config_arch: arch,
    npm_config_target_arch: arch,
    npm_config_disturl: 'https://nodejs.org/dist',
    npm_config_build_from_source: 'true',
    CXXFLAGS: '-std=c++20',
    npm_config_cxxflags: '-std=c++20',
  };

  for (const name of [
    'LDFLAGS',
    'LIBRARY_PATH',
    'CPATH',
    'C_INCLUDE_PATH',
    'CPLUS_INCLUDE_PATH',
    'PKG_CONFIG_PATH',
  ]) {
    delete cleanEnv[name];
  }

  return cleanEnv;
}

module.exports = { createNativeRebuildEnv };
