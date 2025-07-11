import { useCallback, useEffect, useState } from 'react';
import { createLogger } from '../../utils/logger';
import { Modal } from './Modal';

const logger = createLogger('Settings');

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UserSettings {
  theme: 'dark' | 'light';
  fontSize: number;
  fontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  scrollback: number;
  bellStyle: 'none' | 'visual' | 'sound' | 'both';
  tabStopWidth: number;
}

const defaultSettings: UserSettings = {
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 1000,
  bellStyle: 'visual',
  tabStopWidth: 8,
};

export function Settings({ isOpen, onClose }: SettingsProps) {
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [isSaving, setIsSaving] = useState(false);

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        if (response.ok) {
          const data = await response.json();
          setSettings({ ...defaultSettings, ...data });
        }
      } catch (err) {
        logger.error('Failed to load settings:', err);
      }
    };

    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      logger.log('Settings saved successfully');
      onClose();
    } catch (err) {
      logger.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  }, [settings, onClose]);

  const handleChange = (key: keyof UserSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="lg">
      <div className="space-y-6">
        {/* Theme */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Theme</label>
          <select
            value={settings.theme}
            onChange={(e) => handleChange('theme', e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        {/* Font Size */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Font Size: {settings.fontSize}px
          </label>
          <input
            type="range"
            min="10"
            max="24"
            value={settings.fontSize}
            onChange={(e) => handleChange('fontSize', parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Font Family */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Font Family</label>
          <input
            type="text"
            value={settings.fontFamily}
            onChange={(e) => handleChange('fontFamily', e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Cursor Style */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Cursor Style</label>
          <select
            value={settings.cursorStyle}
            onChange={(e) => handleChange('cursorStyle', e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="block">Block</option>
            <option value="underline">Underline</option>
            <option value="bar">Bar</option>
          </select>
        </div>

        {/* Cursor Blink */}
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-300">Cursor Blink</label>
          <input
            type="checkbox"
            checked={settings.cursorBlink}
            onChange={(e) => handleChange('cursorBlink', e.target.checked)}
            className="w-4 h-4 text-indigo-600 bg-gray-800 border-gray-600 rounded focus:ring-indigo-500"
          />
        </div>

        {/* Scrollback */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Scrollback Lines: {settings.scrollback}
          </label>
          <input
            type="range"
            min="100"
            max="10000"
            step="100"
            value={settings.scrollback}
            onChange={(e) => handleChange('scrollback', parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Bell Style */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Bell Style</label>
          <select
            value={settings.bellStyle}
            onChange={(e) => handleChange('bellStyle', e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="none">None</option>
            <option value="visual">Visual</option>
            <option value="sound">Sound</option>
            <option value="both">Both</option>
          </select>
        </div>

        {/* Tab Stop Width */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Tab Width: {settings.tabStopWidth}
          </label>
          <input
            type="range"
            min="2"
            max="8"
            value={settings.tabStopWidth}
            onChange={(e) => handleChange('tabStopWidth', parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </Modal>
  );
}