import os
import SwiftUI

/// Shared glowing app icon component with configurable animation and effects.
///
/// This component displays the VibeTunnel app icon with customizable glow effects,
/// floating animation, and interactive behaviors. It can be used in both the Welcome
/// and About views with different configurations.
struct GlowingAppIcon: View {
    /// Configuration
    let size: CGFloat

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "GlowingAppIcon")
    let enableFloating: Bool
    let enableInteraction: Bool
    let glowIntensity: Double
    let action: (() -> Void)?

    // State
    @State private var isHovering = false
    @State private var isPressed = false
    @State private var breathingScale: CGFloat = 1.0
    @State private var breathingPhase: CGFloat = 0
    @Environment(\.colorScheme)
    private var colorScheme

    init(
        size: CGFloat = 128,
        enableFloating: Bool = true,
        enableInteraction: Bool = true,
        glowIntensity: Double = 0.3,
        action: (() -> Void)? = nil
    ) {
        self.size = size
        self.enableFloating = enableFloating
        self.enableInteraction = enableInteraction
        self.glowIntensity = glowIntensity
        self.action = action
    }

    var body: some View {
        Group {
            if enableInteraction {
                Button(action: { action?() }, label: {
                    iconContent
                })
                .buttonStyle(PlainButtonStyle())
                .pointingHandCursor()
                .onHover { hovering in
                    isHovering = hovering
                }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in isPressed = true }
                        .onEnded { _ in isPressed = false }
                )
            } else {
                iconContent
            }
        }
        .scaleEffect(breathingScale)
        .onAppear {
            if enableFloating {
                startBreathingAnimation()
            }
        }
    }

    private var iconContent: some View {
        ZStack {
            // Subtle glow effect that changes with breathing
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .opacity(dynamicGlowOpacity)
                .blur(radius: dynamicGlowBlur)
                .scaleEffect(1.15)
                .allowsHitTesting(false)

            // Main icon with shadow
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .scaleEffect(iconScale)
                .shadow(
                    color: dynamicShadowColor,
                    radius: dynamicShadowRadius,
                    x: 0,
                    y: dynamicShadowOffset
                )
                .animation(.easeInOut(duration: 0.2), value: isHovering)
                .animation(.easeInOut(duration: 0.1), value: isPressed)
        }
    }

    private var cornerRadius: CGFloat {
        size * 0.172 // Maintains the same corner radius ratio as original (22/128)
    }

    private var iconScale: CGFloat {
        if !enableInteraction { return 1.0 }
        return isPressed ? 0.95 : (isHovering ? 1.05 : 1.0)
    }

    /// Dynamic properties that change with breathing
    private var dynamicGlowOpacity: Double {
        let baseOpacity = glowIntensity * 0.5
        // Glow gets stronger when "coming forward" (breathingPhase > 0)
        return baseOpacity + (breathingPhase * glowIntensity * 0.3)
    }

    private var dynamicGlowBlur: CGFloat {
        // Blur increases when coming forward for a softer, larger glow
        15 + (breathingPhase * 5)
    }

    private var dynamicShadowColor: Color {
        let baseOpacity = colorScheme == .dark ? 0.4 : 0.2
        let hoverOpacity = colorScheme == .dark ? 0.6 : 0.3
        let opacity = isHovering ? hoverOpacity : baseOpacity
        // Shadow gets stronger when coming forward
        let breathingOpacity = opacity + (breathingPhase * 0.1)
        return .black.opacity(breathingOpacity)
    }

    private var dynamicShadowRadius: CGFloat {
        let baseRadius = size * 0.117
        let hoverMultiplier: CGFloat = enableInteraction && isHovering ? 1.5 : 1.0
        // Shadow gets softer/larger when coming forward
        let breathingMultiplier = 1.0 + (breathingPhase * 0.2)
        return baseRadius * hoverMultiplier * breathingMultiplier
    }

    private var dynamicShadowOffset: CGFloat {
        let baseOffset = size * 0.047
        let hoverMultiplier: CGFloat = enableInteraction && isHovering ? 1.5 : 1.0
        // Shadow moves down more when coming forward
        let breathingMultiplier = 1.0 + (breathingPhase * 0.3)
        return baseOffset * hoverMultiplier * breathingMultiplier
    }

    private func startBreathingAnimation() {
        withAnimation(
            Animation.easeInOut(duration: 4.0)
                .repeatForever(autoreverses: true)
        ) {
            breathingScale = 1.04 // Very subtle scale change
            breathingPhase = 1.0 // Used to calculate dynamic effects
        }
    }
}

// MARK: - Preview

#Preview("Glowing App Icons") {
    VStack(spacing: 40) {
        // Welcome style - larger, subtle floating
        GlowingAppIcon(
            size: 156,
            enableFloating: true,
            enableInteraction: false,
            glowIntensity: 0.3
        )

        // About style - smaller, interactive
        GlowingAppIcon(
            size: 128,
            enableFloating: true,
            enableInteraction: true,
            glowIntensity: 0.3
        ) {
            // Icon clicked - action handled here
        }
    }
    .padding()
    .frame(width: 400, height: 600)
}
