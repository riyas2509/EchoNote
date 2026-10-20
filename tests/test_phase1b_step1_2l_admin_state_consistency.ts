/**
 * tests/test_phase1b_step1_2l_admin_state_consistency.ts
 *
 * EchoNote Phase 1B Step 1.2L: Platform-Admin Account Status & Consistency Regression Tests
 *
 * Validates backend middleware and helper alignment with Firestore Rules:
 * - requireAdmin(db)
 * - syncUserCustomClaims(uid, db)
 * - resolveProjectAccess(db, user, projectId)
 *
 * Verifies that:
 * 1. Legitimate active platform admins (including those with omitted default fields) are safely granted access.
 * 2. Closed platform admin accounts (accountStatus: 'closed') are rejected.
 * 3. Disabled platform admin accounts (disabled: true) are rejected.
 * 4. Stale token claims (user demoted to role: 'user' in db) cannot bypass authorization.
 * 5. Deleted user records (no doc in /users/{uid}) cannot bypass authorization.
 */

import {
  requireAdmin,
  syncUserCustomClaims,
  resolveProjectAccess,
  AuthenticatedRequest
} from "../middleware/auth.js";
import { Response } from "express";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function check(testId: string, description: string, condition: boolean, extra?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS [${testId}]: ${description}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL [${testId}]: ${description}${extra ? ` (${extra})` : ''}`);
  }
}

class MockDocSnapshot {
  constructor(public id: string, private _data: any) {}
  get exists(): boolean {
    return this._data !== undefined && this._data !== null;
  }
  data(): any {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined;
  }
}

class MockDocReference {
  constructor(private db: MockFirestore, public path: string, public id: string) {}

  async get(): Promise<MockDocSnapshot> {
    const data = this.db.store.get(this.path);
    return new MockDocSnapshot(this.id, data);
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    if (options?.merge) {
      const existing = this.db.store.get(this.path) || {};
      this.db.store.set(this.path, { ...existing, ...JSON.parse(JSON.stringify(data)) });
    } else {
      this.db.store.set(this.path, JSON.parse(JSON.stringify(data)));
    }
  }

  collection(subPath: string) {
    return new MockCollectionReference(this.db, `${this.path}/${subPath}`);
  }
}

class MockQuerySnapshot {
  constructor(public docs: MockDocSnapshot[]) {}
  get empty(): boolean {
    return this.docs.length === 0;
  }
}

class MockQuery {
  constructor(
    private db: MockFirestore,
    private collectionPath: string,
    private filters: Array<{ field: string; op: string; val: any }>
  ) {}

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionPath, [...this.filters, { field, op, val }]);
  }

  limit(_n: number) {
    return this;
  }

  async get(): Promise<MockQuerySnapshot> {
    const prefix = `${this.collectionPath}/`;
    const matchedDocs: MockDocSnapshot[] = [];

    for (const [key, data] of this.db.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const remainder = key.slice(prefix.length);
      if (remainder.includes("/")) continue;

      let matches = true;
      for (const filter of this.filters) {
        const actual = data[filter.field];
        if (filter.op === "==" && actual !== filter.val) {
          matches = false;
          break;
        }
      }

      if (matches) {
        matchedDocs.push(new MockDocSnapshot(remainder, data));
      }
    }

    return new MockQuerySnapshot(matchedDocs);
  }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, public path: string) {}

  doc(id: string): MockDocReference {
    return new MockDocReference(this.db, `${this.path}/${id}`, id);
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.path, [{ field, op, val }]);
  }
}

class MockFirestore {
  public store = new Map<string, any>();

  collection(name: string): MockCollectionReference {
    return new MockCollectionReference(this, name);
  }

  doc(fullPath: string): MockDocReference {
    const parts = fullPath.split("/");
    const id = parts[parts.length - 1];
    return new MockDocReference(this, fullPath, id);
  }
}

function createMockResponse(): {
  res: Response;
  getStatus: () => number | undefined;
  getBody: () => any;
} {
  let statusCode: number | undefined;
  let responseBody: any;

  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: any) {
      responseBody = body;
      return res;
    }
  };

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => responseBody
  };
}

async function runTests() {
  console.log("================================================================================");
  console.log("🛡️  ECHONOTE PHASE 1B STEP 1.2L: ADMIN-STATE CONSISTENCY REGRESSION SUITE");
  console.log("================================================================================\n");

  const db = new MockFirestore();

  // Seed baseline users
  db.store.set("users/usr-legit-default", {
    email: "legit@echonote.com",
    role: "admin"
    // accountStatus and disabled are omitted (defaults: active, not disabled)
  });

  db.store.set("users/usr-legit-explicit", {
    email: "explicit@echonote.com",
    role: "admin",
    accountStatus: "active",
    disabled: false
  });

  db.store.set("users/usr-closed-admin", {
    email: "closed@echonote.com",
    role: "admin",
    accountStatus: "closed"
  });

  db.store.set("users/usr-disabled-admin", {
    email: "disabled@echonote.com",
    role: "admin",
    disabled: true
  });

  db.store.set("users/usr-revoked-admin", {
    email: "revoked@echonote.com",
    role: "user"
  });

  // Seed a sample project for resolveProjectAccess
  db.store.set("projects/proj-alpha", {
    name: "Project Alpha",
    organizationId: "org-alpha",
    userId: "usr-creator"
  });

  console.log("--- Section 1: requireAdmin(db) Middleware ---");

  const adminMiddleware = requireAdmin(db as any);

  // 1.1: Legitimate active admin with omitted status fields
  {
    let nextCalled = false;
    const req: any = { user: { uid: "usr-legit-default", email: "legit@echonote.com" } };
    const { res, getStatus } = createMockResponse();

    await adminMiddleware(req, res, () => { nextCalled = true; });
    check("1.1", "Active platform admin with omitted default fields is allowed (next called)", nextCalled && getStatus() === undefined);
  }

  // 1.2: Legitimate active admin with explicit active fields
  {
    let nextCalled = false;
    const req: any = { user: { uid: "usr-legit-explicit", email: "explicit@echonote.com" } };
    const { res, getStatus } = createMockResponse();

    await adminMiddleware(req, res, () => { nextCalled = true; });
    check("1.2", "Active platform admin with explicit fields is allowed (next called)", nextCalled && getStatus() === undefined);
  }

  // 1.3: Closed admin (accountStatus: 'closed')
  {
    let nextCalled = false;
    const req: any = { user: { uid: "usr-closed-admin", role: "admin", email: "closed@echonote.com" } };
    const { res, getStatus } = createMockResponse();

    await adminMiddleware(req, res, () => { nextCalled = true; });
    check("1.3", "Closed admin (accountStatus: 'closed') is rejected with 403 Forbidden", !nextCalled && getStatus() === 403);
  }

  // 1.4: Disabled admin (disabled: true)
  {
    let nextCalled = false;
    const req: any = { user: { uid: "usr-disabled-admin", role: "admin", email: "disabled@echonote.com" } };
    const { res, getStatus } = createMockResponse();

    await adminMiddleware(req, res, () => { nextCalled = true; });
    check("1.4", "Disabled admin (disabled: true) is rejected with 403 Forbidden", !nextCalled && getStatus() === 403);
  }

  // 1.5: Revoked admin (doc has role: 'user', token claims role: 'admin')
  {
    let nextCalled = false;
    const req: any = { user: { uid: "usr-revoked-admin", role: "admin", email: "revoked@echonote.com" } };
    const { res, getStatus } = createMockResponse();

    await adminMiddleware(req, res, () => { nextCalled = true; });
    check("1.5", "Revoked admin with stale token claim is rejected with 403 Forbidden", !nextCalled && getStatus() === 403);
  }

  // 1.6: Deleted admin doc (no /users/{uid} document)
  {
    let nextCalled = false;
    const req: any = { user: { uid: "usr-non-existent", role: "admin", email: "deleted@echonote.com" } };
    const { res, getStatus } = createMockResponse();

    await adminMiddleware(req, res, () => { nextCalled = true; });
    check("1.6", "Deleted admin doc is rejected with 403 Forbidden", !nextCalled && getStatus() === 403);
  }

  console.log("\n--- Section 2: syncUserCustomClaims ---");

  // 2.1: Active admin receives platform role 'admin'
  {
    const claims = await syncUserCustomClaims("usr-legit-default", db as any);
    check("2.1", "Active admin receives platformRole: 'admin' custom claim", claims.role === "admin");
  }

  // 2.2: Closed admin does NOT receive platform role 'admin'
  {
    const claims = await syncUserCustomClaims("usr-closed-admin", db as any);
    check("2.2", "Closed admin does NOT receive platformRole: 'admin'", claims.role !== "admin");
  }

  // 2.3: Disabled admin does NOT receive platform role 'admin'
  {
    const claims = await syncUserCustomClaims("usr-disabled-admin", db as any);
    check("2.3", "Disabled admin does NOT receive platformRole: 'admin'", claims.role !== "admin");
  }

  // 2.4: Revoked user doc does NOT receive platform role 'admin'
  {
    const claims = await syncUserCustomClaims("usr-revoked-admin", db as any);
    check("2.4", "Revoked user does NOT receive platformRole: 'admin'", claims.role !== "admin");
  }

  console.log("\n--- Section 3: resolveProjectAccess Platform Override ---");

  // 3.1: Active admin receives platform administrator operational override
  {
    const resolution = await resolveProjectAccess(db as any, {
      uid: "usr-legit-default",
      role: "admin",
      email: "legit@echonote.com"
    }, "proj-alpha");
    check("3.1", "Active admin receives platform override in resolveProjectAccess", resolution.isPlatformAdmin === true && resolution.hasAccess === true);
  }

  // 3.2: Closed admin claiming admin in token is denied platform override
  {
    const resolution = await resolveProjectAccess(db as any, {
      uid: "usr-closed-admin",
      role: "admin",
      email: "closed@echonote.com"
    }, "proj-alpha");
    check("3.2", "Closed admin is denied platform override in resolveProjectAccess", resolution.isPlatformAdmin === false);
  }

  // 3.3: Disabled admin claiming admin in token is denied platform override
  {
    const resolution = await resolveProjectAccess(db as any, {
      uid: "usr-disabled-admin",
      role: "admin",
      email: "disabled@echonote.com"
    }, "proj-alpha");
    check("3.3", "Disabled admin is denied platform override in resolveProjectAccess", resolution.isPlatformAdmin === false);
  }

  // 3.4: Revoked user claiming admin in token is denied platform override
  {
    const resolution = await resolveProjectAccess(db as any, {
      uid: "usr-revoked-admin",
      role: "admin",
      email: "revoked@echonote.com"
    }, "proj-alpha");
    check("3.4", "Revoked user with stale claim is denied platform override in resolveProjectAccess", resolution.isPlatformAdmin === false);
  }

  console.log("\n================================================================================");
  console.log(`📊 STEP 1.2L SUITE SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
