import assert from 'assert';
import {
  completeReasoningMeeting
} from '../lib/apiClient';
import type {
  CompleteReasoningMeetingRequest,
  CompleteReasoningMeetingResponse
} from '../types';

let mockFetchCalls: Array<{ url: string; init: any }> = [];
let mockResponseToReturn: any = null;

(global as any).window = {
  location: {
    origin: 'http://localhost:3000',
    hostname: 'localhost'
  }
};

(global as any).fetch = async (url: string, init: any) => {
  mockFetchCalls.push({ url, init });
  return mockResponseToReturn;
};

function makeMockResponse(status: number, ok: boolean, body: any) {
  const jsonStr = JSON.stringify(body);
  return {
    status,
    ok,
    text: async () => jsonStr,
    json: async () => body,
    clone: function() { return this; },
    headers: new Map([['content-type', 'application/json']])
  };
}

async function runTests() {
  console.log('--- 1. Verification of HTTP Method, URL Encoding, and Payload Delivery ---');
  {
    mockFetchCalls = [];
    const testMeetingId = 'meeting/with special&chars=123';
    const payload: CompleteReasoningMeetingRequest = {
      rootCause: 'Underestimated dependencies and external blocker',
      agreedDueDate: '2026-11-20',
      agreedStartDate: '2026-11-10',
      scheduleVersionToken: 'test-version-token-abc-123',
      autoPropagateDownstream: true,
      resolveExceptionIds: ['exc-1', 'exc-2']
    };

    const mockResponsePayload: CompleteReasoningMeetingResponse = {
      success: true,
      message: 'Reasoning meeting completed and task schedule updated.',
      meeting: {
        id: testMeetingId,
        projectId: 'proj_1',
        title: 'Reasoning Meeting',
                purpose: 'Reasoning',
        reason: 'Overdue',
        generatedAgenda: 'Agenda',
        timezone: 'UTC',
        provider: 'none',
        createdBy: 'user_1',
        creatorName: 'User 1',
        creatorEmail: 'u1@ex.com',
        history: [],
        status: 'completed',
                relatedTaskIds: ['task_1'],
        relatedExceptionIds: [],
        proposedParticipants: [],
        proposedStartTime: '2026-11-05T10:00:00Z',
        proposedEndTime: '2026-11-05T11:00:00Z',
                createdAt: '2026-10-26T00:00:00Z',
        updatedAt: '2026-10-26T00:00:00Z',
        completedAt: '2026-10-26T00:00:00Z',
        /* completedBy */
      },
      reasoningOutcome: {
        rootCause: payload.rootCause,
        agreedDueDate: payload.agreedDueDate,
        agreedStartDate: payload.agreedStartDate,
                autoPropagateDownstream: true,
        propagationPerformed: true,
        propagationSummary: { targetTaskId: 'task_1', updatedTaskCount: 1, updatedTasks: [], notificationsCreated: 1 },
                resolvedExceptionIds: ['exc-1', 'exc-2'],
        completedAt: '2026-10-26T00:00:00Z',
        completedBy: { uid: 'user_1', name: 'User 1', email: 'user1@example.com' }
      }
    };

    mockResponseToReturn = makeMockResponse(200, true, mockResponsePayload);

    const result = await completeReasoningMeeting(testMeetingId, payload);

    assert.strictEqual(mockFetchCalls.length, 1, 'Exactly one fetch call was made');
    const call = mockFetchCalls[0];
    assert.strictEqual(call.init.method, 'POST', 'HTTP method is POST');
    assert(
      call.url.includes('/api/follow-ups/meeting%2Fwith%20special%26chars%3D123/complete-reasoning'),
      'URL properly encoded meetingId'
    );
    assert.deepStrictEqual(JSON.parse(call.init.body), payload, 'Payload passed accurately in body');
    assert.strictEqual(result.success, true, 'Returns parsed success response');
    assert.strictEqual(result.reasoningOutcome.rootCause, payload.rootCause, 'Response outcome verified');
    console.log('Passed: Method is POST, URL encoded, payload delivered.');
  }

  console.log('--- 2. Preservation of HTTP 409 STALE_VERSION and Structured Conflict Error ---');
  {
    mockFetchCalls = [];
    const testMeetingId = 'meeting_409';
    const payload: CompleteReasoningMeetingRequest = {
      rootCause: 'Schedule changed concurrently',
      agreedDueDate: '2026-11-20',
      scheduleVersionToken: 'stale-token',
      autoPropagateDownstream: true
    };

    const staleResponseData = {
      success: false,
      code: 'STALE_VERSION',
      error: 'Schedule version conflict: The schedule has been modified since it was last loaded.',
      currentScheduleVersionToken: 'fresh-new-token-456'
    };

    mockResponseToReturn = makeMockResponse(409, false, staleResponseData);

    try {
      await completeReasoningMeeting(testMeetingId, payload);
      assert.fail('Should have thrown an error on 409');
    } catch (err: any) {
      assert.strictEqual(err.status, 409, 'Error preserves HTTP status 409');
      assert.strictEqual(err.code, 'STALE_VERSION', 'Error preserves error code');
      assert.strictEqual(
        err.data?.currentScheduleVersionToken,
        'fresh-new-token-456',
        'Preserves currentScheduleVersionToken for UI recovery'
      );
      assert(err.message.includes('Schedule version conflict'), 'Error message is descriptive');
      console.log('Passed: 409 STALE_VERSION preserved with structured data & token.');
    }
  }

  console.log('--- 3. Preservation of HTTP 400 Validation Error ---');
  {
    mockFetchCalls = [];
    mockResponseToReturn = makeMockResponse(400, false, {
      success: false,
      code: 'INVALID_ROOT_CAUSE',
      error: 'Root cause explanation is required and must not exceed 3000 characters.'
    });

    try {
      await completeReasoningMeeting('meeting_400', {
        rootCause: '',
        agreedDueDate: '2026-11-20',
        scheduleVersionToken: 'token',
        autoPropagateDownstream: false
      });
      assert.fail('Should have thrown an error on 400');
    } catch (err: any) {
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.code, 'INVALID_ROOT_CAUSE');
      console.log('Passed: 400 Validation error preserved.');
    }
  }

  console.log('--- 4. Preservation of HTTP 403 Forbidden Error ---');
  {
    mockFetchCalls = [];
    mockResponseToReturn = makeMockResponse(403, false, {
      success: false,
      code: 'FORBIDDEN',
      error: 'Insufficient permissions to complete reasoning meeting.'
    });

    try {
      await completeReasoningMeeting('meeting_403', {
        rootCause: 'test',
        agreedDueDate: '2026-11-20',
        scheduleVersionToken: 'token',
        autoPropagateDownstream: false
      });
      assert.fail('Should have thrown an error on 403');
    } catch (err: any) {
      assert.strictEqual(err.status, 403);
      assert.strictEqual(err.code, 'FORBIDDEN');
      console.log('Passed: 403 Forbidden error preserved.');
    }
  }

  console.log('--- 5. Preservation of HTTP 413 Transaction Write Limit Exceeded ---');
  {
    mockFetchCalls = [];
    mockResponseToReturn = makeMockResponse(413, false, {
      success: false,
      code: 'TRANSACTION_LIMIT_EXCEEDED',
      error: 'Propagation graph exceeds maximum transactional write operations.'
    });

    try {
      await completeReasoningMeeting('meeting_413', {
        rootCause: 'Huge graph',
        agreedDueDate: '2026-11-20',
        scheduleVersionToken: 'token',
        autoPropagateDownstream: true
      });
      assert.fail('Should have thrown an error on 413');
    } catch (err: any) {
      assert.strictEqual(err.status, 413);
      assert.strictEqual(err.code, 'TRANSACTION_LIMIT_EXCEEDED');
      console.log('Passed: 413 Write limit exceeded error preserved.');
    }
  }

  console.log('\nAll 5 API Client verification tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});