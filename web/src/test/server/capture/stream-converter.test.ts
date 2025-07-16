import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  convertToMediaStream,
  WebRTCMediaStream,
  WebRTCMediaStreamTrack,
} from '../../../server/capture/stream-converter.js';
import type { CaptureStream } from '../../../server/capture/types.js';
import { createLogger } from '../../../server/utils/logger.js';

vi.mock('../../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('StreamConverter', () => {
  let mockLogger: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    vi.mocked(createLogger).mockReturnValue(mockLogger);
  });

  describe('WebRTCMediaStreamTrack', () => {
    it('should create a video track with correct properties', () => {
      const track = new WebRTCMediaStreamTrack('video', 'track-123');

      expect(track.kind).toBe('video');
      expect(track.id).toBe('track-123');
      expect(track.label).toBe('Server Video Track');
      expect(track.enabled).toBe(true);
      expect(track.muted).toBe(false);
      expect(track.readyState).toBe('live');
    });

    it('should create an audio track with correct properties', () => {
      const track = new WebRTCMediaStreamTrack('audio', 'track-456');

      expect(track.kind).toBe('audio');
      expect(track.label).toBe('Server Audio Track');
    });

    it('should handle stop() method', () => {
      const track = new WebRTCMediaStreamTrack('video', 'track-123');

      track.stop();

      expect(track.readyState).toBe('ended');
      expect(track.enabled).toBe(false);
    });

    it('should handle clone() method', () => {
      const track = new WebRTCMediaStreamTrack('video', 'track-123');
      track.enabled = false;

      const cloned = track.clone();

      expect(cloned).not.toBe(track);
      expect(cloned.kind).toBe(track.kind);
      expect(cloned.id).not.toBe(track.id); // New ID
      expect(cloned.enabled).toBe(track.enabled);
      expect(cloned.readyState).toBe('live'); // Reset to live
    });

    it('should emit ended event when stopped', () => {
      const track = new WebRTCMediaStreamTrack('video', 'track-123');
      const endedHandler = vi.fn();

      track.addEventListener('ended', endedHandler);
      track.stop();

      expect(endedHandler).toHaveBeenCalled();
    });
  });

  describe('WebRTCMediaStream', () => {
    it('should create a stream with ID', () => {
      const stream = new WebRTCMediaStream('stream-123');

      expect(stream.id).toBe('stream-123');
      expect(stream.active).toBe(true);
    });

    it('should add and retrieve tracks', () => {
      const stream = new WebRTCMediaStream();
      const videoTrack = new WebRTCMediaStreamTrack('video', 'video-123');
      const audioTrack = new WebRTCMediaStreamTrack('audio', 'audio-123');

      stream.addTrack(videoTrack);
      stream.addTrack(audioTrack);

      expect(stream.getTracks()).toHaveLength(2);
      expect(stream.getVideoTracks()).toHaveLength(1);
      expect(stream.getAudioTracks()).toHaveLength(1);
      expect(stream.getTrackById('video-123')).toBe(videoTrack);
    });

    it('should remove tracks', () => {
      const stream = new WebRTCMediaStream();
      const track = new WebRTCMediaStreamTrack('video', 'video-123');

      stream.addTrack(track);
      stream.removeTrack(track);

      expect(stream.getTracks()).toHaveLength(0);
    });

    it('should become inactive when all tracks end', () => {
      const stream = new WebRTCMediaStream();
      const track1 = new WebRTCMediaStreamTrack('video', 'video-123');
      const track2 = new WebRTCMediaStreamTrack('audio', 'audio-123');

      stream.addTrack(track1);
      stream.addTrack(track2);

      track1.stop();
      expect(stream.active).toBe(true); // Still has active track

      track2.stop();
      expect(stream.active).toBe(false); // All tracks ended
    });

    it('should stop all tracks when stream stops', () => {
      const stream = new WebRTCMediaStream();
      const track1 = new WebRTCMediaStreamTrack('video', 'video-123');
      const track2 = new WebRTCMediaStreamTrack('audio', 'audio-123');

      stream.addTrack(track1);
      stream.addTrack(track2);

      stream.stop();

      expect(track1.readyState).toBe('ended');
      expect(track2.readyState).toBe('ended');
      expect(stream.active).toBe(false);
    });

    it('should clone stream with all tracks', () => {
      const stream = new WebRTCMediaStream('original');
      const track = new WebRTCMediaStreamTrack('video', 'video-123');
      stream.addTrack(track);

      const cloned = stream.clone();

      expect(cloned).not.toBe(stream);
      expect(cloned.id).not.toBe(stream.id);
      expect(cloned.getTracks()).toHaveLength(1);
      expect(cloned.getTracks()[0]).not.toBe(track); // Track is cloned
    });
  });

  describe('convertToMediaStream', () => {
    let mockCaptureStream: CaptureStream;
    let mockReadable: Readable;

    beforeEach(() => {
      mockReadable = new Readable({
        read() {
          // Emit some test data
          this.push(Buffer.from('test video data'));
        },
      });

      mockCaptureStream = {
        stream: mockReadable,
        process: { pid: 12345 } as any,
        stop: vi.fn().mockResolvedValue(undefined),
      };
    });

    it('should convert capture stream to media stream', async () => {
      const result = await convertToMediaStream(mockCaptureStream, {
        width: 1920,
        height: 1080,
        fps: 30,
      });

      expect(result.stream).toBeInstanceOf(WebRTCMediaStream);
      expect(result.stream.getVideoTracks()).toHaveLength(1);

      const videoTrack = result.stream.getVideoTracks()[0];
      expect(videoTrack.kind).toBe('video');
    });

    it('should handle capture stream data', async () => {
      const result = await convertToMediaStream(mockCaptureStream, {});

      // Simulate data from capture stream
      const dataHandler = vi.fn();
      result.stream.on('data', dataHandler);

      mockReadable.emit('data', Buffer.from('frame data'));

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Processing video frame')
      );
    });

    it('should stop media stream when capture stream stops', async () => {
      const result = await convertToMediaStream(mockCaptureStream, {});

      result.stop();

      expect(mockCaptureStream.stop).toHaveBeenCalled();
      expect(result.stream.active).toBe(false);
    });

    it('should handle errors from capture stream', async () => {
      const result = await convertToMediaStream(mockCaptureStream, {});
      const errorHandler = vi.fn();

      result.stream.on('error', errorHandler);

      // Emit error from readable stream
      const testError = new Error('Stream error');
      mockReadable.emit('error', testError);

      expect(mockLogger.error).toHaveBeenCalledWith('Stream processing error:', testError);
    });

    it('should create unique track IDs', async () => {
      const result1 = await convertToMediaStream(mockCaptureStream, {});
      const result2 = await convertToMediaStream(mockCaptureStream, {});

      const track1 = result1.stream.getVideoTracks()[0];
      const track2 = result2.stream.getVideoTracks()[0];

      expect(track1.id).not.toBe(track2.id);
    });
  });

  describe('generateTrackId', () => {
    it('should generate valid track IDs', () => {
      // Access through a converted stream since it's a private function
      const mockStream: CaptureStream = {
        stream: new Readable({ read() {} }),
        process: { pid: 12345 } as any,
        stop: vi.fn(),
      };

      const result1 = convertToMediaStream(mockStream, {});
      const result2 = convertToMediaStream(mockStream, {});

      // Track IDs should be unique
      const track1 = result1.stream.getVideoTracks()[0];
      const track2 = result2.stream.getVideoTracks()[0];

      expect(track1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(track1.id).not.toBe(track2.id);
    });
  });
});
