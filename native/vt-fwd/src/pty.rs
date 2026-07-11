//! Small, platform-neutral PTY wrapper used by the forwarder.

use std::io;
use std::mem::MaybeUninit;
use std::os::fd::{AsRawFd, OwnedFd, RawFd};

use nix::libc;
use nix::pty::{OpenptyResult, openpty};
use nix::sys::termios::{InputFlags, SetArg, Termios, tcgetattr, tcsetattr};

pub use nix::pty::Winsize;

pub struct Pty {
    pub master: OwnedFd,
    pub slave: Option<OwnedFd>,
}

impl Pty {
    pub fn open(size: Winsize) -> io::Result<Self> {
        let OpenptyResult { master, slave } = openpty(&size, None::<&Termios>)?;

        // The child inherits only the slave. Failure to set CLOEXEC is not
        // fatal, matching the original forwarder.
        unsafe {
            let flags = libc::fcntl(master.as_raw_fd(), libc::F_GETFD);
            if flags >= 0 {
                let _ = libc::fcntl(master.as_raw_fd(), libc::F_SETFD, flags | libc::FD_CLOEXEC);
            }
        }

        let mut attrs = tcgetattr(&master)?;
        attrs.input_flags.insert(InputFlags::IUTF8);
        tcsetattr(&master, SetArg::TCSANOW, &attrs)?;

        Ok(Self {
            master,
            slave: Some(slave),
        })
    }

    pub fn set_size(&self, size: Winsize) -> io::Result<()> {
        set_winsize(self.master.as_raw_fd(), size)
    }

    #[cfg(test)]
    pub fn get_size(&self) -> io::Result<Winsize> {
        get_winsize_from_fd(self.master.as_raw_fd())
    }

    pub fn master_fd(&self) -> RawFd {
        self.master.as_raw_fd()
    }

    pub fn slave_fd(&self) -> Option<RawFd> {
        self.slave.as_ref().map(AsRawFd::as_raw_fd)
    }

    pub fn close_slave(&mut self) {
        self.slave.take();
    }
}

pub fn set_winsize(fd: RawFd, size: Winsize) -> io::Result<()> {
    // SAFETY: the ioctl only reads the pointed-to winsize during the call.
    if unsafe { libc::ioctl(fd, libc::TIOCSWINSZ, &size) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn get_winsize_from_fd(fd: RawFd) -> io::Result<Winsize> {
    let mut size = MaybeUninit::<Winsize>::uninit();
    // SAFETY: the ioctl initializes the pointed-to winsize on success.
    if unsafe { libc::ioctl(fd, libc::TIOCGWINSZ, size.as_mut_ptr()) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        // SAFETY: successful TIOCGWINSZ initialized all four fields.
        Ok(unsafe { size.assume_init() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_pty_with_requested_size() {
        let requested = Winsize {
            ws_row: 37,
            ws_col: 91,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let pty = Pty::open(requested).expect("open PTY");
        let actual = pty.get_size().expect("read PTY size");
        assert_eq!(actual.ws_row, requested.ws_row);
        assert_eq!(actual.ws_col, requested.ws_col);
    }
}
