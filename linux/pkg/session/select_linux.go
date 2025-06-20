//go:build linux
// +build linux

package session

import "syscall"

// selectCall wraps syscall.Select for Linux (returns count and error)
func selectCall(nfd int, r *syscall.FdSet, w *syscall.FdSet, e *syscall.FdSet, timeout *syscall.Timeval) error {
	_, err := syscall.Select(nfd, r, w, e, timeout)
	return err
}
