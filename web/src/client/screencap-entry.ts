// Install crypto polyfill first - must be before any code that uses crypto.randomUUID()
import './utils/crypto-polyfill.js';

// Screencap frontend entry point
import './components/screencap-view.js';

// Initialize any global screencap functionality if needed
console.log('🖥️ VibeTunnel Screen Capture loaded');
