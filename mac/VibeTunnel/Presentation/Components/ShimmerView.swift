import SwiftUI

/// A shimmer loading effect view that maintains consistent height
struct ShimmerView: View {
    @State private var isAnimating = false

    let height: CGFloat
    let cornerRadius: CGFloat

    init(height: CGFloat = 20, cornerRadius: CGFloat = 4) {
        self.height = height
        self.cornerRadius = cornerRadius
    }

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color.gray.opacity(0.3),
                        Color.gray.opacity(0.15),
                        Color.gray.opacity(0.3)
                    ]),
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(height: height)
            .mask(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(
                        LinearGradient(
                            gradient: Gradient(colors: [
                                Color.black.opacity(0.3),
                                Color.black,
                                Color.black.opacity(0.3)
                            ]),
                            startPoint: isAnimating ? .leading : .trailing,
                            endPoint: isAnimating ? .trailing : .leading
                        )
                    )
                    .animation(
                        Animation.linear(duration: 1.5)
                            .repeatForever(autoreverses: false),
                        value: isAnimating
                    )
            )
            .onAppear {
                isAnimating = true
            }
    }
}

/// A text-sized shimmer that matches the height of text
struct TextShimmer: View {
    let text: String
    let font: Font

    @State private var textHeight: CGFloat = 20

    var body: some View {
        ZStack {
            // Hidden text to measure height
            Text(text)
                .font(font)
                .opacity(0)
                .background(
                    GeometryReader { geometry in
                        Color.clear
                            .preference(key: HeightPreferenceKey.self, value: geometry.size.height)
                    }
                )
                .onPreferenceChange(HeightPreferenceKey.self) { height in
                    textHeight = height
                }

            ShimmerView(height: textHeight, cornerRadius: 4)
        }
    }
}

private struct HeightPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

#Preview {
    VStack(spacing: 20) {
        ShimmerView()
            .frame(width: 200)

        TextShimmer(text: "Loading...", font: .body)
            .frame(width: 100)
    }
    .padding()
}
