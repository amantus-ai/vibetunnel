### **Feature Specification: Customizable Terminal Themes (Revised)**

**Version:** 1.1

**Date:** June 19, 2024

#### **1. Objective**

To enhance the user experience of the VibeTunnel web terminal by allowing users to select their preferred color scheme from a predefined list of popular themes. The user's theme choice will be saved in their browser for persistence across sessions, and the new UI elements will be seamlessly integrated with the application's existing design.

#### **2. Technical Stack Analysis**

* **Project:** VibeTunnel ([https://github.com/amantus-ai/vibetunnel](https://github.com/amantus-ai/vibetunnel))
* **Frontend Directory:** `/web`
* **Language:** TypeScript
* **Terminal Emulator:** xterm.js
* **Styling:** CSS
* **Entry Point (Anticipated):** HTML is likely located at or near `/web/src/client/assets/index.html` with TypeScript logic in `/web/src/client/`. This will be confirmed during the analysis phase.

#### **3. Functional Requirements**

**3.1. Theme Selection UI**

* A new UI element, a settings gear icon, will be added to the terminal view page in the upper-left corner, near the existing back button.
* Clicking the gear icon will toggle the visibility of a theme selector panel (e.g., a dropdown or a vertical list).
* The UI styling (colors, fonts, spacing) for the icon and selector panel must match the application's existing design language, leveraging established CSS variables where possible.

**3.2. Predefined Themes**

* The feature will launch with four themes:
    * **VibeTunnel (Default)**
    * Solarized Dark
    * Dracula
    * Monokai

**3.3. Theme Application and User Experience**

* Selecting a theme from the list will instantly apply the new color scheme to the active xterm.js instance.
* The theme change will affect the terminal's background, foreground (text), cursor, selection, and the full range of ANSI colors.
* When the theme selector is open, the currently active theme must be visually indicated with both a **checkmark** and a **different background color**.
* After a user selects a new theme, the theme selector panel will hide, leaving only the gear icon visible.
* The selector panel is only hidden via a click on the gear icon or by selecting a theme. It will not be dismissed by clicking outside of it.

**3.4. Persistence and Error Handling**

* The user's selected theme name will be saved to the browser's `localStorage`.
* On page load or refresh, the application will check `localStorage` for a saved theme and apply it automatically.
* If no theme is saved, the default "VibeTunnel" theme will be used.
* In the event that `localStorage` is unavailable or full, the application will gracefully proceed with the default "VibeTunnel" theme without displaying a notification to the user.

#### **4. Implementation Plan & Details**

**Phase 1: Codebase Analysis & Confirmation**

1.  **Analyze Repository:** Thoroughly examine the VibeTunnel GitHub repository to confirm the exact file paths for the main HTML and TypeScript client files.
2.  **Identify Styling Conventions:** Scrutinize the existing CSS files in the `/web` directory to identify established CSS variables, class naming conventions, and the overall design system to ensure the new UI is consistent.
3.  **Source Icon:** Review existing application icons to determine the appropriate style. Select or create a gear icon SVG that visually matches the application's aesthetic.

**Phase 2: Logic and Data Implementation**

1.  **Create Theme Definition File:**
    * Create a new file: `/web/src/themes.ts`.
    * This file will export the theme objects. The key for the default theme will be `"VibeTunnel"` for consistency with its display name.

    ```typescript
    // /web/src/themes.ts
    export interface ITerminalTheme {
      foreground: string;
      background: string;
      // ... other properties
    }

    export const themes: { [key: string]: ITerminalTheme } = {
      VibeTunnel: { /* ...colors */ },
      solarized_dark: { /* ...colors */ },
      dracula: { /* ...colors */ },
      monokai: { /* ...colors */ },
    };
    ```

2.  **Modify Frontend Logic:**
    * Locate the TypeScript file where the `Terminal` object from xterm.js is instantiated.
    * **Import Themes:** Import the `themes` object from `./themes.ts`.
    * **Implement Core Functions:**
        * Create `applyTheme(themeName: string)`: Retrieves the theme object and applies it to the terminal via `term.options.theme`.
        * Create `saveTheme(themeName: string)`: Saves the selected theme name to `localStorage`.
    * **Add Startup Logic:** On application startup (`DOMContentLoaded`), add logic to:
        * Read the theme from `localStorage` within a `try...catch` block to handle potential security or storage errors gracefully.
        * If a theme is found, call `applyTheme()`.
        * If no theme is found or an error occurs, apply the default `"VibeTunnel"` theme.

    ```typescript
    // In the main TypeScript file (e.g., /web/src/client/main.ts)
    import { Terminal } from 'xterm';
    import { themes } from './themes';

    const term = new Terminal({ /* ...options */ });
    term.open(document.getElementById('terminal'));

    function applyTheme(themeName: string) {
      const theme = themes[themeName];
      if (theme) {
        term.options.theme = theme;
        // Logic to update the checkmark/highlight in the UI will also be triggered here.
      }
    }

    function saveTheme(themeName: string) {
      try {
        localStorage.setItem('vibetunnel-theme', themeName);
      } catch (e) {
        console.error('Failed to save theme to localStorage:', e);
      }
    }

    // On Startup
    document.addEventListener('DOMContentLoaded', () => {
      let savedTheme = 'VibeTunnel'; // Default
      try {
        savedTheme = localStorage.getItem('vibetunnel-theme') || 'VibeTunnel';
      } catch (e) {
        console.error('Failed to retrieve theme from localStorage:', e);
      }
      applyTheme(savedTheme);

      // ... rest of the application logic ...
    });
    ```

**Phase 3: UI and UX Implementation**

1.  **Update HTML:**
    * Modify the primary HTML file to include the structure for the settings icon and the theme selector panel.

    ```html
    <div id="settings-container">
      <img src="path/to/your/gear-icon.svg" alt="Settings" id="settings-button" />
      <div id="theme-selector" class="hidden">
        <div data-theme="VibeTunnel" class="theme-option">
          <span class="checkmark">✔</span> VibeTunnel
        </div>
        <div data-theme="solarized_dark" class="theme-option">
          <span class="checkmark"></span> Solarized Dark
        </div>
        </div>
    </div>
    <div id="terminal"></div>
    ```

2.  **Add CSS:**
    * Add styles for `#settings-container`, `#settings-button`, and `#theme-selector`.
    * Use existing CSS variables for colors, fonts, and borders.
    * Create classes for the `.hidden` state, the `.active-theme` highlight (for background color), and to control the visibility of the checkmark.

3.  **Add Event Listeners:**
    * In the main TypeScript file, add a `click` event listener to `#settings-button` to toggle the `.hidden` class on the `#theme-selector`.
    * Add a single `click` event listener to the `#theme-selector` parent element, using event delegation to capture clicks on child elements with a `data-theme` attribute.
    * The listener will:
        * Get the `themeName` from the `data-theme` attribute.
        * Call `applyTheme(themeName)`.
        * Call `saveTheme(themeName)`.
        * Update the UI to move the checkmark and highlight to the newly selected item.
        * Add the `.hidden` class to the selector panel to hide it after selection.

#### **5. Acceptance Criteria**

* [ ] A settings gear icon, visually consistent with the app's style, is visible in the upper-left corner of the terminal page.
* [ ] Clicking the gear icon toggles the visibility of a theme selection list.
* [ ] The theme list shows "VibeTunnel", "Solarized Dark", "Dracula", and "Monokai".
* [ ] The currently active theme in the list is clearly marked with a checkmark and a highlight color.
* [ ] Selecting a theme from the list immediately changes the terminal's color scheme and hides the list.
* [ ] The user's theme selection persists after refreshing the browser page.
* [ ] If no theme has been previously selected or `localStorage` fails, the default "VibeTunnel" theme is applied silently.
* [ ] The implementation follows the existing project style and does not introduce new build dependencies.