//go:build darwin
// +build darwin

package session

import "syscall"

// selectCall wraps syscall.Select for Darwin (returns only error)
func selectCall(nfd int, r *syscall.FdSet, w *syscall.FdSet, e *syscall.FdSet, timeout *syscall.Timeval) error {
	return syscall.Select(nfd, r, w, e, timeout)
}
