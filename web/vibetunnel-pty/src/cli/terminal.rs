use anyhow::{Context, Result};

#[cfg(unix)]
use termios::{Termios, TCSANOW, tcsetattr};

pub struct Terminal {
    #[cfg(unix)]
    original_termios: Option<Termios>,
}

impl Terminal {
    pub fn new() -> Result<Self> {
        Ok(Self {
            #[cfg(unix)]
            original_termios: None,
        })
    }

    pub fn size(&self) -> Result<(u16, u16)> {
        #[cfg(unix)]
        {
            use nix::libc::{ioctl, winsize, STDOUT_FILENO, TIOCGWINSZ};
            
            let mut size = winsize {
                ws_row: 0,
                ws_col: 0,
                ws_xpixel: 0,
                ws_ypixel: 0,
            };

            unsafe {
                if ioctl(STDOUT_FILENO, TIOCGWINSZ, &mut size as *mut _) == -1 {
                    anyhow::bail!("Failed to get terminal size");
                }
            }

            Ok((size.ws_col, size.ws_row))
        }

        #[cfg(not(unix))]
        {
            // Default size for non-Unix systems
            Ok((80, 24))
        }
    }

    #[cfg(unix)]
    pub fn enter_raw_mode(&mut self) -> Result<()> {
        use termios::*;

        let termios = termios::tcgetattr(0).context("Failed to get terminal attributes")?;
        self.original_termios = Some(termios);

        let mut raw = termios;

        // Input modes
        raw.c_iflag &= !(IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON);
        // Output modes
        raw.c_oflag &= !OPOST;
        // Control modes
        raw.c_cflag &= !(CSIZE | PARENB);
        raw.c_cflag |= CS8;
        // Local modes
        raw.c_lflag &= !(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
        // Control characters
        raw.c_cc[VMIN] = 1;
        raw.c_cc[VTIME] = 0;

        tcsetattr(0, TCSANOW, &raw).context("Failed to set terminal to raw mode")?;

        Ok(())
    }

    #[cfg(unix)]
    pub fn leave_raw_mode(&mut self) -> Result<()> {
        if let Some(termios) = self.original_termios.take() {
            tcsetattr(0, TCSANOW, &termios).context("Failed to restore terminal mode")?;
        }
        Ok(())
    }

    #[cfg(not(unix))]
    pub fn enter_raw_mode(&mut self) -> Result<()> {
        Ok(())
    }

    #[cfg(not(unix))]
    pub fn leave_raw_mode(&mut self) -> Result<()> {
        Ok(())
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.leave_raw_mode();
    }
}