package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/vibetunnel/linux/pkg/api"
	"github.com/vibetunnel/linux/pkg/config"
	"github.com/vibetunnel/linux/pkg/session"
)

var (
	// Version injected at build time
	version = "dev"
	
	// Session management flags
	controlPath       string
	sessionName       string
	listSessions      bool
	sendKey           string
	sendText          string
	signalCmd         string
	stopSession       bool
	killSession       bool
	cleanupExited     bool
	detachedSessionID string

	// Server flags
	serve      bool
	staticPath string

	// Network and access configuration
	port      string
	bindAddr  string
	localhost bool
	network   bool

	// Security flags
	password        string
	passwordEnabled bool

	// TLS/HTTPS flags (optional, defaults to HTTP like Rust version)
	tlsEnabled      bool
	tlsPort         string
	tlsDomain       string
	tlsSelfSigned   bool
	tlsCertPath     string
	tlsKeyPath      string
	tlsAutoRedirect bool

	// ngrok integration
	ngrokEnabled bool
	ngrokToken   string

	// Advanced options
	debugMode             bool
	cleanupStartup        bool
	serverMode            string
	updateChannel         string
	noSpawn               bool
	doNotAllowColumnSet   bool

	// Configuration file
	configFile string
)

var rootCmd = &cobra.Command{
	Use:   "vibetunnel",
	Short: "VibeTunnel - Remote terminal access for Linux",
	Long: `VibeTunnel allows you to access your Linux terminal from any web browser.
This is the Linux implementation compatible with the macOS VibeTunnel app.`,
	RunE: run,
	// Allow positional arguments after flags (for command execution)
	Args: cobra.ArbitraryArgs,
}

func init() {
	homeDir, _ := os.UserHomeDir()
	defaultControlPath := filepath.Join(homeDir, ".vibetunnel", "control")
	defaultConfigPath := filepath.Join(homeDir, ".vibetunnel", "config.yaml")

	// Session management flags
	rootCmd.Flags().StringVar(&controlPath, "control-path", defaultControlPath, "Control directory path")
	rootCmd.Flags().StringVar(&sessionName, "session-name", "", "Session name")
	rootCmd.Flags().BoolVar(&listSessions, "list-sessions", false, "List all sessions")
	rootCmd.Flags().StringVar(&sendKey, "send-key", "", "Send key to session")
	rootCmd.Flags().StringVar(&sendText, "send-text", "", "Send text to session")
	rootCmd.Flags().StringVar(&signalCmd, "signal", "", "Send signal to session")
	rootCmd.Flags().BoolVar(&stopSession, "stop", false, "Stop session (SIGTERM)")
	rootCmd.Flags().BoolVar(&killSession, "kill", false, "Kill session (SIGKILL)")
	rootCmd.Flags().BoolVar(&cleanupExited, "cleanup-exited", false, "Clean up exited sessions")
	rootCmd.Flags().StringVar(&detachedSessionID, "detached-session", "", "Run as detached session with given ID")

	// Server flags
	rootCmd.Flags().BoolVar(&serve, "serve", false, "Start HTTP server")
	rootCmd.Flags().StringVar(&staticPath, "static-path", "", "Path for static files")

	// Network and access configuration (compatible with VibeTunnel settings)
	rootCmd.Flags().StringVarP(&port, "port", "p", "4020", "Server port (default matches VibeTunnel)")
	rootCmd.Flags().StringVar(&bindAddr, "bind", "", "Bind address (auto-detected if empty)")
	rootCmd.Flags().BoolVar(&localhost, "localhost", false, "Bind to localhost only (127.0.0.1)")
	rootCmd.Flags().BoolVar(&network, "network", false, "Bind to all interfaces (0.0.0.0)")

	// Security flags (compatible with VibeTunnel dashboard settings)
	rootCmd.Flags().StringVar(&password, "password", "", "Dashboard password for Basic Auth")
	rootCmd.Flags().BoolVar(&passwordEnabled, "password-enabled", false, "Enable password protection")

	// TLS/HTTPS flags (optional enhancement, defaults to HTTP like Rust version)
	rootCmd.Flags().BoolVar(&tlsEnabled, "tls", false, "Enable HTTPS/TLS support")
	rootCmd.Flags().StringVar(&tlsPort, "tls-port", "4443", "HTTPS port")
	rootCmd.Flags().StringVar(&tlsDomain, "tls-domain", "", "Domain for Let's Encrypt (optional)")
	rootCmd.Flags().BoolVar(&tlsSelfSigned, "tls-self-signed", true, "Use self-signed certificates (default)")
	rootCmd.Flags().StringVar(&tlsCertPath, "tls-cert", "", "Custom TLS certificate path")
	rootCmd.Flags().StringVar(&tlsKeyPath, "tls-key", "", "Custom TLS key path")
	rootCmd.Flags().BoolVar(&tlsAutoRedirect, "tls-redirect", false, "Redirect HTTP to HTTPS")

	// ngrok integration (compatible with VibeTunnel ngrok service)
	rootCmd.Flags().BoolVar(&ngrokEnabled, "ngrok", false, "Enable ngrok tunnel")
	rootCmd.Flags().StringVar(&ngrokToken, "ngrok-token", "", "ngrok auth token")

	// Advanced options (compatible with VibeTunnel advanced settings)
	rootCmd.Flags().BoolVar(&debugMode, "debug", false, "Enable debug mode")
	rootCmd.Flags().BoolVar(&cleanupStartup, "cleanup-startup", false, "Clean up sessions on startup")
	rootCmd.Flags().StringVar(&serverMode, "server-mode", "native", "Server mode (native, rust)")
	rootCmd.Flags().StringVar(&updateChannel, "update-channel", "stable", "Update channel (stable, prerelease)")
	rootCmd.Flags().BoolVar(&noSpawn, "no-spawn", false, "Disable terminal spawning")
	rootCmd.Flags().BoolVar(&doNotAllowColumnSet, "do-not-allow-column-set", true, "Disable terminal resizing for all sessions (spawned and detached)")

	// Configuration file
	rootCmd.Flags().StringVarP(&configFile, "config", "c", defaultConfigPath, "Configuration file path")

	// Add version command
	rootCmd.AddCommand(&cobra.Command{
		Use:   "version",
		Short: "Show version information",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Printf("VibeTunnel Linux v%s\n", version)
			fmt.Println("Compatible with VibeTunnel macOS app")
		},
	})

	// Add config command
	rootCmd.AddCommand(&cobra.Command{
		Use:   "config",
		Short: "Show configuration",
		Run: func(cmd *cobra.Command, args []string) {
			cfg := config.LoadConfig(configFile)
			cfg.Print()
		},
	})
}

func run(cmd *cobra.Command, args []string) error {
	// Load configuration from file and merge with CLI flags
	cfg := config.LoadConfig(configFile)
	cfg.MergeFlags(cmd.Flags())

	// Apply configuration
	if cfg.ControlPath != "" {
		controlPath = cfg.ControlPath
	}
	if cfg.Server.Port != "" {
		port = cfg.Server.Port
	}

	// Handle detached session mode
	if detachedSessionID != "" {
		// We're running as a detached session
		// TODO: Implement RunDetachedSession
		return fmt.Errorf("detached session mode not yet implemented")
	}

	manager := session.NewManager(controlPath)

	// Handle cleanup on startup if enabled
	if cfg.Advanced.CleanupStartup || cleanupStartup {
		fmt.Println("Updating session statuses on startup...")
		// Only update statuses, don't remove sessions (matching Rust behavior)
		if err := manager.UpdateAllSessionStatuses(); err != nil {
			fmt.Printf("Warning: status update failed: %v\n", err)
		}
	}

	// Handle session management operations
	if listSessions {
		sessions, err := manager.ListSessions()
		if err != nil {
			return fmt.Errorf("failed to list sessions: %w", err)
		}
		fmt.Printf("ID\t\tName\t\tStatus\t\tCommand\n")
		for _, s := range sessions {
			fmt.Printf("%s\t%s\t\t%s\t\t%s\n", s.ID[:8], s.Name, s.Status, s.Cmdline)
		}
		return nil
	}

	if cleanupExited {
		// Match Rust behavior: actually remove dead sessions on manual cleanup
		return manager.RemoveExitedSessions()
	}

	// Handle session input/control operations
	if sessionName != "" && (sendKey != "" || sendText != "" || signalCmd != "" || stopSession || killSession) {
		sess, err := manager.FindSession(sessionName)
		if err != nil {
			return fmt.Errorf("failed to find session: %w", err)
		}

		if sendKey != "" {
			return sess.SendKey(sendKey)
		}
		if sendText != "" {
			return sess.SendText(sendText)
		}
		if signalCmd != "" {
			return sess.Signal(signalCmd)
		}
		if stopSession {
			return sess.Stop()
		}
		if killSession {
			return sess.Kill()
		}
	}

	// Handle server mode
	if serve {
		return startServer(cfg, manager)
	}

	// Handle direct command execution (create new session)
	if len(args) == 0 {
		return fmt.Errorf("no command specified. Use --serve to start server, --list-sessions to see sessions, or provide a command to execute")
	}

	sess, err := manager.CreateSession(session.Config{
		Name:      sessionName,
		Cmdline:   args,
		Cwd:       ".",
		IsSpawned: false, // Command line sessions are detached, not spawned
	})
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	fmt.Printf("Created session: %s (%s)\n", sess.ID, sess.ID[:8])
	return sess.Attach()
}

func startServer(cfg *config.Config, manager *session.Manager) error {
	// Terminal spawning behavior:
	// 1. When spawn_terminal=true in API requests, we first try to connect to the Mac app's socket
	// 2. If Mac app is running, it handles the terminal spawn via TerminalSpawnService 
	// 3. If Mac app is not running, we fall back to native terminal spawning (osascript on macOS)
	// This matches the Rust implementation's behavior.
	
	// Use static path from command line or config
	if staticPath == "" {
		staticPath = cfg.Server.StaticPath
	}
	
	// When running from Mac app, static path should always be provided via --static-path
	// When running standalone, user must provide the path
	if staticPath == "" {
		return fmt.Errorf("static path not specified. Use --static-path flag or configure in config file")
	}

	// Determine password
	serverPassword := password
	if cfg.Security.PasswordEnabled && cfg.Security.Password != "" {
		serverPassword = cfg.Security.Password
	}

	// Determine bind address
	bindAddress := determineBind(cfg)

	// Convert port to int
	portInt, err := strconv.Atoi(port)
	if err != nil {
		return fmt.Errorf("invalid port: %w", err)
	}

	// Create and configure server
	server := api.NewServer(manager, staticPath, serverPassword, portInt)
	server.SetNoSpawn(noSpawn)
	server.SetDoNotAllowColumnSet(doNotAllowColumnSet)

	// Configure ngrok if enabled
	var ngrokURL string
	if cfg.Ngrok.Enabled || ngrokEnabled {
		authToken := ngrokToken
		if authToken == "" && cfg.Ngrok.AuthToken != "" {
			authToken = cfg.Ngrok.AuthToken
		}
		if authToken != "" {
			// Start ngrok through the server's service
			if err := server.StartNgrok(authToken); err != nil {
				fmt.Printf("Warning: ngrok failed to start: %v\n", err)
			} else {
				fmt.Printf("Ngrok tunnel starting...\n")
			}
		} else {
			fmt.Printf("Warning: ngrok enabled but no auth token provided\n")
		}
	}

	// Check if TLS is enabled
	if tlsEnabled {
		// Convert TLS port to int
		tlsPortInt, err := strconv.Atoi(tlsPort)
		if err != nil {
			return fmt.Errorf("invalid TLS port: %w", err)
		}

		// Create TLS configuration
		tlsConfig := &api.TLSConfig{
			Enabled:      true,
			Port:         tlsPortInt,
			Domain:       tlsDomain,
			SelfSigned:   tlsSelfSigned,
			CertPath:     tlsCertPath,
			KeyPath:      tlsKeyPath,
			AutoRedirect: tlsAutoRedirect,
		}

		// Create TLS server
		tlsServer := api.NewTLSServer(server, tlsConfig)

		// Print startup information for TLS
		fmt.Printf("Starting VibeTunnel HTTPS server on %s:%s\n", bindAddress, tlsPort)
		if tlsAutoRedirect {
			fmt.Printf("HTTP redirect server on %s:%s -> HTTPS\n", bindAddress, port)
		}
		fmt.Printf("Serving web UI from: %s\n", staticPath)
		fmt.Printf("Control directory: %s\n", controlPath)

		if tlsSelfSigned {
			fmt.Printf("TLS: Using self-signed certificates for localhost\n")
		} else if tlsDomain != "" {
			fmt.Printf("TLS: Using Let's Encrypt for domain: %s\n", tlsDomain)
		} else if tlsCertPath != "" && tlsKeyPath != "" {
			fmt.Printf("TLS: Using custom certificates\n")
		}

		if serverPassword != "" {
			fmt.Printf("Basic auth enabled with username: admin\n")
		}

		if ngrokURL != "" {
			fmt.Printf("ngrok tunnel: %s\n", ngrokURL)
		}

		if cfg.Advanced.DebugMode || debugMode {
			fmt.Printf("Debug mode enabled\n")
		}

		// Start TLS server
		httpAddr := ""
		if tlsAutoRedirect {
			httpAddr = fmt.Sprintf("%s:%s", bindAddress, port)
		}
		httpsAddr := fmt.Sprintf("%s:%s", bindAddress, tlsPort)

		return tlsServer.StartTLS(httpAddr, httpsAddr)
	}

	// Default HTTP behavior (like Rust version)
	fmt.Printf("Starting VibeTunnel server on %s:%s\n", bindAddress, port)
	fmt.Printf("Serving web UI from: %s\n", staticPath)
	fmt.Printf("Control directory: %s\n", controlPath)

	if serverPassword != "" {
		fmt.Printf("Basic auth enabled with username: admin\n")
	}

	if ngrokURL != "" {
		fmt.Printf("ngrok tunnel: %s\n", ngrokURL)
	}

	if cfg.Advanced.DebugMode || debugMode {
		fmt.Printf("Debug mode enabled\n")
	}

	return server.Start(fmt.Sprintf("%s:%s", bindAddress, port))
}

func determineBind(cfg *config.Config) string {
	// CLI flags take precedence
	if localhost {
		return "127.0.0.1"
	}
	if network {
		return "0.0.0.0"
	}

	// Check configuration
	switch cfg.Server.AccessMode {
	case "localhost":
		return "127.0.0.1"
	case "network":
		return "0.0.0.0"
	default:
		// Default to localhost for security
		return "127.0.0.1"
	}
}

func main() {
	// Check if we're being run with TTY_SESSION_ID (spawned by Mac app)
	if sessionID := os.Getenv("TTY_SESSION_ID"); sessionID != "" {
		// We're running in a terminal spawned by the Mac app
		// Redirect logs to avoid polluting the terminal
		logFile, err := os.OpenFile("/tmp/vibetunnel-session.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err == nil {
			log.SetOutput(logFile)
			defer logFile.Close()
		}
		
		// Use the existing session ID instead of creating a new one
		homeDir, _ := os.UserHomeDir()
		defaultControlPath := filepath.Join(homeDir, ".vibetunnel", "control")
		cfg := config.LoadConfig(filepath.Join(homeDir, ".vibetunnel", "config.yaml"))
		if cfg.ControlPath != "" {
			defaultControlPath = cfg.ControlPath
		}
		
		manager := session.NewManager(defaultControlPath)
		
		// Wait for the session to be created by the API server
		// The server creates the session before sending the spawn request
		var sess *session.Session
		for i := 0; i < 50; i++ { // Try for up to 5 seconds
			sess, err = manager.GetSession(sessionID)
			if err == nil {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Session %s not found\n", sessionID)
			os.Exit(1)
		}
		
		// Attach to the session
		if err := sess.Attach(); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
	}
	
	// Check for special case: if we have args but no recognized VibeTunnel flags,
	// treat everything as a command to execute (compatible with old Rust behavior)
	if len(os.Args) > 1 {
		// Parse flags without executing to check what we have
		rootCmd.DisableFlagParsing = true
		rootCmd.ParseFlags(os.Args[1:])
		rootCmd.DisableFlagParsing = false
		
		// Get the command and check if first arg is a subcommand
		args := os.Args[1:]
		if len(args) > 0 && (args[0] == "version" || args[0] == "config") {
			// This is a subcommand, let Cobra handle it normally
		} else {
			// Check if we have a -- separator (everything after it is the command)
			dashDashIndex := -1
			for i, arg := range args {
				if arg == "--" {
					dashDashIndex = i
					break
				}
			}
			
			if dashDashIndex >= 0 {
				// We have a -- separator, everything after it is the command to execute
				cmdArgs := args[dashDashIndex+1:]
				if len(cmdArgs) > 0 {
					homeDir, _ := os.UserHomeDir()
					defaultControlPath := filepath.Join(homeDir, ".vibetunnel", "control")
					cfg := config.LoadConfig(filepath.Join(homeDir, ".vibetunnel", "config.yaml"))
					if cfg.ControlPath != "" {
						defaultControlPath = cfg.ControlPath
					}
					
					manager := session.NewManager(defaultControlPath)
					sess, err := manager.CreateSession(session.Config{
						Name:      "",
						Cmdline:   cmdArgs,
						Cwd:       ".",
						IsSpawned: false, // Command line sessions are detached
					})
					if err != nil {
						fmt.Fprintf(os.Stderr, "Error: %v\n", err)
						os.Exit(1)
					}
					
					// Attach to the session
					if err := sess.Attach(); err != nil {
						fmt.Fprintf(os.Stderr, "Error: %v\n", err)
						os.Exit(1)
					}
					return
				}
			} else {
				// No -- separator, check if any args look like VibeTunnel flags
				hasVibeTunnelFlags := false
				for _, arg := range args {
					if strings.HasPrefix(arg, "-") {
						// Check if this is one of our known flags
						flag := strings.TrimLeft(arg, "-")
						flag = strings.Split(flag, "=")[0] // Handle --flag=value format
						
						knownFlags := []string{
							"serve", "port", "p", "bind", "localhost", "network",
							"password", "password-enabled", "tls", "tls-port", "tls-domain",
							"tls-self-signed", "tls-cert", "tls-key", "tls-redirect",
							"ngrok", "ngrok-token", "debug", "cleanup-startup",
							"server-mode", "update-channel", "config", "c",
							"control-path", "session-name", "list-sessions",
							"send-key", "send-text", "signal", "stop", "kill",
							"cleanup-exited", "detached-session", "static-path", "help", "h",
						}
						
						for _, known := range knownFlags {
							if flag == known {
								hasVibeTunnelFlags = true
								break
							}
						}
						if hasVibeTunnelFlags {
							break
						}
					}
				}
				
				// If no VibeTunnel flags found, treat everything as a command
				if !hasVibeTunnelFlags && len(args) > 0 {
					homeDir, _ := os.UserHomeDir()
					defaultControlPath := filepath.Join(homeDir, ".vibetunnel", "control")
					cfg := config.LoadConfig(filepath.Join(homeDir, ".vibetunnel", "config.yaml"))
					if cfg.ControlPath != "" {
						defaultControlPath = cfg.ControlPath
					}
					
					manager := session.NewManager(defaultControlPath)
					sess, err := manager.CreateSession(session.Config{
						Name:      "",
						Cmdline:   args,
						Cwd:       ".",
						IsSpawned: false, // Command line sessions are detached
					})
					if err != nil {
						fmt.Fprintf(os.Stderr, "Error: %v\n", err)
						os.Exit(1)
					}
					
					// Attach to the session
					if err := sess.Attach(); err != nil {
						fmt.Fprintf(os.Stderr, "Error: %v\n", err)
						os.Exit(1)
					}
					return
				}
			}
		}
	}
	
	// Fall back to Cobra command handling for flags and structured commands
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
