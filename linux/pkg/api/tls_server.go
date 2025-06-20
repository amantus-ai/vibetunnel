package api

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"path/filepath"
	"time"

	"github.com/caddyserver/certmagic"
)

// TLSConfig represents TLS configuration options
type TLSConfig struct {
	Enabled      bool   `json:"enabled"`
	Port         int    `json:"port"`
	Domain       string `json:"domain,omitempty"`    // Optional domain for Let's Encrypt
	SelfSigned   bool   `json:"self_signed"`         // Use self-signed certificates
	CertPath     string `json:"cert_path,omitempty"` // Custom cert path
	KeyPath      string `json:"key_path,omitempty"`  // Custom key path
	AutoRedirect bool   `json:"auto_redirect"`       // Redirect HTTP to HTTPS
}

// TLSServer wraps the regular server with TLS capabilities
type TLSServer struct {
	*Server
	tlsConfig *TLSConfig
}

// NewTLSServer creates a new TLS-enabled server
func NewTLSServer(server *Server, tlsConfig *TLSConfig) *TLSServer {
	return &TLSServer{
		Server:    server,
		tlsConfig: tlsConfig,
	}
}

// StartTLS starts the server with TLS support
func (s *TLSServer) StartTLS(httpAddr, httpsAddr string) error {
	if !s.tlsConfig.Enabled {
		// Fall back to regular HTTP
		return s.Start(httpAddr)
	}

	// Set up TLS configuration
	tlsConfig, err := s.setupTLS()
	if err != nil {
		return fmt.Errorf("failed to setup TLS: %w", err)
	}

	// Create HTTP handler
	handler := s.setupRoutes()

	// Start HTTPS server
	httpsServer := &http.Server{
		Addr:         httpsAddr,
		Handler:      handler,
		TLSConfig:    tlsConfig,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("Starting HTTPS server on %s", httpsAddr)

	// Start HTTP redirect server if enabled
	if s.tlsConfig.AutoRedirect && httpAddr != "" {
		go s.startHTTPRedirect(httpAddr, httpsAddr)
	}

	// Start HTTPS server
	if s.tlsConfig.SelfSigned || (s.tlsConfig.CertPath != "" && s.tlsConfig.KeyPath != "") {
		return httpsServer.ListenAndServeTLS(s.tlsConfig.CertPath, s.tlsConfig.KeyPath)
	} else {
		// Use CertMagic for automatic certificates
		return httpsServer.ListenAndServeTLS("", "")
	}
}

// setupTLS configures TLS based on the provided configuration
func (s *TLSServer) setupTLS() (*tls.Config, error) {
	if s.tlsConfig.SelfSigned {
		return s.setupSelfSignedTLS()
	}

	if s.tlsConfig.CertPath != "" && s.tlsConfig.KeyPath != "" {
		return s.setupCustomCertTLS()
	}

	if s.tlsConfig.Domain != "" {
		return s.setupCertMagicTLS()
	}

	// Default to self-signed
	return s.setupSelfSignedTLS()
}

// setupSelfSignedTLS creates a self-signed certificate
func (s *TLSServer) setupSelfSignedTLS() (*tls.Config, error) {
	// Generate self-signed certificate
	cert, err := s.generateSelfSignedCert()
	if err != nil {
		return nil, fmt.Errorf("failed to generate self-signed certificate: %w", err)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		ServerName:   "localhost",
		MinVersion:   tls.VersionTLS12,
	}, nil
}

// setupCustomCertTLS loads custom certificates
func (s *TLSServer) setupCustomCertTLS() (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(s.tlsConfig.CertPath, s.tlsConfig.KeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load custom certificates: %w", err)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}, nil
}

// setupCertMagicTLS configures automatic certificate management
func (s *TLSServer) setupCertMagicTLS() (*tls.Config, error) {
	// Set up CertMagic for automatic HTTPS
	certmagic.DefaultACME.Agreed = true
	certmagic.DefaultACME.Email = "admin@" + s.tlsConfig.Domain

	// Configure storage path
	certmagic.Default.Storage = &certmagic.FileStorage{
		Path: filepath.Join("/tmp", "vibetunnel-certs"),
	}

	// Get certificate for domain
	err := certmagic.ManageSync(context.Background(), []string{s.tlsConfig.Domain})
	if err != nil {
		return nil, fmt.Errorf("failed to obtain certificate for domain %s: %w", s.tlsConfig.Domain, err)
	}

	tlsConfig, err := certmagic.TLS([]string{s.tlsConfig.Domain})
	if err != nil {
		return nil, fmt.Errorf("failed to create TLS config: %w", err)
	}
	return tlsConfig, nil
}

// generateSelfSignedCert creates a self-signed certificate for localhost
func (s *TLSServer) generateSelfSignedCert() (tls.Certificate, error) {
	// Generate RSA private key
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("failed to generate private key: %w", err)
	}

	// Create certificate template
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			Organization:  []string{"VibeTunnel"},
			Country:       []string{"US"},
			Province:      []string{""},
			Locality:      []string{"localhost"},
			StreetAddress: []string{""},
			PostalCode:    []string{""},
		},
		NotBefore:   time.Now(),
		NotAfter:    time.Now().Add(365 * 24 * time.Hour), // Valid for 1 year
		KeyUsage:    x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
		DNSNames:    []string{"localhost"},
	}

	// Generate certificate
	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("failed to create certificate: %w", err)
	}

	// Encode certificate to PEM
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})

	// Encode private key to PEM
	privateKeyDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("failed to marshal private key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateKeyDER})

	// Create TLS certificate
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("failed to create X509 key pair: %w", err)
	}

	return cert, nil
}

// startHTTPRedirect starts an HTTP server that redirects all requests to HTTPS
func (s *TLSServer) startHTTPRedirect(httpAddr, httpsAddr string) {
	redirectHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract host from httpsAddr for redirect
		host := r.Host
		if host == "" {
			host = "localhost"
		}

		// Remove port if present and add HTTPS port
		if colonIndex := len(host) - 1; host[colonIndex] == ':' {
			// Remove existing port
			for i := colonIndex - 1; i >= 0; i-- {
				if host[i] == ':' {
					host = host[:i]
					break
				}
			}
		}

		// Add HTTPS port
		if s.tlsConfig.Port != 443 {
			host = fmt.Sprintf("%s:%d", host, s.tlsConfig.Port)
		}

		httpsURL := fmt.Sprintf("https://%s%s", host, r.RequestURI)
		http.Redirect(w, r, httpsURL, http.StatusPermanentRedirect)
	})

	server := &http.Server{
		Addr:    httpAddr,
		Handler: redirectHandler,
	}

	log.Printf("Starting HTTP redirect server on %s -> HTTPS", httpAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("HTTP redirect server error: %v", err)
	}
}

// setupRoutes returns the configured HTTP handler (reusing existing Server logic)
func (s *TLSServer) setupRoutes() http.Handler {
	// Use the existing server's router setup
	return s.createHandler()
}
