import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityRpcHandler } from "@/infrastructure/messaging/handlers/activity-rpc";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { ActivityLogService } from "@/application/services/activity-log.service";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";

describe("ActivityRpcHandler", () => {
  let handler: ActivityRpcHandler;
  let mockActivityLogService: Partial<ActivityLogService>;
  let context: ServiceContext;

  beforeEach(() => {
    handler = new ActivityRpcHandler();
    mockActivityLogService = {
      getRecent: vi.fn().mockResolvedValue([]),
      filterBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      clearAll: vi.fn().mockResolvedValue(undefined),
    };
    context = {
      activityLog: mockActivityLogService as ActivityLogService,
    } as any;
  });

  it("should handle activity.getRecent", async () => {
    const request = {
      type: "activity.getRecent",
      limit: 5,
      offset: 0,
    };

    const response = await handler.handleRequest(request as any, context);

    expect(mockActivityLogService.getRecent).toHaveBeenCalledWith(5, 0);
    expect(mockActivityLogService.count).toHaveBeenCalled();
    expect(response).toEqual({
      ok: true,
      data: { entries: [], total: 0 },
    });
  });

  it("should handle activity.filterBy", async () => {
    const request = {
      type: "activity.filterBy",
      origin: "https://example.com",
      kind: 1,
      limit: 10,
      offset: 0,
    };

    const response = await handler.handleRequest(request as any, context);

    expect(mockActivityLogService.filterBy).toHaveBeenCalledWith({
      origin: "https://example.com",
      kind: 1,
      limit: 10,
      offset: 0,
    });
    expect(mockActivityLogService.count).toHaveBeenCalledWith({
      origin: "https://example.com",
      kind: 1,
    });
    expect(response).toEqual({
      ok: true,
      data: { entries: [], total: 0 },
    });
  });

  it("should handle activity.clear", async () => {
    const request = {
      type: "activity.clear",
    };

    const response = await handler.handleRequest(request as any, context);

    expect(mockActivityLogService.clearAll).toHaveBeenCalled();
    expect(response).toEqual({
      ok: true,
      data: null,
    });
  });

  it("should return error for unknown method", async () => {
    const request = {
      type: "activity.unknown",
    };

    const response = await handler.handleRequest(request as any, context);

    expect(response).toEqual({
      ok: false,
      error: RPC_ERROR_CODES.UNKNOWN_METHOD,
      details: "activity.unknown",
    });
  });
});
