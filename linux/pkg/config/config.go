package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/pflag"
	"gopkg.in/yaml.v3"
)

// Config represents the VibeTunnel configuration
// Mirrors the structure of VibeTunnel's settings system
type Config struct {
	ControlPath string   `yaml:"control_path"`
	Server      Server   `yaml:"server"`
	Security    Security `yaml:"security"`
	Ngrok       Ngrok    `yaml:"ngrok"`
	Advanced    Advanced `yaml:"advanced"`
	Update      Update   `yaml:"update"`
}

// Server configuration (mirrors DashboardSettingsView.swift)
type Server struct {
	Port       string `yaml:"port"`
	AccessMode string `yaml:"access_mode"` // "localhost" or "network"
	StaticPath string `yaml:"static_path"`
	Mode       string `yaml:"mode"` // "native" or "rust"
}

// Security configuration (mirrors dashboard password settings)
type Security struct {
	PasswordEnabled bool   `yaml:"password_enabled"`
	Password        string `yaml:"password"`
}

// Ngrok configuration (mirrors NgrokService.swift)
type Ngrok struct {
	Enabled     bool   `yaml:"enabled"`
	AuthToken   string `yaml:"auth_token"`
	TokenStored bool   `yaml:"token_stored"`
}

// Advanced configuration (mirrors AdvancedSettingsView.swift)
type Advanced struct {
	DebugMode      bool   `yaml:"debug_mode"`
	CleanupStartup bool   `yaml:"cleanup_startup"`
	PreferredTerm  string `yaml:"preferred_terminal"`
}

// Update configuration (mirrors UpdateChannel.swift)
type Update struct {
	Channel           string `yaml:"channel"` // "stable" or "prerelease"
	AutoCheck         bool   `yaml:"auto_check"`
	ShowNotifications bool   `yaml:"show_notifications"`
}

// DefaultConfig returns a configuration with VibeTunnel-compatible defaults
func DefaultConfig() *Config {
	homeDir, _ := os.UserHomeDir()
	return &Config{
		ControlPath: filepath.Join(homeDir, ".vibetunnel", "control"),
		Server: Server{
			Port:       "4020", // Matches VibeTunnel default
			AccessMode: "localhost",
			Mode:       "native",
		},
		Security: Security{
			PasswordEnabled: false,
		},
		Ngrok: Ngrok{
			Enabled: false,
		},
		Advanced: Advanced{
			DebugMode:      false,
			CleanupStartup: false,
			PreferredTerm:  "auto",
		},
		Update: Update{
			Channel:           "stable",
			AutoCheck:         true,
			ShowNotifications: true,
		},
	}
}

// LoadConfig loads configuration from file, creates default if not exists
func LoadConfig(filename string) *Config {
	cfg := DefaultConfig()

	if filename == "" {
		return cfg
	}

	// Create config directory if it doesn't exist
	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
		fmt.Printf("Warning: failed to create config directory: %v\n", err)
		return cfg
	}

	// Try to read existing config
	data, err := os.ReadFile(filename)
	if err != nil {
		if !os.IsNotExist(err) {
			fmt.Printf("Warning: failed to read config file: %v\n", err)
		}
		// Save default config
		if err := cfg.Save(filename); err != nil {
			fmt.Printf("Warning: failed to save default config: %v\n", err)
		}
		return cfg
	}

	// Parse existing config
	if err := yaml.Unmarshal(data, cfg); err != nil {
		fmt.Printf("Warning: failed to parse config file: %v\n", err)
		return DefaultConfig()
	}

	return cfg
}

// Save saves the configuration to file
func (c *Config) Save(filename string) error {
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}

	return os.WriteFile(filename, data, 0644)
}

// MergeFlags merges command line flags into the configuration
func (c *Config) MergeFlags(flags *pflag.FlagSet) {
	// Only merge flags that were actually set by the user
	if flags.Changed("port") {
		if val, err := flags.GetString("port"); err == nil {
			c.Server.Port = val
		}
	}

	if flags.Changed("localhost") {
		if val, err := flags.GetBool("localhost"); err == nil && val {
			c.Server.AccessMode = "localhost"
		}
	}

	if flags.Changed("network") {
		if val, err := flags.GetBool("network"); err == nil && val {
			c.Server.AccessMode = "network"
		}
	}

	if flags.Changed("password") {
		if val, err := flags.GetString("password"); err == nil && val != "" {
			c.Security.Password = val
			c.Security.PasswordEnabled = true
		}
	}

	if flags.Changed("password-enabled") {
		if val, err := flags.GetBool("password-enabled"); err == nil {
			c.Security.PasswordEnabled = val
		}
	}

	if flags.Changed("ngrok") {
		if val, err := flags.GetBool("ngrok"); err == nil {
			c.Ngrok.Enabled = val
		}
	}

	if flags.Changed("ngrok-token") {
		if val, err := flags.GetString("ngrok-token"); err == nil && val != "" {
			c.Ngrok.AuthToken = val
			c.Ngrok.TokenStored = true
		}
	}

	if flags.Changed("debug") {
		if val, err := flags.GetBool("debug"); err == nil {
			c.Advanced.DebugMode = val
		}
	}

	if flags.Changed("cleanup-startup") {
		if val, err := flags.GetBool("cleanup-startup"); err == nil {
			c.Advanced.CleanupStartup = val
		}
	}

	if flags.Changed("server-mode") {
		if val, err := flags.GetString("server-mode"); err == nil {
			c.Server.Mode = val
		}
	}

	if flags.Changed("update-channel") {
		if val, err := flags.GetString("update-channel"); err == nil {
			c.Update.Channel = val
		}
	}

	if flags.Changed("static-path") {
		if val, err := flags.GetString("static-path"); err == nil {
			c.Server.StaticPath = val
		}
	}

	if flags.Changed("control-path") {
		if val, err := flags.GetString("control-path"); err == nil {
			c.ControlPath = val
		}
	}
}

// Print displays the current configuration
func (c *Config) Print() {
	fmt.Println("VibeTunnel Configuration:")
	fmt.Printf("  Control Path: %s\n", c.ControlPath)
	fmt.Println("\nServer:")
	fmt.Printf("  Port: %s\n", c.Server.Port)
	fmt.Printf("  Access Mode: %s\n", c.Server.AccessMode)
	fmt.Printf("  Static Path: %s\n", c.Server.StaticPath)
	fmt.Printf("  Mode: %s\n", c.Server.Mode)
	fmt.Println("\nSecurity:")
	fmt.Printf("  Password Enabled: %t\n", c.Security.PasswordEnabled)
	if c.Security.PasswordEnabled {
		fmt.Printf("  Password: [hidden]\n")
	}
	fmt.Println("\nNgrok:")
	fmt.Printf("  Enabled: %t\n", c.Ngrok.Enabled)
	fmt.Printf("  Token Stored: %t\n", c.Ngrok.TokenStored)
	fmt.Println("\nAdvanced:")
	fmt.Printf("  Debug Mode: %t\n", c.Advanced.DebugMode)
	fmt.Printf("  Cleanup on Startup: %t\n", c.Advanced.CleanupStartup)
	fmt.Printf("  Preferred Terminal: %s\n", c.Advanced.PreferredTerm)
	fmt.Println("\nUpdate:")
	fmt.Printf("  Channel: %s\n", c.Update.Channel)
	fmt.Printf("  Auto Check: %t\n", c.Update.AutoCheck)
	fmt.Printf("  Show Notifications: %t\n", c.Update.ShowNotifications)
}
