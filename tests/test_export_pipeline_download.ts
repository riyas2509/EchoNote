import assert from 'assert';
import { downloadReport } from '../lib/apiClient';
import type { GenerateReportRequest } from '../types';

console.log("================================================================================");
console.log("=== RUNNING EXPORT PIPELINE & CLIENT DOWNLOAD INTEGRATION TEST SUITE ===");
console.log("================================================================================");

// Mock DOM environment for browser-like download triggering
class MockBlob {
  public parts: any[];
  public options?: any;
  public type: string;
  constructor(parts: any[], options?: any) {
    this.parts = parts;
    this.options = options;
    this.type = options?.type || '';
  }
}

class MockAnchor {
  public href: string = '';
  public download: string = '';
  public style: any = {};
  public clickCount: number = 0;
  click() {
    this.clickCount++;
  }
}

const createdElements: MockAnchor[] = [];
const createdObjectUrls: string[] = [];
const revokedObjectUrls: string[] = [];

// Setup global mock DOM
(global as any).Blob = MockBlob;
(global as any).window = {
  URL: {
    createObjectURL(blob: any) {
      const url = "blob:https://echonote.app/" + Math.random().toString(36).substring(2);
      createdObjectUrls.push(url);
      return url;
    },
    revokeObjectURL(url: string) {
      revokedObjectUrls.push(url);
    }
  }
};
(global as any).document = {
  createElement(tag: string) {
    if (tag === 'a') {
      const el = new MockAnchor();
      createdElements.push(el);
      return el;
    }
    return {};
  },
  body: {
    appendChild(el: any) {},
    removeChild(el: any) {}
  }
};

async function runTests() {
  console.log("\n--- 1. Verification of PPTX Presentation Export Trigger ---");
  {
    // Save original fetch
    const originalFetch = (global as any).fetch;

    // PPTX Presentation test
    (global as any).fetch = async (url: string, init: any) => {
      assert(url.includes('/api/reports/generate'), "Request URL points to report generation endpoint");
      assert.strictEqual(init.method, 'POST', "Request method is POST");
      const body = JSON.parse(init.body);
      assert.strictEqual(body.format, 'pptx', "Request format is pptx");
      assert.strictEqual(body.reportType, 'meeting_summary', "Report type is meeting_summary");
      assert.strictEqual(body.meetingId, 'rec_test_123', "Meeting ID is passed correctly");

      // Return synthetic binary response with presentation MIME & Content-Disposition
      return {
        ok: true,
        status: 200,
        headers: new Map([
          ['Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
          ['Content-Disposition', 'attachment; filename="EchoNote_Roadmap_Review_Summary.pptx"']
        ]),
        blob: async () => new MockBlob(['PKsynthetic_pptx_bytes'], {
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        })
      };
    };

    const initialCreatedCount = createdElements.length;
    const req: GenerateReportRequest = {
      reportType: 'meeting_summary',
      format: 'pptx',
      meetingId: 'rec_test_123'
    };

    const result = await downloadReport(req);
    assert.strictEqual(result.ok, true, "downloadReport reports success for PPTX export");
    assert.strictEqual(createdElements.length, initialCreatedCount + 1, "Download anchor element was created");
    const anchor = createdElements[createdElements.length - 1];
    assert.strictEqual(anchor.clickCount, 1, "Download link click was triggered automatically");
    assert.strictEqual(anchor.download, "EchoNote_Roadmap_Review_Summary.pptx", "Download filename matches Content-Disposition");
    assert(anchor.href.startsWith("blob:"), "Download URL is a valid object URL");
    console.log("? PASS: PPTX presentation export successfully triggers browser download with proper filename & MIME");
  }

  console.log("\n--- 2. Verification of XLSX Excel Workbook Export Trigger ---");
  {
    (global as any).fetch = async (url: string, init: any) => {
      assert(url.includes('/api/reports/generate'), "Request URL points to report generation endpoint");
      assert.strictEqual(init.method, 'POST', "Request method is POST");
      const body = JSON.parse(init.body);
      assert.strictEqual(body.format, 'xlsx', "Request format is xlsx");
      assert.strictEqual(body.reportType, 'project_status', "Report type is project_status");
      assert.strictEqual(body.projectId, 'proj_alpha_99', "Project ID is passed correctly");

      return {
        ok: true,
        status: 200,
        headers: new Map([
          ['Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
          ['Content-Disposition', 'attachment; filename="EchoNote_Project_Alpha_Status_Report.xlsx"']
        ]),
        blob: async () => new MockBlob(['PKsynthetic_xlsx_bytes'], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        })
      };
    };

    const initialCreatedCount = createdElements.length;
    const req: GenerateReportRequest = {
      reportType: 'project_status',
      format: 'xlsx',
      projectId: 'proj_alpha_99'
    };

    const result = await downloadReport(req);
    assert.strictEqual(result.ok, true, "downloadReport reports success for XLSX export");
    assert.strictEqual(createdElements.length, initialCreatedCount + 1, "Download anchor element was created");
    const anchor = createdElements[createdElements.length - 1];
    assert.strictEqual(anchor.clickCount, 1, "Download link click was triggered automatically");
    assert.strictEqual(anchor.download, "EchoNote_Project_Alpha_Status_Report.xlsx", "Download filename matches Content-Disposition");
    assert(anchor.href.startsWith("blob:"), "Download URL is a valid object URL");
    console.log("? PASS: XLSX Excel workbook export successfully triggers browser download with proper filename & MIME");
  }

  console.log("\n--- 3. Verification of Backend Error Propagation ---");
  {
    (global as any).fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden", message: "User not authorized for this project export." })
    });

    const result = await downloadReport({
      reportType: 'project_status',
      format: 'xlsx',
      projectId: 'proj_forbidden'
    });

    assert.strictEqual(result.ok, false, "downloadReport returns ok: false when server rejects request");
    assert(result.error?.includes("User not authorized"), "Actionable server error message preserved for display to user");
    console.log("? PASS: Backend authorization errors are cleanly caught and surfaced to the UI");
  }

  console.log("\n--- 4. Verification of Fallback Filename & UTF-8 Encoding ---");
  {
    (global as any).fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([
        ['Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
        ['Content-Disposition', "attachment; filename*=UTF-8''EchoNote%20Executive%20Review.pptx"]
      ]),
      blob: async () => new MockBlob(['PKfake_pptx'])
    });

    const result = await downloadReport({
      reportType: 'management_review',
      format: 'pptx'
    });

    assert.strictEqual(result.ok, true, "downloadReport handles RFC 5987 / UTF-8 filenames");
    const anchor = createdElements[createdElements.length - 1];
    assert.strictEqual(anchor.download, "EchoNote Executive Review.pptx", "Decodes UTF-8 filename correctly");
    console.log("? PASS: UTF-8 encoded filename correctly decoded and assigned to download anchor");
  }

  console.log("\n================================================================================");
  console.log("=== ALL EXPORT PIPELINE INTEGRATION TESTS PASSED ===");
  console.log("================================================================================");
}

runTests().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
