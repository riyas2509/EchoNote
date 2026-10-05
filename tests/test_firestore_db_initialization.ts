import { db, getAdminFirestore, FIRESTORE_DATABASE_ID, firebaseConfig } from "../lib/firebaseAdmin.ts";
import { getDb as getAiTrackerDb } from "../lib/aiTracker.ts";
import fs from "fs";
import path from "path";

async function runTest() {
  console.log("=======================================================");
  console.log("🔒 REGRESSION TEST: FIRESTORE DB INITIALIZATION CONSISTENCY");
  console.log("=======================================================");

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name} ->`, err?.message || err);
      failed++;
    }
  }

  const EXPECTED_NAMED_DB = "ai-studio-eb588566-0d1e-4ef9-bca0-1194fd2bb6d5";

  // 1. Canonical DB properties
  test("Canonical FIRESTORE_DATABASE_ID is the named database", () => {
    if (FIRESTORE_DATABASE_ID !== EXPECTED_NAMED_DB) {
      throw new Error(`Expected ${EXPECTED_NAMED_DB}, got ${FIRESTORE_DATABASE_ID}`);
    }
  });

  test("Canonical db instance has correct databaseId property", () => {
    const dbInstance = getAdminFirestore();
    if ((dbInstance as any).databaseId !== EXPECTED_NAMED_DB) {
      throw new Error(`Expected db.databaseId to be ${EXPECTED_NAMED_DB}, got ${(dbInstance as any).databaseId}`);
    }
  });

  test("Canonical db instance is NOT (default)", () => {
    const dbInstance = getAdminFirestore();
    if ((dbInstance as any).databaseId === "(default)") {
      throw new Error(`Database instance unexpectedly targeted (default) database!`);
    }
  });

  test("Exported db matches getAdminFirestore() singleton", () => {
    const dbInstance = getAdminFirestore();
    if (db !== dbInstance) {
      throw new Error(`Exported db is not identical to getAdminFirestore() singleton`);
    }
  });

  // 2. AI Tracker DB
  test("AI Tracker getDb() returns canonical named database", () => {
    const aiDb = getAiTrackerDb();
    if (!aiDb) {
      throw new Error("getAiTrackerDb() returned null");
    }
    if ((aiDb as any).databaseId !== EXPECTED_NAMED_DB) {
      throw new Error(`Expected aiDb.databaseId to be ${EXPECTED_NAMED_DB}, got ${(aiDb as any).databaseId}`);
    }
  });

  // 3. Static audit across backend files for forbidden default database initialization
  const filesToCheck = [
    "server.ts",
    "middleware/auth.ts",
    "lib/aiTracker.ts",
    "functions/index.ts",
    "scripts/init-db.ts"
  ];

  for (const file of filesToCheck) {
    test(`Zero occurrences of admin.firestore() in ${file}`, () => {
      const filePath = path.join(process.cwd(), file);
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, "utf-8");
      // Check for admin.firestore() invocations (ignoring type annotations like admin.firestore.Firestore)
      const matches = content.match(/admin\.firestore\(\)/g);
      if (matches && matches.length > 0) {
        throw new Error(`Found ${matches.length} call(s) to admin.firestore() in ${file}`);
      }
    });
  }

  // 4. Check that middleware/auth.ts imports canonical getAdminFirestore
  test("middleware/auth.ts imports getAdminFirestore from lib/firebaseAdmin", () => {
    const authContent = fs.readFileSync(path.join(process.cwd(), "middleware/auth.ts"), "utf-8");
    if (!authContent.includes("getAdminFirestore") || !authContent.includes("lib/firebaseAdmin")) {
      throw new Error("middleware/auth.ts does not import getAdminFirestore from lib/firebaseAdmin");
    }
  });

  // 5. Check collection accessibility on the named database instance
  test("Target collection references are constructed on named database", () => {
    const collections = [
      "projects",
      "projectMembers",
      "recordings",
      "subscriptions",
      "transactions",
      "orders",
      "users",
      "organizations",
      "orgMembers",
      "invitations",
      "comments",
      "tasks",
      "auditLogs"
    ];

    for (const col of collections) {
      const colRef = db.collection(col);
      if (!colRef || !colRef.id) {
        throw new Error(`Failed to create collection reference for ${col}`);
      }
      if ((colRef.firestore as any).databaseId !== EXPECTED_NAMED_DB) {
        throw new Error(`Collection ${col} firestore databaseId is not ${EXPECTED_NAMED_DB}`);
      }
    }
  });

  console.log("=======================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=======================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTest().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
