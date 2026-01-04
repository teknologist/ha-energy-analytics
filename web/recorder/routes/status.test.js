import { describe, it, expect, beforeEach, vi } from 'vitest';
import statusRoutes from './status.js';

describe('Recorder Status Routes', () => {
  let mockFastify;

  beforeEach(() => {
    mockFastify = {
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      recorder: {
        getState: vi.fn(),
        triggerBackfill: vi.fn(),
        reseedDatabase: vi.fn(),
      },
      get: vi.fn(),
      post: vi.fn(),
    };
  });

  describe('plugin registration', () => {
    it('should export a function', () => {
      expect(typeof statusRoutes).toBe('function');
    });

    it('should register GET /status route', async () => {
      await statusRoutes(mockFastify);

      expect(mockFastify.get).toHaveBeenCalledWith(
        '/status',
        expect.objectContaining({
          schema: expect.any(Object),
          handler: expect.any(Function),
        })
      );
    });

    it('should register POST /backfill/trigger route', async () => {
      await statusRoutes(mockFastify);

      expect(mockFastify.post).toHaveBeenCalledWith(
        '/backfill/trigger',
        expect.objectContaining({
          schema: expect.any(Object),
          handler: expect.any(Function),
        })
      );
    });

    it('should register POST /reseed route', async () => {
      await statusRoutes(mockFastify);

      expect(mockFastify.post).toHaveBeenCalledWith(
        '/reseed',
        expect.objectContaining({
          schema: expect.any(Object),
          handler: expect.any(Function),
        })
      );
    });
  });

  describe('GET /status handler', () => {
    let handler;

    beforeEach(async () => {
      await statusRoutes(mockFastify);
      handler = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/status'
      )[1].handler;
    });

    it('should return recorder state', async () => {
      const mockState = {
        isRunning: true,
        lastEventAt: new Date('2024-01-01T12:00:00Z'),
        entityCount: 5,
        eventCount: 100,
        errorCount: 2,
      };
      mockFastify.recorder.getState.mockReturnValue(mockState);

      const mockReply = {
        send: vi.fn(),
      };

      await handler({}, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        data: {
          status: 'running',
          isRunning: true,
          lastEventAt: '2024-01-01T12:00:00.000Z',
          entityCount: 5,
          eventCount: 100,
          errorCount: 2,
        },
      });
    });

    it('should return stopped status when not running', async () => {
      const mockState = {
        isRunning: false,
        lastEventAt: null,
        entityCount: 0,
        eventCount: 0,
        errorCount: 0,
      };
      mockFastify.recorder.getState.mockReturnValue(mockState);

      const mockReply = {
        send: vi.fn(),
      };

      await handler({}, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        data: {
          status: 'stopped',
          isRunning: false,
          lastEventAt: null,
          entityCount: 0,
          eventCount: 0,
          errorCount: 0,
        },
      });
    });

    it('should handle errors gracefully', async () => {
      mockFastify.recorder.getState.mockImplementation(() => {
        throw new Error('State error');
      });

      const mockReply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
      };

      await handler({}, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'State error',
      });
    });

    it('should log error on failure', async () => {
      mockFastify.recorder.getState.mockImplementation(() => {
        throw new Error('Test error');
      });

      const mockReply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
      };

      await handler({}, mockReply);

      expect(mockFastify.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to get recorder status'
      );
    });
  });

  describe('POST /backfill/trigger handler', () => {
    let handler;

    beforeEach(async () => {
      await statusRoutes(mockFastify);
      handler = mockFastify.post.mock.calls.find(
        (call) => call[0] === '/backfill/trigger'
      )[1].handler;
    });

    it('should trigger backfill and return success', async () => {
      const mockReply = {
        send: vi.fn(),
      };

      mockFastify.recorder.triggerBackfill.mockResolvedValue(undefined);

      await handler({}, mockReply);

      expect(mockFastify.recorder.triggerBackfill).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        message: 'Backfill triggered successfully',
      });
    });

    it('should handle backfill errors gracefully', async () => {
      const mockReply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
      };

      mockFastify.recorder.triggerBackfill.mockRejectedValue(
        new Error('Backfill failed')
      );

      await handler({}, mockReply);

      // The function catches errors internally and logs them
      expect(mockFastify.log.error).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        message: 'Backfill triggered successfully',
      });
    });

    it('should log error when backfill fails', async () => {
      const mockReply = {
        send: vi.fn(),
      };

      mockFastify.recorder.triggerBackfill.mockRejectedValue(
        new Error('Test error')
      );

      await handler({}, mockReply);

      expect(mockFastify.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Backfill failed'
      );
    });

    it('should handle synchronous errors in handler', async () => {
      const mockReply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
      };

      // Make triggerBackfill throw synchronously (not in a promise)
      mockFastify.recorder.triggerBackfill = vi.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      await handler({}, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Sync error',
      });
    });
  });

  describe('POST /reseed handler', () => {
    let handler;

    beforeEach(async () => {
      await statusRoutes(mockFastify);
      handler = mockFastify.post.mock.calls.find(
        (call) => call[0] === '/reseed'
      )[1].handler;
    });

    it('should trigger reseeding and return success', async () => {
      const mockReply = {
        send: vi.fn(),
      };

      mockFastify.recorder.reseedDatabase.mockResolvedValue(undefined);

      await handler({}, mockReply);

      expect(mockFastify.recorder.reseedDatabase).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        message: 'Database reseeding triggered successfully',
      });
    });

    it('should handle reseeding errors gracefully', async () => {
      const mockReply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
      };

      mockFastify.recorder.reseedDatabase.mockRejectedValue(
        new Error('Reseed failed')
      );

      await handler({}, mockReply);

      // The function catches errors internally and logs them
      expect(mockFastify.log.error).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        message: 'Database reseeding triggered successfully',
      });
    });

    it('should log error when reseeding fails', async () => {
      const mockReply = {
        send: vi.fn(),
      };

      mockFastify.recorder.reseedDatabase.mockRejectedValue(
        new Error('Test error')
      );

      await handler({}, mockReply);

      expect(mockFastify.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Reseeding failed'
      );
    });

    it('should handle synchronous errors in handler', async () => {
      const mockReply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
      };

      // Make reseedDatabase throw synchronously (not in a promise)
      mockFastify.recorder.reseedDatabase = vi.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      await handler({}, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Sync error',
      });
    });
  });
});
