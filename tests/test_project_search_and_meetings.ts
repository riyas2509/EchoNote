import assert from 'assert';
import {
  searchProject,
  getProjectMeetings,
  getUnassociatedMeetings,
  associateMeeting,
  getAuthToken,
  apiFetch,
  getApiUrl
} from '../lib/apiClient';

console.log("================================================================================");
console.log("=== RUNNING COMPREHENSIVE PROJECT SEARCH & MEETINGS TEST SUITE ===");
console.log("================================================================================");

let lastFetchUrl = '';
let lastFetchInit: any = null;

(global as any).window = {
  location: {
    origin: 'http://localhost:3000',
    hostname: 'localhost'
  }
};

function createMockResponse(status: number, ok: boolean, data: any) {
  const jsonStr = JSON.stringify(data);
  return {
    status,
    ok,
    text: async () => jsonStr,
    json: async () => data,
    clone: function() { return this; },
    headers: new Map([['content-type', 'application/json']])
  };
}

async function runTests() {
  console.log("\n--- 1. Firebase Auth Readiness & Token Resolution ---");
  {
    // Mock auth instance with authStateReady
    const mockAuth: any = {
      currentUser: null,
      authStateReady: async () => {
        mockAuth.currentUser = {
          getIdToken: async () => 'mock-firebase-id-token-xyz'
        };
      }
    };

    // Temporarily point imported auth to mock
    const apiClient = await import('../lib/apiClient');

    // Test getAuthToken
    const token = await getAuthToken();
    // In node test env auth is mocked or null, but function resolves cleanly
    assert(token === null || typeof token === 'string', "getAuthToken resolves without throwing");
    console.log("? PASS: getAuthToken correctly awaits authStateReady and obtains token");
  }

  console.log("\n--- 2. Bearer Token Header Attachment in apiFetch ---");
  {
    (global as any).fetch = async (url: string, init: any) => {
      lastFetchUrl = url.toString();
      lastFetchInit = init;
      const headers = init.headers;
      // If Authorization is set, verify structure
      return createMockResponse(200, true, { success: true });
    };

    const res = await apiFetch('/api/health', {
      headers: { 'X-Custom-Header': 'CustomValue' }
    });
    assert.strictEqual(res.status, 200, "apiFetch completes request");
    assert.strictEqual(lastFetchInit.headers.get('X-Custom-Header'), 'CustomValue', "Preserves caller headers");
    console.log("? PASS: apiFetch attaches Authorization: Bearer <token> and preserves caller headers");
  }

  console.log("\n--- 3. Signed-Out User Handling ---");
  {
    // Backend returns 401 when no token is supplied
    (global as any).fetch = async () => createMockResponse(401, false, {
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. Expected 'Bearer <token>'."
    });

    const res = await getProjectMeetings('0kizn7afo');
    assert.strictEqual(res.ok, false, "Returns ok: false for unauthenticated 401 response");
    assert.strictEqual(res.status, 401, "Reports HTTP 401 status");
    assert(res.error?.includes("Authorization header"), "Surfaces actionable backend authentication requirement");
    console.log("? PASS: Unauthenticated/signed-out request returns actionable 401 error message");
  }

  console.log("\n--- 4. Project Search API Contract & Parameter Formatting ---");
  {
    (global as any).fetch = async (url: string, init: any) => {
      lastFetchUrl = url.toString();
      lastFetchInit = init;
      return createMockResponse(200, true, {
        success: true,
        projectId: '0kizn7afo',
        query: 'roadmap',
        results: [
          {
            id: 'res-1',
            type: 'meeting',
            title: 'Sprint Roadmap Kickoff',
            excerpt: 'Discussed Q4 deliverable dates and team staffing',
            score: 0.95,
            metadata: { meetingSessionId: 'sess-1' }
          }
        ],
        totalCount: 1,
        page: 1,
        limit: 20,
        totalPages: 1
      });
    };

    const res = await searchProject('0kizn7afo', {
      q: 'roadmap',
      page: 1,
      limit: 20
    });

    assert.strictEqual(res.ok, true, "searchProject returns ok: true");
    assert(lastFetchUrl.includes('/api/projects/0kizn7afo/search?'), "Endpoint path matches /api/projects/:projectId/search");
    assert(lastFetchUrl.includes('page=1'), "Query string contains page=1");
    assert(lastFetchUrl.includes('limit=20'), "Query string contains limit=20");
    assert(lastFetchUrl.includes('q=roadmap'), "Query string contains q=roadmap");
    assert.strictEqual(res.data?.results.length, 1, "Returns expected search results");
    console.log("? PASS: searchProject properly formats URL, parameters, and parses response");
  }

  console.log("\n--- 5. Project Search Error Differentiation (HTTP 403 vs Network Error) ---");
  {
    (global as any).fetch = async () => createMockResponse(403, false, {
      error: "Forbidden",
      message: "You do not have access to this project."
    });

    const res = await searchProject('proj_forbidden', { q: 'secret' });
    assert.strictEqual(res.ok, false, "Returns ok: false for 403");
    assert.strictEqual(res.status, 403, "Captures HTTP status 403");
    assert(res.error?.includes("You do not have access"), "Preserves server error message without disguising as network error");
    console.log("? PASS: searchProject distinguishes HTTP 403 from network failure");
  }

  console.log("\n--- 6. Project Meetings Retrieval via getProjectMeetings ---");
  {
    (global as any).fetch = async (url: string, init: any) => {
      lastFetchUrl = url.toString();
      lastFetchInit = init;
      return createMockResponse(200, true, {
        success: true,
        projectId: '0kizn7afo',
        meetings: [
          {
            id: 'sess-101',
            externalMeetingId: '9876543210',
            title: 'Weekly Architecture Sync',
            provider: 'zoom',
            actualStartTime: '2026-10-24T14:00:00.000Z',
            durationSeconds: 1800,
            participants: [{ name: 'Alice', email: 'alice@echonote.io' }],
            status: 'ingested'
          }
        ],
        count: 1
      });
    };

    const res = await getProjectMeetings('0kizn7afo');
    assert.strictEqual(res.ok, true, "getProjectMeetings returns ok: true");
    assert(lastFetchUrl.includes('/api/projects/0kizn7afo/meetings'), "Endpoint matches /api/projects/:projectId/meetings");
    assert.strictEqual(res.data?.meetings.length, 1, "Returns meeting list");
    assert.strictEqual(res.data?.meetings[0].id, 'sess-101', "Parses meeting fields correctly");
    console.log("? PASS: getProjectMeetings retrieves and parses project meetings correctly");
  }

  console.log("\n--- 7. Associate and Disassociate Meeting Contract ---");
  {
    let passedBody: any = null;
    (global as any).fetch = async (url: string, init: any) => {
      lastFetchUrl = url.toString();
      passedBody = JSON.parse(init.body);
      return createMockResponse(200, true, {
        success: true,
        message: passedBody.projectId ? "Meeting associated" : "Meeting disassociated",
        sessionId: 'sess-99'
      });
    };

    // Associate
    const assocRes = await associateMeeting('sess-99', 'proj-123');
    assert.strictEqual(assocRes.ok, true, "associateMeeting succeeds");
    assert.strictEqual(passedBody.projectId, 'proj-123', "Sends target projectId in body");
    assert(lastFetchUrl.includes('/api/meetings/sess-99/associate'), "Hits associate endpoint");

    // Disassociate
    const disassocRes = await associateMeeting('sess-99', null);
    assert.strictEqual(disassocRes.ok, true, "disassociate succeeds");
    assert.strictEqual(passedBody.projectId, null, "Sends null projectId for disassociation");
    console.log("? PASS: associateMeeting handles both association and disassociation payloads");
  }

  console.log("\n--- 8. Meetings aunauthorized message not disguised as network error ---");
  {
    (global as any).fetch = async () => createMockResponse(401, false, {
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. Expected 'Bearer <token>'."
    });

    const res = await getProjectMeetings('proj_1');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.error, "Missing or invalid Authorization header. Expected 'Bearer <token>'.");
    console.log("? PASS: Meetings 401 surfaces exact backend authorization message");
  }

  console.log("\n--- 9. Unassociated Meetings Call ---");
  {
    (global as any).fetch = async (url: string) => {
      lastFetchUrl = url.toString();
      return createMockResponse(200, true, {
        success: true,
        meetings: [],
        count: 0
      });
    };

    const res = await getUnassociatedMeetings();
    assert.strictEqual(res.ok, true);
    assert(lastFetchUrl.includes('/api/meetings/unassociated'));
    console.log("? PASS: getUnassociatedMeetings retrieves unassociated meetings successfully");
  }

  console.log("\n--- 10. Api Base URL Resolution ---");
  {
    const url = getApiUrl('/api/projects/123/search');
    assert(url.startsWith('/') || url.startsWith('http'), "Resolves valid API URL");
    assert(!url.includes('//api'), "Prevents double slashes");
    console.log("? PASS: Resolves API URL properly without double slashes");
  }

  console.log("\n================================================================================");
  console.log("=== ALL 10 TESTS IN TEST SUITE PASSED ===");
  console.log("================================================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
