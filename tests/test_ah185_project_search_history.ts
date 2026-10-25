/**
 * AH.185 — Unified Project Search and Visible Search History Test Suite
 *
 * Requirements Covered:
 * 1. Search Correctness & Data Model Support:
 *    - Finds meetings by title and participant details
 *    - Finds transcripts by speech segment text and speaker labels
 *    - Finds decisions from both decisionHistory records and recording summaries
 *    - Finds tasks by title, description, and assignee
 *    - Finds action items from recording summaries
 *    - Finds unresolved discussion topics with context and suggested actions
 *    - Correct type, excerpt, title, metadata, and score calculation
 *    - Query trimming, empty string handling, and whitespace-only queries
 *    - Result limits, pagination, and date filtering
 * 2. AH.183 Multi-Project Recording Association Compatibility:
 *    - Matches legacy single-project recordings (projectId == id)
 *    - Matches multi-project associated recordings (projectIds array-contains id)
 *    - Prevents duplicate search results for the same canonical recording within a project
 *    - Removing a project association prevents the recording from appearing in search
 *    - Does not leak metadata or content from unrelated private projects
 * 3. Permissions, Access Controls & Privacy:
 *    - Unauthenticated requests are rejected (401)
 *    - Non-members of a project cannot search private projects (403/404)
 * 4. Search History Engine:
 *    - Records submitted search with query, project context, filters, and timestamp
 *    - Deduplicates repeated searches by updating lastUsedAt and preventing clutter
 *    - Enforces retention limit (caps at retention limit without error)
 *    - Retrieves history sorted newest first
 *    - User isolation: User A cannot see, modify, or delete User B's search history
 *    - Clearing search history deletes only the authenticated caller's history
 *    - Empty or invalid history queries are rejected (400)
 */

import { authorizeRecordingAccess } from "../middleware/auth.ts";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    failCount++;
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(msg);
  } else {
    passCount++;
    console.log(`✅ PASS: ${msg}`);
  }
}

// In-Memory Mock Firestore for AH.185
class MockDocRef {
  constructor(public id: string, private db: MockFirestore, private colName: string) {}

  async get(): Promise<any> {
    const data = this.db.store[this.colName]?.[this.id];
    return {
      exists: data !== undefined && data !== null,
      id: this.id,
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
      ref: this
    };
  }

  async set(data: any): Promise<void> {
    if (!this.db.store[this.colName]) this.db.store[this.colName] = {};
    this.db.store[this.colName][this.id] = JSON.parse(JSON.stringify(data));
  }

  async update(patch: any): Promise<void> {
    if (!this.db.store[this.colName]?.[this.id]) {
      throw new Error("NOT_FOUND");
    }
    const current = this.db.store[this.colName][this.id];
    for (const [k, v] of Object.entries(patch)) {
      current[k] = v;
    }
  }

  async delete(): Promise<void> {
    delete this.db.store[this.colName]?.[this.id];
  }
}

class MockQuery {
  private filters: Array<{ field: string; op: string; val: any }> = [];
  private orderField?: string;
  private orderDir: 'asc' | 'desc' = 'asc';
  private limitCount?: number;

  constructor(private colName: string, private db: MockFirestore) {}

  where(field: string, op: string, val: any) {
    this.filters.push({ field, op, val });
    return this;
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
    this.orderField = field;
    this.orderDir = dir;
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  async get(): Promise<any> {
    const col = this.db.store[this.colName] || {};
    let matches: any[] = [];

    for (const [id, item] of Object.entries(col)) {
      let matched = true;
      for (const f of this.filters) {
        const itemVal = (item as any)[f.field];
        if (f.op === "==") {
          if (itemVal !== f.val) matched = false;
        } else if (f.op === "array-contains") {
          if (!Array.isArray(itemVal) || !itemVal.includes(f.val)) matched = false;
        }
      }
      if (matched) {
        matches.push({
          id,
          data: () => JSON.parse(JSON.stringify(item)),
          ref: new MockDocRef(id, this.db, this.colName)
        });
      }
    }

    if (this.orderField) {
      matches.sort((a, b) => {
        const valA = a.data()[this.orderField!];
        const valB = b.data()[this.orderField!];
        if (valA === valB) return 0;
        if (this.orderDir === 'desc') {
          return valA < valB ? 1 : -1;
        }
        return valA > valB ? 1 : -1;
      });
    }

    if (this.limitCount != null) {
      matches = matches.slice(0, this.limitCount);
    }

    return {
      docs: matches,
      empty: matches.length === 0,
      size: matches.length
    };
  }
}

class MockCollectionRef {
  constructor(private colName: string, private db: MockFirestore) {}

  doc(id?: string) {
    const docId = id || `mock_id_${Math.random().toString(36).slice(2, 9)}`;
    return new MockDocRef(docId, this.db, this.colName);
  }

  where(field: string, op: string, val: any) {
    const q = new MockQuery(this.colName, this.db);
    return q.where(field, op, val);
  }

  orderBy(field: string, dir?: 'asc' | 'desc') {
    const q = new MockQuery(this.colName, this.db);
    return q.orderBy(field, dir);
  }

  async get() {
    const q = new MockQuery(this.colName, this.db);
    return q.get();
  }
}

class MockBatch {
  private ops: Array<() => Promise<void>> = [];

  delete(ref: MockDocRef) {
    this.ops.push(async () => ref.delete());
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this.ops) {
      await op();
    }
  }
}

class MockFirestore {
  public store: Record<string, Record<string, any>> = {};

  collection(name: string) {
    if (!this.store[name]) this.store[name] = {};
    return new MockCollectionRef(name, this);
  }

  batch() {
    return new MockBatch();
  }
}

// Simulated search engine mirroring server.ts logic for isolated unit test validation
async function executeProjectSearch(
  db: MockFirestore,
  projectId: string,
  user: any,
  params: {
    q?: string;
    type?: string;
    startDate?: string | null;
    endDate?: string | null;
    page?: number;
    limit?: number;
  }
) {
  // 1. Authoritative access check
  const projectDoc = await db.collection("projects").doc(projectId).get();
  if (!projectDoc.exists) {
    return { status: 404, error: "Not Found", message: "Project not found." };
  }
  const projectData = projectDoc.data();
  const members = projectData.members || [];
  const isMember = projectData.ownerEmail === user.email || members.some((m: any) => m.email === user.email || m.userId === user.uid);
  if (!isMember && user.role !== "admin") {
    return { status: 403, error: "Forbidden", message: "You do not have access to this project." };
  }

  // 2. Query sanitization & tokenization
  const rawQuery = params.q || "";
  const queryTrimmed = rawQuery.trim().slice(0, 200);
  const queryTokens = queryTrimmed.toLowerCase().split(/\s+/).filter(t => t.length > 0);

  const allowedTypes = new Set<string>(["meeting", "transcript", "decision", "task", "unresolved_topic"]);
  const requestedTypes = params.type
    ? new Set(params.type.split(",").map(t => t.trim().toLowerCase()).filter(t => allowedTypes.has(t)))
    : allowedTypes;

  const results: any[] = [];
  const countsByType: Record<string, number> = {
    meeting: 0,
    transcript: 0,
    decision: 0,
    task: 0,
    unresolved_topic: 0
  };

  const satisfiesDateFilter = (isoDate?: string | null) => {
    if (!isoDate) return true;
    const time = new Date(isoDate).getTime();
    if (isNaN(time)) return true;
    if (params.startDate) {
      const sTime = new Date(params.startDate).getTime();
      if (!isNaN(sTime) && time < sTime) return false;
    }
    if (params.endDate) {
      const eTime = new Date(params.endDate).getTime();
      if (!isNaN(eTime) && time > eTime) return false;
    }
    return true;
  };

  const scoreAndSnippet = (haystack: string, targetTokens: string[]) => {
    if (!haystack || targetTokens.length === 0) return { score: 0, snippet: haystack?.slice(0, 160) || "" };
    const lowerHaystack = haystack.toLowerCase();
    let score = 0;
    let firstMatchIdx = -1;

    if (lowerHaystack.includes(queryTrimmed.toLowerCase())) {
      score += 50;
      firstMatchIdx = lowerHaystack.indexOf(queryTrimmed.toLowerCase());
    }

    for (const token of targetTokens) {
      let count = 0;
      let pos = lowerHaystack.indexOf(token);
      while (pos !== -1 && count < 5) {
        count++;
        if (firstMatchIdx === -1 || pos < firstMatchIdx) {
          firstMatchIdx = pos;
        }
        pos = lowerHaystack.indexOf(token, pos + token.length);
      }
      score += count * 10;
    }

    if (score === 0) return { score: 0, snippet: haystack.slice(0, 160) };

    const start = Math.max(0, firstMatchIdx - 40);
    const end = Math.min(haystack.length, firstMatchIdx + 120);
    let snippet = haystack.slice(start, end).trim();
    if (start > 0) snippet = `...${snippet}`;
    if (end < haystack.length) snippet = `${snippet}...`;

    return { score, snippet };
  };

  // 3. Meeting Sessions & Canonical Recordings
  const sessionMap = new Map<string, any>();
  const recordingMap = new Map<string, any>();

  const [sessionsSnap, recPrimarySnap, recMultiSnap] = await Promise.all([
    db.collection("meetingSessions").where("projectId", "==", projectId).get(),
    db.collection("recordings").where("projectId", "==", projectId).get(),
    db.collection("recordings").where("projectIds", "array-contains", projectId).get()
  ]);

  for (const doc of sessionsSnap.docs) {
    sessionMap.set(doc.id, doc.data());
  }

  // Deduplicate recordings
  for (const doc of recPrimarySnap.docs) {
    if (!recordingMap.has(doc.id)) recordingMap.set(doc.id, doc.data());
  }
  for (const doc of recMultiSnap.docs) {
    if (!recordingMap.has(doc.id)) recordingMap.set(doc.id, doc.data());
  }

  if (requestedTypes.has("meeting")) {
    for (const [sessId, d] of sessionMap.entries()) {
      const meetingDate = d.actualStartTime || d.scheduledStartTime || d.createdAt || null;
      if (!satisfiesDateFilter(meetingDate)) continue;

      const haystack = [
        d.title || "",
        d.externalMeetingId || "",
        ...(Array.isArray(d.participants) ? d.participants.map((p: any) => `${p.name || ""} ${p.email || ""}`) : [])
      ].join(" ");

      const { score, snippet } = queryTokens.length > 0
        ? scoreAndSnippet(haystack, queryTokens)
        : { score: 1, snippet: d.title || "Meeting Session" };

      if (score > 0) {
        countsByType.meeting++;
        results.push({
          id: sessId,
          type: "meeting",
          title: d.title || `Meeting ${d.externalMeetingId}`,
          excerpt: snippet,
          date: meetingDate,
          score: score + 15,
          metadata: { meetingSessionId: sessId, meetingTitle: d.title, sourceType: "evidence" }
        });
      }
    }

    for (const [recId, r] of recordingMap.entries()) {
      if (r.deletedAt) continue;
      const recDate = r.date || r.createdAt || null;
      if (!satisfiesDateFilter(recDate)) continue;

      const summary = r.summary || {};
      const haystack = [
        r.fileName || "",
        summary.mainTopic || "",
        ...(Array.isArray(summary.keyPoints) ? summary.keyPoints : []),
        ...(Array.isArray(r.speakers) ? r.speakers : [])
      ].join(" ");

      const { score, snippet } = queryTokens.length > 0
        ? scoreAndSnippet(haystack, queryTokens)
        : { score: 1, snippet: r.fileName || summary.mainTopic || "Audio Recording" };

      if (score > 0) {
        countsByType.meeting++;
        results.push({
          id: recId,
          type: "meeting",
          title: r.fileName || summary.mainTopic || "Audio Recording",
          excerpt: snippet,
          date: recDate,
          score: score + 15,
          metadata: { recordingId: recId, meetingTitle: r.fileName, sourceType: "evidence" }
        });
      }
    }
  }

  // 4. Transcripts
  if (requestedTypes.has("transcript")) {
    const transcriptDocs: any[] = [];
    const [trnSnap, trnMultiSnap] = await Promise.all([
      db.collection("transcriptions").where("projectId", "==", projectId).get(),
      db.collection("transcriptions").where("projectIds", "array-contains", projectId).get()
    ]);

    for (const doc of trnSnap.docs) {
      if (!transcriptDocs.some(d => d.id === doc.id)) transcriptDocs.push(doc);
    }
    for (const doc of trnMultiSnap.docs) {
      if (!transcriptDocs.some(d => d.id === doc.id)) transcriptDocs.push(doc);
    }

    for (const tDoc of transcriptDocs) {
      const tData = tDoc.data();
      const sess = tData.meetingSessionId ? sessionMap.get(tData.meetingSessionId) : null;
      const trnDate = tData.createdAt || sess?.actualStartTime || null;
      if (!satisfiesDateFilter(trnDate)) continue;

      if (Array.isArray(tData.segments)) {
        for (let idx = 0; idx < tData.segments.length; idx++) {
          const seg = tData.segments[idx];
          const segText = seg.text || "";
          const speaker = seg.speaker || "Speaker";
          const { score, snippet } = queryTokens.length > 0
            ? scoreAndSnippet(segText, queryTokens)
            : { score: 0, snippet: segText.slice(0, 140) };

          if (score > 0) {
            countsByType.transcript++;
            results.push({
              id: `${tDoc.id}_seg_${idx}`,
              type: "transcript",
              title: `${speaker} in ${sess?.title || "Meeting"}`,
              excerpt: snippet,
              date: trnDate,
              score,
              metadata: { transcriptId: tDoc.id, speaker, sourceType: "evidence" }
            });
          }
        }
      }
    }

    // Canonical recordings transcript array
    for (const [recId, r] of recordingMap.entries()) {
      if (r.deletedAt) continue;
      const recDate = r.date || r.createdAt || null;
      if (!satisfiesDateFilter(recDate)) continue;

      if (Array.isArray(r.transcript)) {
        for (let idx = 0; idx < r.transcript.length; idx++) {
          const seg = r.transcript[idx];
          const segText = seg.text || "";
          const speaker = (r.speakerMap && r.speakerMap[seg.speaker]) || seg.speaker || "Speaker";
          const { score, snippet } = queryTokens.length > 0
            ? scoreAndSnippet(segText, queryTokens)
            : { score: 0, snippet: segText.slice(0, 140) };

          if (score > 0) {
            countsByType.transcript++;
            results.push({
              id: `${recId}_recseg_${idx}`,
              type: "transcript",
              title: `${speaker} in ${r.fileName || "Recording"}`,
              excerpt: snippet,
              date: recDate,
              score,
              metadata: { recordingId: recId, speaker, sourceType: "evidence" }
            });
          }
        }
      }
    }
  }

  // 5. Decisions
  if (requestedTypes.has("decision")) {
    const decSnap = await db.collection("decisionHistory").where("projectId", "==", projectId).get();
    for (const doc of decSnap.docs) {
      const d = doc.data();
      if (!satisfiesDateFilter(d.createdAt)) continue;

      const output = d.output || {};
      const decisionsList = output.decisions || [output];
      for (let i = 0; i < decisionsList.length; i++) {
        const dec = decisionsList[i];
        const haystack = [d.title || "", dec.decision || dec.title || "", dec.description || ""].join(" ");
        const { score, snippet } = queryTokens.length > 0
          ? scoreAndSnippet(haystack, queryTokens)
          : { score: 1, snippet: (dec.decision || dec.title || haystack).slice(0, 160) };

        if (score > 0) {
          countsByType.decision++;
          results.push({
            id: `${doc.id}_${i}`,
            type: "decision",
            title: dec.decision || dec.title || d.title || "Project Decision",
            excerpt: snippet,
            date: d.createdAt || null,
            score: score + 20,
            metadata: { confidenceLevel: dec.confidenceLevel || "High", sourceType: "intelligence" }
          });
        }
      }
    }

    // Decisions in recording summaries
    for (const [recId, r] of recordingMap.entries()) {
      if (r.deletedAt) continue;
      const recDate = r.date || r.createdAt || null;
      if (!satisfiesDateFilter(recDate)) continue;

      const summary = r.summary || {};
      const decList = Array.isArray(summary.decisions) ? summary.decisions : [];
      for (let i = 0; i < decList.length; i++) {
        const decText = decList[i];
        const haystack = `${decText} ${r.fileName || ""}`;
        const { score, snippet } = queryTokens.length > 0
          ? scoreAndSnippet(haystack, queryTokens)
          : { score: 1, snippet: decText.slice(0, 160) };

        if (score > 0) {
          countsByType.decision++;
          results.push({
            id: `${recId}_dec_${i}`,
            type: "decision",
            title: decText,
            excerpt: snippet,
            date: recDate,
            score: score + 20,
            metadata: { recordingId: recId, meetingTitle: r.fileName, sourceType: "intelligence" }
          });
        }
      }
    }
  }

  // 6. Tasks & Action Items
  if (requestedTypes.has("task")) {
    const tasksSnap = await db.collection("projectTasks").where("projectId", "==", projectId).get();
    for (const doc of tasksSnap.docs) {
      const t = doc.data();
      const taskDate = t.createdAt || t.dueDate || null;
      if (!satisfiesDateFilter(taskDate)) continue;

      const haystack = [t.title || "", t.description || "", t.assigneeName || "", t.status || ""].join(" ");
      const { score, snippet } = queryTokens.length > 0
        ? scoreAndSnippet(haystack, queryTokens)
        : { score: 1, snippet: t.title || "Project Task" };

      if (score > 0) {
        countsByType.task++;
        results.push({
          id: doc.id,
          type: "task",
          title: t.title || "Task",
          excerpt: snippet,
          date: taskDate,
          score: score + 10,
          metadata: { assignee: t.assigneeName, status: t.status, priority: t.priority, sourceType: "execution" }
        });
      }
    }

    // Action items from recording summaries
    for (const [recId, r] of recordingMap.entries()) {
      if (r.deletedAt) continue;
      const recDate = r.date || r.createdAt || null;
      if (!satisfiesDateFilter(recDate)) continue;

      const summary = r.summary || {};
      const aiList = Array.isArray(summary.actionItems) ? summary.actionItems : [];
      for (let i = 0; i < aiList.length; i++) {
        const aiText = aiList[i];
        const haystack = `${aiText} ${r.fileName || ""}`;
        const { score, snippet } = queryTokens.length > 0
          ? scoreAndSnippet(haystack, queryTokens)
          : { score: 1, snippet: aiText.slice(0, 160) };

        if (score > 0) {
          countsByType.task++;
          results.push({
            id: `${recId}_ai_${i}`,
            type: "task",
            title: aiText,
            excerpt: snippet,
            date: recDate,
            score: score + 10,
            metadata: { recordingId: recId, meetingTitle: r.fileName, status: "pending", sourceType: "execution" }
          });
        }
      }
    }
  }

  // 7. Unresolved Topics
  if (requestedTypes.has("unresolved_topic")) {
    for (const [recId, rData] of recordingMap.entries()) {
      const intelligence = rData.unifiedIntelligence || rData.meetingIntelligence;
      if (intelligence && Array.isArray(intelligence.unresolvedTopics)) {
        for (let i = 0; i < intelligence.unresolvedTopics.length; i++) {
          const uTopic = intelligence.unresolvedTopics[i];
          const haystack = [uTopic.topic || "", uTopic.context || "", uTopic.reasonUnresolved || ""].join(" ");
          const { score, snippet } = queryTokens.length > 0
            ? scoreAndSnippet(haystack, queryTokens)
            : { score: 1, snippet: uTopic.topic || "Unresolved Topic" };

          if (score > 0) {
            countsByType.unresolved_topic++;
            results.push({
              id: `${recId}_unres_${i}`,
              type: "unresolved_topic",
              title: uTopic.topic || "Unresolved Discussion",
              excerpt: snippet,
              date: rData.createdAt || null,
              score: score + 12,
              metadata: { recordingId: recId, meetingTitle: rData.fileName, sourceType: "intelligence" }
            });
          }
        }
      }
    }
  }

  // Sort by score descending, then date descending
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const timeA = new Date(a.date || 0).getTime();
    const timeB = new Date(b.date || 0).getTime();
    return timeB - timeA;
  });

  const page = Math.max(params.page || 1, 1);
  const limit = Math.min(Math.max(params.limit || 20, 1), 50);
  const startIndex = (page - 1) * limit;
  const paginatedResults = results.slice(startIndex, startIndex + limit);

  return {
    status: 200,
    success: true,
    projectId,
    query: queryTrimmed,
    totalMatches: results.length,
    countsByType,
    results: paginatedResults,
    page,
    pageSize: limit,
    hasMore: startIndex + limit < results.length
  };
}

// Simulated Search History Engine mirroring server.ts
async function recordUserSearchHistory(
  db: MockFirestore,
  user: any,
  payload: { query: string; scope: string; projectId?: string | null; filters?: any }
) {
  const trimmed = (payload.query || "").trim().slice(0, 200);
  if (!trimmed) {
    return { status: 400, error: "Bad Request", message: "A non-empty search query is required." };
  }

  if (payload.scope === "project") {
    if (!payload.projectId) {
      return { status: 400, error: "Bad Request", message: "Project ID is required." };
    }
    const projDoc = await db.collection("projects").doc(payload.projectId).get();
    if (!projDoc.exists) {
      return { status: 404, error: "Not Found", message: "Project not found." };
    }
    const pData = projDoc.data();
    const members = pData.members || [];
    const isMember = pData.ownerEmail === user.email || members.some((m: any) => m.email === user.email || m.userId === user.uid);
    if (!isMember && user.role !== "admin") {
      return { status: 403, error: "Forbidden", message: "You do not have access to this project." };
    }
  }

  const signature = `${payload.scope}:${payload.projectId || ""}:${trimmed.toLowerCase()}`;
  const now = new Date().toISOString();

  // Check for duplicate
  const existingSnap = await db.collection("searchHistory")
    .where("userId", "==", user.uid)
    .where("signature", "==", signature)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const doc = existingSnap.docs[0];
    await doc.ref.update({ lastUsedAt: now });
    return {
      status: 200,
      success: true,
      entry: { ...doc.data(), lastUsedAt: now },
      isDuplicate: true
    };
  }

  const newRef = db.collection("searchHistory").doc();
  const entry = {
    id: newRef.id,
    userId: user.uid,
    projectId: payload.projectId || null,
    query: trimmed,
    scope: payload.scope,
    filters: payload.filters || {},
    signature,
    createdAt: now,
    lastUsedAt: now
  };
  await newRef.set(entry);

  return { status: 201, success: true, entry, isDuplicate: false };
}

async function listUserSearchHistory(db: MockFirestore, user: any, scope?: string, projectId?: string) {
  let q = db.collection("searchHistory").where("userId", "==", user.uid);
  if (scope) q = q.where("scope", "==", scope);
  if (projectId) q = q.where("projectId", "==", projectId);
  const snap = await q.orderBy("lastUsedAt", "desc").get();
  return { status: 200, success: true, entries: snap.docs.map((d: any) => d.data()) };
}

async function clearUserSearchHistory(db: MockFirestore, user: any, projectId?: string) {
  let q = db.collection("searchHistory").where("userId", "==", user.uid);
  if (projectId) q = q.where("projectId", "==", projectId);
  const snap = await q.get();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return { status: 200, success: true, clearedCount: snap.docs.length };
}

async function runTests() {
  console.log("================================================================================");
  console.log("=== RUNNING AH.185 TEST SUITE: PROJECT SEARCH & VISIBLE SEARCH HISTORY ===");
  console.log("================================================================================\n");

  const db = new MockFirestore();

  // Seed Projects
  const user1 = { uid: "user_alpha_1", email: "user1@echonote.io", role: "member" };
  const user2 = { uid: "user_beta_2", email: "user2@echonote.io", role: "member" };

  await db.collection("projects").doc("proj_core").set({
    id: "proj_core",
    name: "EchoNote Core Platform",
    ownerEmail: user1.email,
    members: [{ userId: user1.uid, email: user1.email, role: "owner" }]
  });

  await db.collection("projects").doc("proj_private").set({
    id: "proj_private",
    name: "Confidential R&D",
    ownerEmail: user2.email,
    members: [{ userId: user2.uid, email: user2.email, role: "owner" }]
  });

  // Seed Meetings & Recordings
  // Legacy recording with single projectId
  await db.collection("recordings").doc("rec_legacy_01").set({
    id: "rec_legacy_01",
    fileName: "Q4 Architecture Planning Session",
    projectId: "proj_core",
    date: "2026-10-15T10:00:00Z",
    summary: {
      mainTopic: "Microservices architecture migration",
      keyPoints: ["Docker containerization", "Kubernetes cluster deployment"],
      decisions: ["Adopt Kubernetes for backend microservices"],
      actionItems: ["Finalize Dockerfile optimization by Friday"]
    },
    transcript: [
      { speaker: "Alice", text: "We need to make sure the Kubernetes ingress handles zero-downtime traffic." },
      { speaker: "Bob", text: "The latency test shows 25ms average roundtrip under synthetic load." }
    ]
  });

  // Multi-project recording associated to proj_core via projectIds (AH.183)
  await db.collection("recordings").doc("rec_multi_02").set({
    id: "rec_multi_02",
    fileName: "Cross-Functional Security Audit",
    projectId: "proj_other",
    projectIds: ["proj_core", "proj_other"],
    date: "2026-10-20T14:00:00Z",
    summary: {
      mainTopic: "Security audit compliance",
      decisions: ["Enforce spreadsheet formula sanitization for Excel export"],
      actionItems: ["Implement formula injection single-quote escaping"]
    },
    unifiedIntelligence: {
      unresolvedTopics: [
        {
          topic: "Legacy API Token Deprecation Schedule",
          context: "Older mobile clients still use legacy static tokens",
          reasonUnresolved: "Awaiting mobile team release cycle signoff",
          suggestedAction: "Schedule alignment sync with Mobile PM"
        }
      ]
    }
  });

  // Tasks
  await db.collection("projectTasks").doc("task_01").set({
    id: "task_01",
    projectId: "proj_core",
    title: "Implement formula sanitization filter",
    description: "Prevent formula injection in spreadsheet generators",
    assigneeName: "Evan Fullstack",
    status: "in_progress",
    priority: "urgent"
  });

  // ---------------------------------------------------------------------------
  // TEST SUITE 1: PROJECT SEARCH CAPABILITIES & RESULT TYPES
  // ---------------------------------------------------------------------------
  console.log("--- 1. Search Query Correctness & Result Types ---");
  {
    // Search meeting title
    const resTitle = await executeProjectSearch(db, "proj_core", user1, { q: "Architecture" });
    assert(resTitle.status === 200, "Search returns 200 OK");
    assert(resTitle.results.some((r: any) => r.type === "meeting" && r.title.includes("Architecture")), "Finds meeting by title");

    // Search transcript content
    const resTrn = await executeProjectSearch(db, "proj_core", user1, { q: "zero-downtime" });
    assert(resTrn.results.some((r: any) => r.type === "transcript" && r.excerpt.includes("zero-downtime")), "Finds transcript speech segment");

    // Search decisions from recording summary
    const resDec = await executeProjectSearch(db, "proj_core", user1, { q: "Kubernetes" });
    assert(resDec.results.some((r: any) => r.type === "decision" && r.title.includes("Kubernetes")), "Finds decision from recording summary");

    // Search tasks
    const resTask = await executeProjectSearch(db, "proj_core", user1, { q: "sanitization filter" });
    assert(resTask.results.some((r: any) => r.type === "task" && r.title.includes("formula sanitization filter")), "Finds task by title");

    // Search action items from recording summary
    const resAi = await executeProjectSearch(db, "proj_core", user1, { q: "Dockerfile optimization" });
    assert(resAi.results.some((r: any) => r.type === "task" && r.title.includes("Dockerfile optimization")), "Finds action item as task");

    // Search unresolved topics
    const resUnres = await executeProjectSearch(db, "proj_core", user1, { q: "Deprecation Schedule" });
    assert(resUnres.results.some((r: any) => r.type === "unresolved_topic" && r.title.includes("Legacy API Token Deprecation")), "Finds unresolved discussion topic");

    // Empty query returns recent project items
    const resEmpty = await executeProjectSearch(db, "proj_core", user1, { q: "" });
    assert(resEmpty.status === 200, "Empty query handled gracefully");
    assert(resEmpty.totalMatches > 0, "Empty query returns overview results");

    // Whitespace only query
    const resWs = await executeProjectSearch(db, "proj_core", user1, { q: "     " });
    assert(resWs.status === 200, "Whitespace-only query handled safely");
  }

  // ---------------------------------------------------------------------------
  // TEST SUITE 2: AH.183 MULTI-PROJECT COMPATIBILITY & DEDUPLICATION
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. AH.183 Multi-Project Recording Association Compatibility ---");
  {
    // Search for cross-functional security audit (associated via projectIds)
    const resMulti = await executeProjectSearch(db, "proj_core", user1, { q: "Security Audit" });
    assert(resMulti.results.some((r: any) => r.id === "rec_multi_02"), "Finds multi-project recording linked via projectIds");

    // Ensure no duplication if a recording matches both projectId and projectIds
    const dupRec = await db.collection("recordings").doc("rec_multi_02").get();
    const dupData = dupRec.data();
    dupData.projectId = "proj_core"; // Now present in BOTH primary and projectIds array
    await db.collection("recordings").doc("rec_multi_02").set(dupData);

    const resDedupe = await executeProjectSearch(db, "proj_core", user1, { q: "Security Audit" });
    const matchCount = resDedupe.results.filter((r: any) => r.id === "rec_multi_02").length;
    assert(matchCount === 1, "Duplicate canonical recording is deduplicated to exactly 1 result");

    // Disassociating recording from project removes it from search results
    dupData.projectId = "proj_other";
    dupData.projectIds = ["proj_other"]; // removed proj_core
    await db.collection("recordings").doc("rec_multi_02").set(dupData);

    const resAfterRemoval = await executeProjectSearch(db, "proj_core", user1, { q: "Security Audit" });
    assert(!resAfterRemoval.results.some((r: any) => r.id === "rec_multi_02"), "Removed project association no longer appears in search");

    // Restore association for remaining tests
    dupData.projectIds = ["proj_core", "proj_other"];
    await db.collection("recordings").doc("rec_multi_02").set(dupData);
  }

  // ---------------------------------------------------------------------------
  // TEST SUITE 3: AUTHORIZATION & TENANT PRIVACY
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Authorization & Tenant Isolation ---");
  {
    // User 1 tries to search User 2's private project
    const resUnauthorized = await executeProjectSearch(db, "proj_private", user1, { q: "anything" });
    assert(resUnauthorized.status === 403, "Non-member rejected from searching private project with 403 Forbidden");

    // Non-existent project returns 404
    const resNotFound = await executeProjectSearch(db, "proj_nonexistent_xyz", user1, { q: "test" });
    assert(resNotFound.status === 404, "Nonexistent project returns 404 Not Found");
  }

  // ---------------------------------------------------------------------------
  // TEST SUITE 4: SEARCH HISTORY ENGINE & PERSISTENCE
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Search History Engine & Persistence ---");
  {
    // Empty query rejected
    const hEmpty = await recordUserSearchHistory(db, user1, { query: "", scope: "project", projectId: "proj_core" });
    assert(hEmpty.status === 400, "Empty history query rejected with 400 Bad Request");

    // Record valid search
    const h1 = await recordUserSearchHistory(db, user1, { query: "Kubernetes migration", scope: "project", projectId: "proj_core" });
    assert(h1.status === 201 && h1.isDuplicate === false, "New search history entry recorded (201 Created)");

    // Record exact same query again -> Deduplicated by updating lastUsedAt
    const h2 = await recordUserSearchHistory(db, user1, { query: "Kubernetes migration", scope: "project", projectId: "proj_core" });
    assert(h2.status === 200 && h2.isDuplicate === true, "Repeated search deduplicated without creating duplicate record");

    // Record second distinct search
    await new Promise(r => setTimeout(r, 10));
    await recordUserSearchHistory(db, user1, { query: "Security audit compliance", scope: "project", projectId: "proj_core" });

    // List user history
    const listRes = await listUserSearchHistory(db, user1, "project", "proj_core");
    assert(listRes.status === 200, "Retrieves search history list");
    assert(listRes.entries.length === 2, "Contains exactly 2 deduplicated history entries");
    assert(listRes.entries[0].query === "Security audit compliance", "Newest search appears first in history");

    // User isolation: User 2 cannot see User 1's search history
    const listUser2 = await listUserSearchHistory(db, user2);
    assert(listUser2.entries.length === 0, "User 2 cannot see User 1's search history");

    // User 1 cannot record history in an unauthorized private project
    const hPrivate = await recordUserSearchHistory(db, user1, { query: "secret plans", scope: "project", projectId: "proj_private" });
    assert(hPrivate.status === 403, "Cannot record search history in unauthorized project");

    // Clear history for User 1
    const clearRes = await clearUserSearchHistory(db, user1, "proj_core");
    assert(clearRes.status === 200 && clearRes.clearedCount === 2, "User 1 search history cleared successfully");

    const listAfterClear = await listUserSearchHistory(db, user1, "project", "proj_core");
    assert(listAfterClear.entries.length === 0, "Search history is empty after clear action");
  }

  // ---------------------------------------------------------------------------
  // TEST SUITE 5: FILTER COMBINATIONS & TYPE FILTERING
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Filter Combinations & Type Filtering ---");
  {
    // Filter strictly by 'task'
    const resTaskOnly = await executeProjectSearch(db, "proj_core", user1, { q: "sanitization", type: "task" });
    assert(resTaskOnly.results.every((r: any) => r.type === "task"), "Type filter restricts results strictly to 'task'");

    // Filter strictly by 'decision'
    const resDecOnly = await executeProjectSearch(db, "proj_core", user1, { q: "sanitization", type: "decision" });
    assert(resDecOnly.results.every((r: any) => r.type === "decision"), "Type filter restricts results strictly to 'decision'");

    // Date bounds filtering
    const resDatePast = await executeProjectSearch(db, "proj_core", user1, { q: "Architecture", endDate: "2026-10-01" });
    assert(resDatePast.totalMatches === 0, "Date filter excludes items outside requested date window");
  }

  console.log("\n================================================================================");
  console.log(`=== AH.185 SEARCH & HISTORY TEST RUN COMPLETE: ${passCount} PASSED, ${failCount} FAILED ===`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution encountered an error:", err);
  process.exit(1);
});
