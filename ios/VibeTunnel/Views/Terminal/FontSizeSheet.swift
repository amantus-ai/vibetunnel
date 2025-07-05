import SwiftUI

/// Sheet for adjusting terminal font size.
///
/// Provides a selection of font sizes with live preview
/// of how the terminal text will appear.
struct FontSizeSheet: View {
    @Binding var fontSize: CGFloat
    @Environment(\.dismiss)
    var dismiss

    let fontSizes: [CGFloat] = [10, 12, 14, 16, 18, 20, 22, 24, 28, 32]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Font size preview
                VStack(spacing: Theme.Spacing.large) {
                    Text("Font Size Preview")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                    Text("VibeTunnel:~ $ echo 'Hello, World!'")
                        .font(Theme.Typography.terminal(size: fontSize))
                        .foregroundColor(Theme.Colors.terminalForeground)
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Theme.Colors.terminalBackground)
                        .cornerRadius(Theme.CornerRadius.medium)
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                .stroke(Theme.Colors.cardBorder, lineWidth: 1)
                        )
                }
                .padding()

                // Font size slider
                VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                    HStack {
                        Text("Size: \(Int(fontSize))pt")
                            .font(.headline)
                            .foregroundColor(Theme.Colors.terminalForeground)

                        Spacer()

                        Button("Reset") {
                            withAnimation(Theme.Animation.quick) {
                                fontSize = 14
                            }
                            HapticFeedback.impact(.light)
                        }
                        .font(.caption)
                        .foregroundColor(Theme.Colors.primaryAccent)
                    }

                    Slider(value: $fontSize, in: 10...32, step: 1) { _ in
                        HapticFeedback.selection()
                    }
                    .accentColor(Theme.Colors.primaryAccent)
                }
                .padding()

                Divider()
                    .background(Theme.Colors.cardBorder)

                // Quick selection grid
                VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                    Text("Quick Selection")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible()), count: 5),
                        spacing: Theme.Spacing.small
                    ) {
                        ForEach(fontSizes, id: \.self) { size in
                            Button(action: {
                                fontSize = size
                                HapticFeedback.impact(.light)
                            }, label: {
                                Text("\(Int(size))")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(fontSize == size ? Theme.Colors.terminalBackground : Theme.Colors
                                        .terminalForeground
                                    )
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, Theme.Spacing.small)
                                    .background(
                                        RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                            .fill(fontSize == size ? Theme.Colors.primaryAccent : Theme.Colors
                                                .cardBorder.opacity(0.3)
                                            )
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                            .stroke(
                                                fontSize == size ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder,
                                                lineWidth: 1
                                            )
                                    )
                            })
                            .buttonStyle(PlainButtonStyle())
                            .scaleEffect(fontSize == size ? 0.95 : 1.0)
                            .animation(Theme.Animation.quick, value: fontSize == size)
                        }
                    }
                }
                .padding()

                Spacer()
            }
            .background(Theme.Colors.cardBackground)
            .navigationTitle("Font Size")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
    }
}
