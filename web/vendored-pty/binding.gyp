{
  'targets': [{
    'target_name': 'pty',
    'include_dirs': [
      'src/',
      '<!@(node -p "require(\'node-addon-api\').include")'
    ],
    'defines': [ 'NAPI_CPP_EXCEPTIONS' ],
    'cflags!': [ '-fno-exceptions' ],
    'cflags_cc!': [ '-fno-exceptions' ],
    'xcode_settings': {
      'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
      'CLANG_CXX_LIBRARY': 'libc++',
      'MACOSX_DEPLOYMENT_TARGET': '10.7',
    },
    'msvs_settings': {
      'VCCLCompilerTool': { 'ExceptionHandling': 1 },
    },
    'conditions': [
      ['OS=="win"', {
        'sources': [
          'src/win/conpty.cc',
          'src/win/path_util.cc'
        ],
        'libraries': [
          '-lkernel32.lib',
          '-luser32.lib',
          '-lshell32.lib',
          '-ladvapi32.lib'
        ],
        'defines': [
          '_WIN32_WINNT=0x0600',
          'NTDDI_VERSION=0x06000000'
        ]
      }],
      ['OS!="win"', {
        'sources': [
          'src/unix/pty.cc'
        ],
        'libraries': [
          '-lutil'
        ],
        'conditions': [
          ['OS=="mac"', {
            'xcode_settings': {
              'MACOSX_DEPLOYMENT_TARGET': '10.12'
            }
          }]
        ]
      }]
    ]
  }, {
    'target_name': 'spawn-helper',
    'type': 'executable',
    'conditions': [
      ['OS!="win"', {
        'sources': [
          'src/unix/spawn-helper.cc'
        ],
      }]
    ]
  }]
}