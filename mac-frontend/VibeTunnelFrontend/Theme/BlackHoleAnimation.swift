import SwiftUI

// MARK: - Black Hole Animation

struct BlackHoleAnimationModifier: ViewModifier {
    let isActive: Bool
    let targetPoint: CGPoint
    @State private var scale: CGFloat = 1.0
    @State private var opacity: Double = 1.0
    @State private var rotation: Double = 0
    @State private var offset: CGSize = .zero
    
    func body(content: Content) -> some View {
        content
            .scaleEffect(scale)
            .opacity(opacity)
            .rotationEffect(.degrees(rotation))
            .offset(offset)
            .onChange(of: isActive) { _, newValue in
                if newValue {
                    performBlackHoleAnimation()
                }
            }
    }
    
    private func performBlackHoleAnimation() {
        // Phase 1: Shrink and start rotating
        withAnimation(.easeIn(duration: 0.3)) {
            scale = 0.8
            rotation = 180
        }
        
        // Phase 2: Move towards target and spin faster
        withAnimation(.easeInOut(duration: 0.4).delay(0.3)) {
            offset = CGSize(
                width: targetPoint.x,
                height: targetPoint.y
            )
            rotation = 720
            scale = 0.3
        }
        
        // Phase 3: Final collapse
        withAnimation(.easeIn(duration: 0.2).delay(0.7)) {
            scale = 0
            opacity = 0
            rotation = 1080
        }
    }
}

// MARK: - Batch Black Hole Animation

struct BatchBlackHoleAnimation: ViewModifier {
    let isActive: Bool
    
    func body(content: Content) -> some View {
        ZStack {
            if isActive {
                // Simple vortex effect at center
                GeometryReader { geometry in
                    BlackHoleVortex()
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                        .transition(.scale.combined(with: .opacity))
                        .zIndex(1000)
                }
            }
            
            content
        }
    }
}

// MARK: - Black Hole Item Modifier

struct BlackHoleItemModifier: ViewModifier {
    let isAnimating: Bool
    let targetPoint: CGPoint
    let delay: Double
    
    @State private var scale: CGFloat = 1.0
    @State private var opacity: Double = 1.0
    @State private var rotation: Double = 0
    @State private var offset: CGSize = .zero
    
    func body(content: Content) -> some View {
        content
            .scaleEffect(scale)
            .opacity(opacity)
            .rotationEffect(.degrees(rotation))
            .offset(offset)
            .onChange(of: isAnimating) { _, newValue in
                if newValue {
                    performAnimation()
                }
            }
    }
    
    private func performAnimation() {
        // Calculate offset to target
        let targetOffset = CGSize(
            width: targetPoint.x,
            height: targetPoint.y
        )
        
        // Animate with delay
        withAnimation(.easeIn(duration: 0.8).delay(delay)) {
            offset = targetOffset
            scale = 0
            opacity = 0
            rotation = 720
        }
    }
}

// MARK: - Black Hole Vortex Visual

struct BlackHoleVortex: View {
    @State private var rotation: Double = 0
    @State private var scale: CGFloat = 0
    
    var body: some View {
        ZStack {
            // Outer ring
            Circle()
                .stroke(
                    AngularGradient(
                        colors: [
                            Theme.Colors.accent.opacity(0.8),
                            Theme.Colors.accent.opacity(0.4),
                            Theme.Colors.accent.opacity(0.8)
                        ],
                        center: .center
                    ),
                    lineWidth: 3
                )
                .frame(width: 100, height: 100)
                .scaleEffect(scale)
                .rotationEffect(.degrees(rotation))
            
            // Inner vortex
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color.black,
                            Theme.Colors.accent.opacity(0.3),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 50
                    )
                )
                .frame(width: 80, height: 80)
                .scaleEffect(scale * 0.8)
                .rotationEffect(.degrees(-rotation * 2))
            
            // Center point
            Circle()
                .fill(Color.black)
                .frame(width: 20, height: 20)
                .scaleEffect(scale * 0.5)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.3)) {
                scale = 1.0
            }
            
            withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                rotation = 360
            }
        }
    }
}

// MARK: - Supporting Types

extension CGRect {
    var center: CGPoint {
        CGPoint(x: midX, y: midY)
    }
}

// MARK: - View Extensions

extension View {
    func blackHoleAnimation(isActive: Bool, targetPoint: CGPoint) -> some View {
        self.modifier(BlackHoleAnimationModifier(isActive: isActive, targetPoint: targetPoint))
    }
    
    func blackHoleRemoval(isRemoving: Bool, onComplete: @escaping () -> Void) -> some View {
        self
            .scaleEffect(isRemoving ? 0 : 1)
            .opacity(isRemoving ? 0 : 1)
            .rotationEffect(.degrees(isRemoving ? 720 : 0))
            .animation(.easeIn(duration: 0.8), value: isRemoving)
            .onChange(of: isRemoving) { _, newValue in
                if newValue {
                    // Trigger completion after animation duration
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        onComplete()
                    }
                }
            }
    }
}

// MARK: - Simple Black Hole Effect

extension View {
    func simpleBlackHoleEffect(isActive: Bool) -> some View {
        self
            .scaleEffect(isActive ? 0 : 1)
            .opacity(isActive ? 0 : 1)
            .rotationEffect(.degrees(isActive ? 360 : 0))
            .animation(
                isActive ? .easeIn(duration: 0.6) : .default,
                value: isActive
            )
    }
}