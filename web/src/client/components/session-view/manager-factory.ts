/**
 * Manager Factory for Session View
 *
 * Handles creation and dependency injection of all managers
 * to reduce coupling and improve testability
 */

import type { Session } from '../../../shared/types.js';
import type { SessionView } from '../session-view.js';
import { ConnectionManager } from './connection-manager.js';
import { DirectKeyboardManager } from './direct-keyboard-manager.js';
import { InputManager } from './input-manager.js';
import { LifecycleEventManager } from './lifecycle-event-manager.js';
import { LoadingAnimationManager } from './loading-animation-manager.js';
import { MobileInputManager } from './mobile-input-manager.js';
import { TerminalLifecycleManager } from './terminal-lifecycle-manager.js';

export interface ManagerInstances {
  connectionManager: ConnectionManager;
  inputManager: InputManager;
  mobileInputManager: MobileInputManager;
  directKeyboardManager: DirectKeyboardManager;
  terminalLifecycleManager: TerminalLifecycleManager;
  lifecycleEventManager: LifecycleEventManager;
  loadingAnimationManager: LoadingAnimationManager;
}

/**
 * Creates and wires up all managers for a SessionView instance
 */
export function createManagers(sessionView: SessionView): ManagerInstances {
  // Create all manager instances
  const managers: ManagerInstances = {
    connectionManager: new ConnectionManager(
      (sessionId: string) => {
        // Handle session exit
        if (sessionView.session && sessionId === sessionView.session.id) {
          sessionView.session = { ...sessionView.session, status: 'exited' };
          sessionView.requestUpdate();
        }
      },
      (session: Session) => {
        // Handle session update
        sessionView.session = session;
        sessionView.requestUpdate();
      }
    ),
    inputManager: new InputManager(),
    mobileInputManager: new MobileInputManager(sessionView),
    directKeyboardManager: new DirectKeyboardManager(
      `session-view-${Math.random().toString(36).substr(2, 9)}`
    ),
    terminalLifecycleManager: new TerminalLifecycleManager(),
    lifecycleEventManager: new LifecycleEventManager(),
    loadingAnimationManager: new LoadingAnimationManager(),
  };

  // Wire up dependencies
  wireDependencies(managers, sessionView);

  return managers;
}

/**
 * Wires up all the dependencies between managers
 */
function wireDependencies(managers: ManagerInstances, sessionView: SessionView): void {
  const {
    connectionManager,
    inputManager,
    mobileInputManager,
    directKeyboardManager,
    terminalLifecycleManager,
    lifecycleEventManager,
  } = managers;

  // Set up input manager
  inputManager.setCallbacks({
    requestUpdate: () => sessionView.requestUpdate(),
  });

  // Set up mobile input manager
  mobileInputManager.setInputManager(inputManager);

  // Set up direct keyboard manager
  directKeyboardManager.setInputManager(inputManager);
  directKeyboardManager.setSessionViewElement(sessionView);

  // Set up terminal lifecycle manager
  terminalLifecycleManager.setConnectionManager(connectionManager);
  terminalLifecycleManager.setInputManager(inputManager);
  terminalLifecycleManager.setConnected(true);
  terminalLifecycleManager.setDomElement(sessionView);

  // Set up lifecycle event manager
  lifecycleEventManager.setSessionViewElement(sessionView);

  // Wire up event listeners between managers using the event emitter pattern
  setupEventListeners(managers, sessionView);
}

/**
 * Sets up event listeners between managers using the event emitter pattern
 */
function setupEventListeners(managers: ManagerInstances, sessionView: SessionView): void {
  const { lifecycleEventManager } = managers;

  // Listen for state changes
  lifecycleEventManager.on('state-change', (event) => {
    const { property, value } = event.detail;
    // Handle state changes
    // Use a type assertion through unknown for dynamic property access
    // This is safe because we're checking that the property exists first
    if (property in sessionView) {
      (sessionView as unknown as Record<string, unknown>)[property] = value;
    }
    sessionView.requestUpdate();
  });

  // Listen for navigation events
  lifecycleEventManager.on('navigation', (event) => {
    const { action, data } = event.detail;
    if (action === 'back') {
      sessionView.handleBack();
    } else if (action === 'keyboard-input' && data) {
      sessionView.handleKeyboardInput(data as KeyboardEvent);
    }
  });

  // Listen for UI update requests
  lifecycleEventManager.on('ui-update', () => {
    sessionView.requestUpdate();
  });

  // Listen for loading state changes
  lifecycleEventManager.on('loading-change', (event) => {
    const { loading } = event.detail;
    if (loading) {
      managers.loadingAnimationManager.startLoading(() => sessionView.requestUpdate());
    } else {
      managers.loadingAnimationManager.stopLoading();
    }
  });
}

/**
 * Cleans up all managers
 */
export function cleanupManagers(managers: ManagerInstances): void {
  // Clean up in reverse order of creation
  managers.lifecycleEventManager.cleanup();
  managers.terminalLifecycleManager.cleanup();
  managers.directKeyboardManager.cleanup();
  managers.mobileInputManager.cleanup();
  managers.inputManager.cleanup();
  managers.connectionManager.cleanupStreamConnection();
  managers.loadingAnimationManager.cleanup();
}
