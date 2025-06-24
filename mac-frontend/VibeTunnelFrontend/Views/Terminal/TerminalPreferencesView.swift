import SwiftUI

struct TerminalPreferencesView: View {
    @Binding var preferences: TerminalPreferences
    let onSave: () -> Void
    
    @State private var customColumns = ""
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Terminal Preferences")
                .font(.headline)
            
            // Font Size
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Font Size")
                    Spacer()
                    Text("\(Int(preferences.fontSize))pt")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                
                HStack(spacing: 12) {
                    Button {
                        preferences.adjustFontSize(delta: -1)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                    .disabled(preferences.fontSize <= TerminalPreferences.minFontSize)
                    
                    Slider(value: $preferences.fontSize, 
                           in: TerminalPreferences.minFontSize...TerminalPreferences.maxFontSize,
                           step: 1)
                    
                    Button {
                        preferences.adjustFontSize(delta: 1)
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .buttonStyle(.plain)
                    .disabled(preferences.fontSize >= TerminalPreferences.maxFontSize)
                }
            }
            
            Divider()
            
            // Column Width
            VStack(alignment: .leading, spacing: 12) {
                Toggle("Fit to column width", isOn: $preferences.fitHorizontally)
                    .onChange(of: preferences.fitHorizontally) { _, enabled in
                        if enabled && preferences.maxColumns == 0 {
                            preferences.maxColumns = 80
                        }
                    }
                
                if preferences.fitHorizontally {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Maximum Columns")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        
                        // Preset buttons
                        HStack(spacing: 8) {
                            ForEach(TerminalPreferences.columnPresets, id: \.self) { preset in
                                Button("\(preset)") {
                                    preferences.maxColumns = preset
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .tint(preferences.maxColumns == preset ? .accentColor : nil)
                            }
                        }
                        
                        // Custom input
                        HStack {
                            TextField("Custom", text: $customColumns)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 80)
                                .onSubmit {
                                    if let cols = Int(customColumns), cols > 0 && cols <= 500 {
                                        preferences.maxColumns = cols
                                    }
                                    customColumns = ""
                                }
                            
                            Text("Current: \(preferences.maxColumns)")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.leading)
                }
            }
            
            Divider()
            
            // Action buttons
            HStack {
                Button("Reset") {
                    preferences = TerminalPreferences()
                }
                .buttonStyle(.bordered)
                
                Spacer()
                
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
                
                Button("Apply") {
                    onSave()
                    dismiss()
                }
                .keyboardShortcut(.return)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 400)
        .background(Theme.Colors.secondaryBackground)
    }
}

#Preview {
    @Previewable @State var preferences = TerminalPreferences()
    return TerminalPreferencesView(preferences: $preferences) {
        print("Saved")
    }
}