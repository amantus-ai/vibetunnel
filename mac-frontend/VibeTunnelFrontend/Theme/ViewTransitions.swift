import SwiftUI

// MARK: - View Transitions

extension AnyTransition {
    static var slideAndFade: AnyTransition {
        AnyTransition.asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .leading).combined(with: .opacity)
        )
    }
    
    static var scaleAndFade: AnyTransition {
        AnyTransition.scale.combined(with: .opacity)
    }
    
    static var smoothPush: AnyTransition {
        AnyTransition.asymmetric(
            insertion: .move(edge: .trailing)
                .combined(with: .opacity)
                .animation(.spring(response: 0.3, dampingFraction: 0.8)),
            removal: .move(edge: .leading)
                .combined(with: .opacity)
                .animation(.spring(response: 0.3, dampingFraction: 0.8))
        )
    }
    
    static var smoothModal: AnyTransition {
        AnyTransition.asymmetric(
            insertion: .scale(scale: 0.95).combined(with: .opacity),
            removal: .scale(scale: 1.05).combined(with: .opacity)
        )
    }
    
    static var cardFlip: AnyTransition {
        AnyTransition.asymmetric(
            insertion: .move(edge: .bottom)
                .combined(with: .opacity)
                .combined(with: .scale(scale: 0.9)),
            removal: .move(edge: .top)
                .combined(with: .opacity)
                .combined(with: .scale(scale: 0.9))
        )
    }
}

// MARK: - View Modifiers for Smooth Transitions

struct SmoothTransitionModifier: ViewModifier {
    let id: String
    @State private var namespace: Namespace.ID
    
    init(id: String) {
        self.id = id
        self._namespace = State(initialValue: Namespace().wrappedValue)
    }
    
    func body(content: Content) -> some View {
        content
            .matchedGeometryEffect(id: id, in: namespace)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: id)
    }
}

extension View {
    func smoothTransition(id: String) -> some View {
        self.modifier(SmoothTransitionModifier(id: id))
    }
}

// MARK: - Page Transition Container

struct PageTransitionContainer<Content: View>: View {
    let content: Content
    let transition: AnyTransition
    
    init(transition: AnyTransition = .slideAndFade, @ViewBuilder content: () -> Content) {
        self.transition = transition
        self.content = content()
    }
    
    var body: some View {
        content
            .transition(transition)
            .animation(Theme.Animation.standard, value: UUID())
    }
}

// MARK: - Crossfade Transition

struct CrossfadeTransition: ViewModifier {
    let isActive: Bool
    
    func body(content: Content) -> some View {
        content
            .opacity(isActive ? 1 : 0)
            .scaleEffect(isActive ? 1 : 0.95)
            .animation(.easeInOut(duration: 0.2), value: isActive)
    }
}

extension View {
    func crossfade(_ isActive: Bool) -> some View {
        self.modifier(CrossfadeTransition(isActive: isActive))
    }
}

// MARK: - Hero Animation Support

struct HeroAnimationModifier: ViewModifier {
    let id: String
    let namespace: Namespace.ID
    
    func body(content: Content) -> some View {
        content
            .matchedGeometryEffect(id: id, in: namespace, properties: .frame)
    }
}

extension View {
    func hero(id: String, in namespace: Namespace.ID) -> some View {
        self.modifier(HeroAnimationModifier(id: id, namespace: namespace))
    }
}

// MARK: - Parallax Scroll Effect

struct ParallaxScrollModifier: ViewModifier {
    @State private var scrollOffset: CGFloat = 0
    let intensity: CGFloat
    
    init(intensity: CGFloat = 0.5) {
        self.intensity = intensity
    }
    
    func body(content: Content) -> some View {
        content
            .offset(y: scrollOffset * intensity)
            .onAppear {
                // Set up scroll tracking if needed
            }
    }
}

extension View {
    func parallaxScroll(intensity: CGFloat = 0.5) -> some View {
        self.modifier(ParallaxScrollModifier(intensity: intensity))
    }
}