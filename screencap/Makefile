CC = clang
CFLAGS = -framework Foundation -framework ScreenCaptureKit -framework CoreMedia -framework CoreVideo -framework ImageIO -framework UniformTypeIdentifiers -framework CoreGraphics -framework AppKit -framework VideoToolbox
SRCDIR = .
TARGET = screencap7
PORT = 3030

# Build the binary
build:
	@echo "🔨 Building screencap7 with VP9 support..."
	cd $(SRCDIR) && $(CC) -o $(TARGET) screencap7_clean.m vp9_encoder.m $(CFLAGS)
	@echo "✅ Build complete!"

# Run the server
run: build
	@echo "🚀 Starting screencap7 server on port $(PORT)..."
	cd $(SRCDIR) && ./$(TARGET) $(PORT)

# Run on custom port
run-port: build
	@echo "🚀 Starting screencap7 server on port $(p)..."
	cd $(SRCDIR) && ./$(TARGET) $(p)

# Clean build artifacts
clean:
	@echo "🧹 Cleaning..."
	rm -f $(SRCDIR)/$(TARGET)
	@echo "✅ Clean complete!"

# Test the server endpoints
test: build
	@echo "🧪 Testing server endpoints..."
	cd $(SRCDIR) && ./$(TARGET) 8090 &
	@echo "Waiting for server to start..."
	@sleep 3
	@echo "\n1️⃣ Testing web UI:"
	@curl -s -w "%{http_code}" http://127.0.0.1:8090/ -o /dev/null
	@echo "\n2️⃣ Testing display info:"
	@curl -s http://127.0.0.1:8090/display | head -c 100
	@echo "\n3️⃣ Testing windows list:"
	@curl -s http://127.0.0.1:8090/windows | head -c 100
	@echo "\n\n🛑 Stopping test server..."
	@pkill -f "screencap7 8090" || true
	@echo "✅ Test complete!"

# Install dependencies (macOS permissions reminder)
setup:
	@echo "📋 Setup Requirements:"
	@echo "   1. Grant Screen Recording permission:"
	@echo "      System Preferences > Privacy & Security > Screen Recording"
	@echo "   2. Grant Accessibility permission:"
	@echo "      System Preferences > Privacy & Security > Accessibility"
	@echo "   3. Run 'make run' to start the server"
	@echo "   4. Open http://localhost:$(PORT) in your browser"

# Swift version
SWIFT_DIR = native/swift
SWIFT_TARGET = screencap8

# Build Swift version
build_swift:
	@echo "🔨 Building screencap8 (Swift) with ScreenCaptureKit..."
	cd $(SWIFT_DIR) && swiftc -o $(SWIFT_TARGET) main.swift ScreenCapture.swift HTTPServer.swift -framework Foundation -framework ScreenCaptureKit -framework CoreMedia -framework CoreVideo -framework CoreImage -framework ImageIO -framework UniformTypeIdentifiers -framework CoreGraphics -framework ApplicationServices -framework AppKit -framework Network
	@echo "✅ Swift build complete!"

# Run Swift version
run_swift: build_swift
	@echo "🚀 Starting screencap8 (Swift) server on port $(PORT)..."
	cd $(SWIFT_DIR) && ./$(SWIFT_TARGET) $(PORT)

# Clean Swift artifacts
clean_swift:
	@echo "🧹 Cleaning Swift build..."
	rm -f $(SWIFT_DIR)/$(SWIFT_TARGET)
	@echo "✅ Swift clean complete!"

# Show usage
help:
	@echo "Available commands:"
	@echo "  make build     - Build the screencap7 binary (Objective-C)"
	@echo "  make run       - Build and run server on port $(PORT) (Objective-C)"
	@echo "  make run-port p=8090 - Build and run server on custom port (Objective-C)"
	@echo "  make build_swift - Build the screencap8 binary (Swift)"
	@echo "  make run_swift - Build and run Swift server on port $(PORT)"
	@echo "  make clean     - Remove build artifacts"
	@echo "  make clean_swift - Remove Swift build artifacts"
	@echo "  make test      - Build and test server endpoints"
	@echo "  make setup     - Show setup requirements"
	@echo "  make help      - Show this help"

.PHONY: build run run-port clean test setup help build_swift run_swift clean_swift