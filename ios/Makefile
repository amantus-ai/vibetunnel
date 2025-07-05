# Makefile for VibeTunnel iOS incremental builds

# Configuration
SCHEME = VibeTunnel-iOS
PROJECT = VibeTunnel-iOS.xcodeproj
DERIVED_DATA = $(HOME)/Library/Developer/Xcode/DerivedData
BUILD_DIR = build

# Build configurations
CONFIG_DEBUG = Debug
CONFIG_RELEASE = Release

# Destinations
DEST_IOS = 'generic/platform=iOS'
DEST_SIMULATOR = 'platform=iOS Simulator,name=iPhone 15'

# Default target
.PHONY: all
all: build

# Build for iOS (generic, no code signing)
.PHONY: build
build:
	xcodebuild \
		-scheme $(SCHEME) \
		-project $(PROJECT) \
		-configuration $(CONFIG_DEBUG) \
		-destination $(DEST_IOS) \
		-allowProvisioningUpdates \
		CODE_SIGN_IDENTITY="" \
		CODE_SIGNING_REQUIRED=NO \
		CODE_SIGNING_ALLOWED=NO \
		build

# Build for simulator
.PHONY: simulator
simulator:
	xcodebuild \
		-scheme $(SCHEME) \
		-project $(PROJECT) \
		-configuration $(CONFIG_DEBUG) \
		-destination $(DEST_SIMULATOR) \
		build

# Clean build
.PHONY: clean
clean:
	xcodebuild \
		-scheme $(SCHEME) \
		-project $(PROJECT) \
		clean
	rm -rf $(BUILD_DIR)

# Run tests
.PHONY: test
test:
	xcodebuild \
		-scheme $(SCHEME) \
		-project $(PROJECT) \
		-destination $(DEST_SIMULATOR) \
		test

# Check for compilation errors only (fast)
.PHONY: check
check:
	xcodebuild \
		-scheme $(SCHEME) \
		-project $(PROJECT) \
		-configuration $(CONFIG_DEBUG) \
		-destination $(DEST_IOS) \
		CODE_SIGN_IDENTITY="" \
		CODE_SIGNING_REQUIRED=NO \
		-dry-run \
		build 2>&1 | grep -E "(error:|warning:)" || echo "No compilation errors found"

# Show build settings
.PHONY: settings
settings:
	xcodebuild \
		-scheme $(SCHEME) \
		-project $(PROJECT) \
		-showBuildSettings

# Help
.PHONY: help
help:
	@echo "VibeTunnel iOS Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  make build     - Build for iOS (no code signing)"
	@echo "  make simulator - Build for iOS Simulator"
	@echo "  make clean     - Clean build artifacts"
	@echo "  make test      - Run tests"
	@echo "  make check     - Quick compilation check"
	@echo "  make settings  - Show build settings"
	@echo "  make help      - Show this help"