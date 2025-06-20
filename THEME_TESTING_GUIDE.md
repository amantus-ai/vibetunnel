# Terminal Themes Testing Guide

## Prerequisites
1. Make sure you're running the VibeTunnel web server:
   ```bash
   cd web
   npm run dev
   ```
2. Open your browser and navigate to http://localhost:3033

## Testing Steps

### 1. Visual Inspection of Theme Selector UI

1. **Navigate to a terminal session**
   - From the main page, click on any active session
   - You should see the terminal view with a black header

2. **Locate the gear icon**
   - Look in the upper-left corner of the header
   - You should see a gear icon (⚙) next to the BACK button
   - The gear icon should have a subtle border (#444)
   - Hover over it - it should change to a darker gray background

3. **Open the theme selector**
   - Click the gear icon
   - A dropdown should appear with 4 theme options:
     - VibeTunnel (default)
     - Solarized Dark
     - Dracula
     - Monokai

4. **Check the current theme indicator**
   - The currently active theme should have:
     - A green checkmark (✓) on the left
     - A blue background highlight (#264f78)

### 2. Test Each Theme

Click on each theme and verify the colors:

#### VibeTunnel (Default)
- Background: Dark gray (#1e1e1e)
- Text: Light gray (#d4d4d4)
- Cursor: Bright green (#00ff00)

#### Solarized Dark
- Background: Dark blue (#002b36)
- Text: Blue-gray (#839496)
- Cursor: Blue-gray (#839496)

#### Dracula
- Background: Dark purple-gray (#282a36)
- Text: Almost white (#f8f8f2)
- Cursor: Almost white (#f8f8f2)

#### Monokai
- Background: Dark brown-gray (#272822)
- Text: Almost white (#f8f8f2)
- Cursor: Almost white (#f8f8f2)

### 3. Test Theme Persistence

1. **Select a non-default theme** (e.g., Dracula)
2. **Refresh the page** (F5 or Cmd+R)
3. **Verify** that:
   - The terminal still uses the Dracula theme
   - Opening the gear menu shows Dracula as selected

### 4. Test Multiple Sessions

1. **Open multiple terminal sessions** in different tabs
2. **Change the theme** in one tab
3. **Refresh other tabs** - they should all use the new theme

### 5. Test Error Handling

1. **Open browser DevTools** (F12)
2. **Go to Application > Local Storage**
3. **Fill up localStorage** or make it read-only
4. **Try changing themes** - it should work without errors

## Taking Screenshots

### Manual Screenshots (Recommended)
Use your system's screenshot tool:
- **macOS**: Cmd + Shift + 4 (area screenshot)
- **Windows**: Win + Shift + S
- **Linux**: PrintScreen or screenshot tool

### What to Capture:
1. **Main terminal view** with default theme
2. **Gear icon** (normal and hover state)
3. **Theme dropdown open** showing all options
4. **Each theme applied** to the terminal
5. **Theme persistence** after page reload

### Using the Automated Test Script
If you want to run the automated test:
```bash
# From the vibetunnel directory
node test-themes.js
```

This will create screenshots in `theme-screenshots/` directory.

## Expected Behavior Checklist

- [ ] Gear icon is visible in the upper-left corner
- [ ] Gear icon has hover effect
- [ ] Theme dropdown opens on click
- [ ] Current theme is highlighted with checkmark and background
- [ ] Each theme applies immediately when clicked
- [ ] Theme dropdown closes after selection
- [ ] Theme persists after page refresh
- [ ] No console errors during theme switching
- [ ] Theme applies to all terminal content (text, background, cursor)
- [ ] Works on both desktop and mobile viewports

## Troubleshooting

If themes aren't working:
1. Check browser console for errors
2. Verify localStorage is enabled
3. Make sure you're running the latest code
4. Try clearing localStorage and refreshing