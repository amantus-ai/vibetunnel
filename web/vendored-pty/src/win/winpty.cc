/**
 * Copyright (c) 2013-2015, Christopher Jeffrey, Peter Sunde (MIT License)
 * Copyright (c) 2016, Daniel Imms (MIT License).
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 *
 * pty.cc:
 *   This file is responsible for starting processes
 *   with pseudo-terminal file descriptors.
 */

#define NODE_ADDON_API_DISABLE_DEPRECATED
#include <napi.h>
#include <iostream>
#include <assert.h>
#include <map>
#include <Shlwapi.h> // PathCombine, PathIsRelative
#include <sstream>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include <winpty.h>

#include "path_util.h"

/**
* Misc
*/
#define WINPTY_DBG_VARIABLE TEXT("WINPTYDBG")

/**
* winpty
*/
static std::vector<winpty_t *> ptyHandles;
static volatile LONG ptyCounter;

/**
* Helpers
*/

/** Keeps track of the handles created by PtyStartProcess */
static std::map<DWORD, HANDLE> createdHandles;

static winpty_t *get_pipe_handle(DWORD pid) {
  for (size_t i = 0; i < ptyHandles.size(); ++i) {
    winpty_t *ptyHandle = ptyHandles[i];
    HANDLE current = winpty_agent_process(ptyHandle);
    if (GetProcessId(current) == pid) {
      return ptyHandle;
    }
  }
  return nullptr;
}

static bool remove_pipe_handle(DWORD pid) {
  for (size_t i = 0; i < ptyHandles.size(); ++i) {
    winpty_t *ptyHandle = ptyHandles[i];
    HANDLE current = winpty_agent_process(ptyHandle);
    if (GetProcessId(current) == pid) {
      winpty_free(ptyHandle);
      ptyHandles.erase(ptyHandles.begin() + i);
      ptyHandle = nullptr;
      return true;
    }
  }
  return false;
}

Napi::Error error_with_winpty_msg(const char *generalMsg, winpty_error_ptr_t error_ptr, Napi::Env env) {
  std::string why;
  why += generalMsg;
  why += ": ";
  why += path_util::wstring_to_string(winpty_error_msg(error_ptr));
  winpty_error_free(error_ptr);
  return Napi::Error::New(env, why);
}

static Napi::Value PtyGetExitCode(const Napi::CallbackInfo& info) {
  Napi::Env env(info.Env());
  Napi::HandleScope scope(env);

  if (info.Length() != 1 ||
      !info[0].IsNumber()) {
    throw Napi::Error::New(env, "Usage: pty.getExitCode(pid)");
  }

  DWORD pid = info[0].As<Napi::Number>().Uint32Value();
  HANDLE handle = OpenProcess(PROCESS_QUERY_INFORMATION, FALSE, pid);
  if (handle == NULL) {
    return Napi::Number::New(env, -1);
  }

  DWORD exitCode = 0;
  BOOL success = GetExitCodeProcess(handle, &exitCode);
  if (success == FALSE) {
    exitCode = -1;
  }

  CloseHandle(handle);
  return Napi::Number::New(env, exitCode);
}

static Napi::Value PtyGetProcessList(const Napi::CallbackInfo& info) {
  Napi::Env env(info.Env());
  Napi::HandleScope scope(env);

  if (info.Length() != 1 ||
      !info[0].IsNumber()) {
    throw Napi::Error::New(env, "Usage: pty.getProcessList(pid)");
  }

  DWORD pid = info[0].As<Napi::Number>().Uint32Value();
  winpty_t *pc = get_pipe_handle(pid);
  if (pc == nullptr) {
    return Napi::Number::New(env, 0);
  }
  int processList[64];
  const int processCount = 64;
  int actualCount = winpty_get_console_process_list(pc, processList, processCount, nullptr);
  if (actualCount <= 0) {
    return Napi::Number::New(env, 0);
  }
  Napi::Array result = Napi::Array::New(env, actualCount);
  for (int i = 0; i < actualCount; i++) {
    result.Set(i, Napi::Number::New(env, processList[i]));
  }
  return result;
}

static Napi::Value PtyStartProcess(const Napi::CallbackInfo& info) {
  Napi::Env env(info.Env());
  Napi::HandleScope scope(env);

  if (info.Length() != 7 ||
      !info[0].IsString() ||
      !info[1].IsString() ||
      !info[2].IsArray() ||
      !info[3].IsString() ||
      !info[4].IsNumber() ||
      !info[5].IsNumber() ||
      !info[6].IsBoolean()) {
    throw Napi::Error::New(env, "Usage: pty.startProcess(file, cmdline, env, cwd, cols, rows, debug)");
  }

  std::wstring filename(path_util::to_wstring(info[0].As<Napi::String>()));
  std::wstring cmdline(path_util::to_wstring(info[1].As<Napi::String>()));
  std::wstring cwd(path_util::to_wstring(info[3].As<Napi::String>()));

  // create environment block
  std::wstring envStr;
  const Napi::Array envValues = info[2].As<Napi::Array>();
  if (!envValues.IsEmpty()) {
    std::wstring envBlock;
    for(uint32_t i = 0; i < envValues.Length(); i++) {
      envBlock += path_util::to_wstring(envValues.Get(i).As<Napi::String>());
      envBlock += L'\0';
    }
    envStr = std::move(envBlock);
  }

  // use environment 'Path' variable to determine location of
  // the relative path that we have recieved (e.g cmd.exe)
  std::wstring shellpath;
  if (::PathIsRelativeW(filename.c_str())) {
    shellpath = path_util::get_shell_path(filename);
  } else {
    shellpath = filename;
  }

  if (shellpath.empty() || !path_util::file_exists(shellpath)) {
    std::string why;
    why += "File not found: ";
    why += path_util::wstring_to_string(shellpath);
    throw Napi::Error::New(env, why);
  }

  int cols = info[4].As<Napi::Number>().Int32Value();
  int rows = info[5].As<Napi::Number>().Int32Value();
  bool debug = info[6].As<Napi::Boolean>().Value();

  // Enable/disable debugging
  SetEnvironmentVariable(WINPTY_DBG_VARIABLE, debug ? "1" : NULL); // NULL = deletes variable

  // Create winpty config
  winpty_error_ptr_t error_ptr = nullptr;
  winpty_config_t* winpty_config = winpty_config_new(0, &error_ptr);
  if (winpty_config == nullptr) {
    throw error_with_winpty_msg("Error creating WinPTY config", error_ptr, env);
  }
  winpty_error_free(error_ptr);

  // Set pty size on config
  winpty_config_set_initial_size(winpty_config, cols, rows);

  // Start the pty agent
  winpty_t *pc = winpty_open(winpty_config, &error_ptr);
  winpty_config_free(winpty_config);
  if (pc == nullptr) {
    throw error_with_winpty_msg("Error launching WinPTY agent", error_ptr, env);
  }
  winpty_error_free(error_ptr);

  // Create winpty spawn config
  winpty_spawn_config_t* config = winpty_spawn_config_new(WINPTY_SPAWN_FLAG_AUTO_SHUTDOWN, shellpath.c_str(), cmdline.c_str(), cwd.c_str(), envStr.c_str(), &error_ptr);
  if (config == nullptr) {
    winpty_free(pc);
    throw error_with_winpty_msg("Error creating WinPTY spawn config", error_ptr, env);
  }
  winpty_error_free(error_ptr);

  // Spawn the new process
  HANDLE handle = nullptr;
  BOOL spawnSuccess = winpty_spawn(pc, config, &handle, nullptr, nullptr, &error_ptr);
  winpty_spawn_config_free(config);
  if (!spawnSuccess) {
    if (handle) {
      CloseHandle(handle);
    }
    winpty_free(pc);
    throw error_with_winpty_msg("Unable to start terminal process", error_ptr, env);
  }
  winpty_error_free(error_ptr);

  LPCWSTR coninPipeName = winpty_conin_name(pc);
  std::string coninPipeNameStr(path_util::from_wstring(coninPipeName));
  if (coninPipeNameStr.empty()) {
    CloseHandle(handle);
    winpty_free(pc);
    throw Napi::Error::New(env, "Failed to initialize winpty conin");
  }

  LPCWSTR conoutPipeName = winpty_conout_name(pc);
  std::string conoutPipeNameStr(path_util::from_wstring(conoutPipeName));
  if (conoutPipeNameStr.empty()) {
    CloseHandle(handle);
    winpty_free(pc);
    throw Napi::Error::New(env, "Failed to initialize winpty conout");
  }

  DWORD innerPid = GetProcessId(handle);
  if (createdHandles[innerPid]) {
    CloseHandle(handle);
    winpty_free(pc);
    std::stringstream why;
    why << "There is already a process with innerPid " << innerPid;
    throw Napi::Error::New(env, why.str());
  }
  createdHandles[innerPid] = handle;

  // Save pty struct for later use
  ptyHandles.push_back(pc);

  DWORD pid = GetProcessId(winpty_agent_process(pc));
  Napi::Object marshal = Napi::Object::New(env);
  marshal.Set("innerPid", Napi::Number::New(env, (int)innerPid));
  marshal.Set("pid", Napi::Number::New(env, (int)pid));
  marshal.Set("pty", Napi::Number::New(env, InterlockedIncrement(&ptyCounter)));
  marshal.Set("fd", Napi::Number::New(env, -1));
  marshal.Set("conin", Napi::String::New(env, coninPipeNameStr));
  marshal.Set("conout", Napi::String::New(env, conoutPipeNameStr));

  return marshal;
}

static Napi::Value PtyResize(const Napi::CallbackInfo& info) {
  Napi::Env env(info.Env());
  Napi::HandleScope scope(env);

  if (info.Length() != 3 ||
      !info[0].IsNumber() ||
      !info[1].IsNumber() ||
      !info[2].IsNumber()) {
    throw Napi::Error::New(env, "Usage: pty.resize(pid, cols, rows)");
  }

  DWORD pid = info[0].As<Napi::Number>().Uint32Value();
  int cols = info[1].As<Napi::Number>().Int32Value();
  int rows = info[2].As<Napi::Number>().Int32Value();

  winpty_t *pc = get_pipe_handle(pid);

  if (pc == nullptr) {
    throw Napi::Error::New(env, "The pty doesn't appear to exist");
  }
  BOOL success = winpty_set_size(pc, cols, rows, nullptr);
  if (!success) {
    throw Napi::Error::New(env, "The pty could not be resized");
  }

  return env.Undefined();
}

static Napi::Value PtyKill(const Napi::CallbackInfo& info) {
  Napi::Env env(info.Env());
  Napi::HandleScope scope(env);

  if (info.Length() != 2 ||
      !info[0].IsNumber() ||
      !info[1].IsNumber()) {
    throw Napi::Error::New(env, "Usage: pty.kill(pid, innerPid)");
  }

  DWORD pid = info[0].As<Napi::Number>().Uint32Value();
  DWORD innerPid = info[1].As<Napi::Number>().Uint32Value();

  winpty_t *pc = get_pipe_handle(pid);
  if (pc == nullptr) {
    throw Napi::Error::New(env, "Pty seems to have been killed already");
  }

  assert(remove_pipe_handle(pid));

  HANDLE innerPidHandle = createdHandles[innerPid];
  createdHandles.erase(innerPid);
  CloseHandle(innerPidHandle);

  return env.Undefined();
}

/**
* Init
*/

Napi::Object init(Napi::Env env, Napi::Object exports) {
  exports.Set("startProcess", Napi::Function::New(env, PtyStartProcess));
  exports.Set("resize", Napi::Function::New(env, PtyResize));
  exports.Set("kill", Napi::Function::New(env, PtyKill));
  exports.Set("getExitCode", Napi::Function::New(env, PtyGetExitCode));
  exports.Set("getProcessList", Napi::Function::New(env, PtyGetProcessList));
  return exports;
};

NODE_API_MODULE(NODE_GYP_MODULE_NAME, init);
