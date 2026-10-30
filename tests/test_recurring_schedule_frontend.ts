import assert from 'assert';
import {
  listRecurringSchedules,
  createRecurringSchedule,
  updateRecurringSchedule,
  deleteRecurringSchedule,
  getRecurringScheduleHistory
} from '../lib/apiClient';
import type {
  GetRecurringScheduleHistoryResponse,
  RecurringScheduleOccurrenceHistoryItem
} from '../lib/apiClient';
import type {
  CreateRecurringScheduleRequest,
  RecurringSchedule
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
  if (mockResponseToReturn instanceof Error) {
    throw mockResponseToReturn;
  }
  const res = mockResponseToReturn || { ok: true, status: 200, json: async () => ({}) };
  const data = typeof res.json === 'function' ? await res.json() : (res.data || {});
  const dataStr = JSON.stringify(data);
  return {
    ok: res.ok !== undefined ? res.ok : true,
    status: res.status || 200,
    headers: {
      get: (h: string) => 'application/json'
    },
    text: async () => dataStr,
    json: async () => data
  };
};

function resetMocks() {
  mockFetchCalls = [];
  mockResponseToReturn = null;
}

async function runTests() {
  console.log('--- Running Frontend Recurring Schedule & History Client Tests ---');

  // Test 1: listRecurringSchedules
  {
    resetMocks();
    const dummySchedules: RecurringSchedule[] = [
      {
        id: 'rec-1',
        projectId: 'proj-1',
        organizationId: null,
        title: 'Weekly Leadership Sync',
        schedule: {
          frequency: 'weekly',
          timeOfDay: '09:00',
          timeZone: 'Asia/Kolkata',
          dayOfWeek: 1,
          anchorDate: '2026-10-26'
        },
        reportType: 'management_review',
        formats: ['pptx', 'xlsx'],
        coverage: { scope: 'rolling_7_days' },
        delivery: {
          recipients: ['lead@example.com'],
          notifyOnFailure: true
        },
        active: true,
        nextRunAt: '2026-11-02T03:30:00.000Z',
        createdAt: '2026-10-26T00:00:00.000Z',
        updatedAt: '2026-10-26T00:00:00.000Z',
        createdBy: { uid: 'user-1', email: 'lead@example.com', name: 'Lead' }
      }
    ];

    mockResponseToReturn = {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        schedules: dummySchedules,
        total: 1
      })
    };

    const res = await listRecurringSchedules('proj-1');
    assert.strictEqual(mockFetchCalls.length, 1);
    assert.strictEqual(mockFetchCalls[0].url, '/api/projects/proj-1/recurring-schedules');
    assert.strictEqual(res.schedules.length, 1);
    assert.strictEqual(res.schedules[0].id, 'rec-1');
    assert.strictEqual(res.schedules[0].active, true);
    console.log('✓ Test 1 Passed: listRecurringSchedules returns schedules and uses project route');
  }

  // Test 2: createRecurringSchedule with full payload
  {
    resetMocks();
    const createReq: CreateRecurringScheduleRequest = {
      title: 'Biweekly Engineering Report',
      description: 'Sprint alignment status',
      schedule: {
        frequency: 'biweekly',
        timeOfDay: '17:00',
        timeZone: 'America/New_York',
        dayOfWeek: 5,
        anchorDate: '2026-10-23'
      },
      reportType: 'project_status',
      formats: ['pptx'],
      coverage: {
        scope: 'custom_window',
        windowDays: 14
      },
      delivery: {
        recipients: ['eng@example.com'],
        notifyOnFailure: true
      },
      meetingAutomation: {
        enabled: true,
        meetingDurationMinutes: 30
      }
    };

    mockResponseToReturn = {
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        schedule: {
          id: 'rec-2',
          projectId: 'proj-1',
          ...createReq,
          active: true,
          nextRunAt: '2026-11-06T22:00:00.000Z',
          createdAt: '2026-10-26T00:00:00.000Z',
          updatedAt: '2026-10-26T00:00:00.000Z',
          createdBy: { uid: 'user-1', email: 'lead@example.com', name: 'Lead' }
        }
      })
    };

    const res = await createRecurringSchedule('proj-1', createReq);
    assert.strictEqual(mockFetchCalls.length, 1);
    assert.strictEqual(mockFetchCalls[0].url, '/api/projects/proj-1/recurring-schedules');
    assert.strictEqual(mockFetchCalls[0].init.method, 'POST');
    const parsedBody = JSON.parse(mockFetchCalls[0].init.body);
    assert.strictEqual(parsedBody.title, 'Biweekly Engineering Report');
    assert.strictEqual(parsedBody.schedule.frequency, 'biweekly');
    assert.strictEqual(res.schedule.id, 'rec-2');
    console.log('✓ Test 2 Passed: createRecurringSchedule posts payload correctly and returns created schedule');
  }

  // Test 3: updateRecurringSchedule for Pause/Resume
  {
    resetMocks();
    mockResponseToReturn = {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        schedule: {
          id: 'rec-1',
          projectId: 'proj-1',
          title: 'Weekly Leadership Sync',
          active: false,
          nextRunAt: '2026-11-02T03:30:00.000Z'
        }
      })
    };

    const res = await updateRecurringSchedule('proj-1', 'rec-1', { active: false });
    assert.strictEqual(mockFetchCalls.length, 1);
    assert.strictEqual(mockFetchCalls[0].url, '/api/projects/proj-1/recurring-schedules/rec-1');
    assert.strictEqual(mockFetchCalls[0].init.method, 'PATCH');
    const parsedBody = JSON.parse(mockFetchCalls[0].init.body);
    assert.strictEqual(parsedBody.active, false);
    assert.strictEqual(res.schedule.active, false);
    console.log('✓ Test 3 Passed: updateRecurringSchedule sends PATCH with active state and updates schedule');
  }

  // Test 4: deleteRecurringSchedule
  {
    resetMocks();
    mockResponseToReturn = {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        message: 'Recurring schedule deleted successfully',
        deletedScheduleId: 'rec-1'
      })
    };

    const res = await deleteRecurringSchedule('proj-1', 'rec-1');
    assert.strictEqual(mockFetchCalls.length, 1);
    assert.strictEqual(mockFetchCalls[0].url, '/api/projects/proj-1/recurring-schedules/rec-1');
    assert.strictEqual(mockFetchCalls[0].init.method, 'DELETE');
    assert.strictEqual(res.success, true);
    console.log('✓ Test 4 Passed: deleteRecurringSchedule issues DELETE and receives success');
  }

  // Test 5: getRecurringScheduleHistory (Read-only execution & delivery history)
  {
    resetMocks();
    const dummyHistory: GetRecurringScheduleHistoryResponse = {
      scheduleId: 'rec-1',
      occurrences: [
        {
          id: 'occ-1',
          scheduleId: 'rec-1',
          projectId: 'proj-1',
          organizationId: null,
          scheduledFor: '2026-10-26T09:00:00.000Z',
          status: 'succeeded',
          retryCount: 0,
          completedAt: '2026-10-26T09:00:15.000Z',
          artifacts: [
            {
              id: 'art-1',
              format: 'pptx',
              storagePath: 'reports/proj-1/art-1.pptx',
              fileSizeBytes: 154200,
              downloadUrl: '/api/reports/artifacts/art-1/download?token=signed-hmac-token'
            }
          ],
          deliveries: [
            {
              id: 'del-1',
              notificationType: 'report_ready',
              recipientEmail: 'caller@example.com',
              status: 'sent',
              attempts: 1,
              maxAttempts: 3,
              sentAt: '2026-10-26T09:00:16.000Z',
              createdAt: '2026-10-26T09:00:15.000Z'
            },
            {
              id: 'del-2',
              notificationType: 'report_ready',
              recipientEmail: 't***m@external.com',
              status: 'permanent_failure',
              attempts: 3,
              maxAttempts: 3,
              lastError: 'SMTP relay connection timeout',
              createdAt: '2026-10-26T09:00:15.000Z'
            }
          ]
        }
      ]
    };

    mockResponseToReturn = {
      ok: true,
      status: 200,
      json: async () => dummyHistory
    };

    const res = await getRecurringScheduleHistory('proj-1', 'rec-1');
    assert.strictEqual(mockFetchCalls.length, 1);
    assert.strictEqual(mockFetchCalls[0].url, '/api/projects/proj-1/recurring-schedules/rec-1/history');
    assert.strictEqual(res.scheduleId, 'rec-1');
    assert.strictEqual(res.occurrences.length, 1);

    // Check occurrence details
    const occItem = res.occurrences[0];
    assert.strictEqual(occItem.id, 'occ-1');
    assert.strictEqual(occItem.status, 'succeeded');
    assert.strictEqual(occItem.artifacts[0].downloadUrl?.includes('signed-hmac-token'), true);

    // Check delivery separation & privacy
    assert.strictEqual(occItem.deliveries.length, 2);
    assert.strictEqual(occItem.deliveries[0].status, 'sent');
    assert.strictEqual(occItem.deliveries[1].status, 'permanent_failure');
    assert.strictEqual(occItem.deliveries[1].recipientEmail, 't***m@external.com'); // Masked privacy verification
    assert.strictEqual(occItem.deliveries[1].lastError, 'SMTP relay connection timeout');
    console.log('✓ Test 5 Passed: getRecurringScheduleHistory returns occurrences, signed download links, and separate masked deliveries');
  }

  // Test 6: Backend validation error handling & propagation
  {
    resetMocks();
    mockResponseToReturn = {
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Invalid recurrence parameters: anchorDate is required for biweekly frequency',
        field: 'anchorDate'
      })
    };

    let threw = false;
    try {
      await createRecurringSchedule('proj-1', {
        title: 'Invalid',
        schedule: {
          frequency: 'biweekly',
          timeOfDay: '10:00',
          timeZone: 'UTC',
          dayOfWeek: 1,
          anchorDate: ''
        },
        reportType: 'meeting_summary',
        formats: ['pptx'],
        coverage: { scope: 'all_time' },
        delivery: { recipients: [] }
      });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.message.includes('Invalid recurrence parameters'), true);
    }
    assert.strictEqual(threw, true);
    console.log('✓ Test 6 Passed: Backend validation error is surfaced correctly to caller');
  }

  console.log('--- ALL FRONTEND RECURRING SCHEDULE & HISTORY TESTS PASSED ---');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
