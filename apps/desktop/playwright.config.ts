import { defineConfig, devices } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import prepareWorld from "./e2e/global-setup";

const root = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(root, "e2e/.tmp");
const daemonPort = 7455;
const uiPort = 5199;
const sourceDir=process.env.OPENADE_E2E_SOURCE ?? root;

if (process.env.OPENADE_E2E_PREPARED === undefined) {
  prepareWorld();
  process.env.OPENADE_E2E_PREPARED = "1";
}

const pinnedChromium = "/opt/pw-browsers/chromium";
const executablePath = !process.env.CI && fs.existsSync(pinnedChromium)
  ? pinnedChromium
  : undefined;

export default defineConfig({
  testDir: "e2e",
  testMatch: ["ade-lifecycle.spec.ts","zeron-flows.spec.ts","engine-flows.spec.ts","performance.spec.ts","capture.spec.ts","parity-controls.spec.ts","appearance-audit.spec.ts","attachments.spec.ts","projectless.spec.ts","custom-themes.spec.ts","file-previews.spec.ts","message-rail.spec.ts","native-preferences.spec.ts","workspace-preferences.spec.ts","syntax.spec.ts","provider-protocol.spec.ts","project-sidebar.spec.ts","artwork.spec.ts","title-naming.spec.ts","review-comments.spec.ts","side-chats.spec.ts","acp.spec.ts","cursor.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    trace: "retain-on-failure",
    video: process.env.OPENADE_RECORD_VIDEO?{mode:"on",size:{width:1480,height:920}}:"off",
    permissions:["clipboard-read","clipboard-write"],
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: executablePath ? { executablePath,slowMo:process.env.OPENADE_RECORD_VIDEO?120:0 } : process.env.OPENADE_RECORD_VIDEO?{slowMo:120}:{},
    },
  }],
  webServer: [
    {
      command: `npm run build && go build -o ${path.join(tmpDir,"openade-e2e")} . && exec ${path.join(tmpDir,"openade-e2e")} --daemon --addr 127.0.0.1:${daemonPort} --data-dir ${path.join(tmpDir, "data")}`,
      cwd: sourceDir,
      url: `http://127.0.0.1:${daemonPort}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        PATH: `${path.join(tmpDir, "bin")}:${process.env.PATH ?? ""}`,
        SHELL: "/bin/sh",
        OPENADE_AUTH_TOKEN:"openade-e2e-synthetic-token-2026",
        OPENADE_PROVIDER_HOME:path.join(tmpDir,"provider-home"),
        OPENADE_CURSOR_SHIM_EXECUTABLE:path.join(tmpDir,"bin","cursor-shim"),
        VITE_OPENADE_DAEMON_URL:`http://127.0.0.1:${daemonPort}`,
        VITE_OPENADE_AUTH_TOKEN:"openade-e2e-synthetic-token-2026",
      },
    },
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${uiPort} --strictPort`,
      cwd: sourceDir,
      url: `http://127.0.0.1:${uiPort}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        VITE_OPENADE_DAEMON_URL: `http://127.0.0.1:${daemonPort}`,
        VITE_OPENADE_AUTH_TOKEN:"openade-e2e-synthetic-token-2026",

      },
    },
  ],
});
