use anyhow::{Context, Result};
use crossterm::{
  terminal::{self, EnterAlternateScreen, LeaveAlternateScreen},
  ExecutableCommand,
};
use std::io::{self, IsTerminal};

/// Terminal management for raw mode and size detection
pub struct Terminal {
  stdin_is_tty: bool,
  stdout_is_tty: bool,
  raw_mode_active: bool,
}

impl Terminal {
  pub fn new() -> Result<Self> {
    Ok(Self {
      stdin_is_tty: io::stdin().is_terminal(),
      stdout_is_tty: io::stdout().is_terminal(),
      raw_mode_active: false,
    })
  }

  /// Enter raw mode if we're in a TTY
  pub fn enter_raw_mode(&mut self) -> Result<()> {
    if self.stdin_is_tty && !self.raw_mode_active {
      terminal::enable_raw_mode().context("Failed to enable raw mode")?;
      self.raw_mode_active = true;
    }
    Ok(())
  }

  /// Leave raw mode
  pub fn leave_raw_mode(&mut self) -> Result<()> {
    if self.raw_mode_active {
      terminal::disable_raw_mode().context("Failed to disable raw mode")?;
      self.raw_mode_active = false;
    }
    Ok(())
  }

  /// Get terminal size
  pub fn size(&self) -> Result<(u16, u16)> {
    if self.stdout_is_tty {
      let (cols, rows) = terminal::size().context("Failed to get terminal size")?;
      Ok((cols, rows))
    } else {
      // Default size for non-TTY
      Ok((80, 24))
    }
  }

  /// Check if we should use alternate screen
  #[allow(dead_code)]
  pub fn should_use_alternate_screen(&self) -> bool {
    self.stdout_is_tty
  }

  /// Enter alternate screen
  #[allow(dead_code)]
  pub fn enter_alternate_screen(&self) -> Result<()> {
    if self.should_use_alternate_screen() {
      io::stdout()
        .execute(EnterAlternateScreen)
        .context("Failed to enter alternate screen")?;
    }
    Ok(())
  }

  /// Leave alternate screen
  pub fn leave_alternate_screen(&self) -> Result<()> {
    if self.should_use_alternate_screen() {
      io::stdout()
        .execute(LeaveAlternateScreen)
        .context("Failed to leave alternate screen")?;
    }
    Ok(())
  }
}

impl Drop for Terminal {
  fn drop(&mut self) {
    // Ensure we restore terminal state on drop
    let _ = self.leave_raw_mode();
    let _ = self.leave_alternate_screen();
  }
}

/// Get terminal environment variables
#[allow(dead_code)]
pub fn get_term_env() -> Vec<(String, String)> {
  let mut env = vec![];

  // Pass through TERM
  if let Ok(term) = std::env::var("TERM") {
    env.push(("TERM".to_string(), term));
  } else {
    env.push(("TERM".to_string(), "xterm-256color".to_string()));
  }

  // Pass through color-related variables
  for var in &["COLORTERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"] {
    if let Ok(value) = std::env::var(var) {
      env.push((var.to_string(), value));
    }
  }

  env
}
