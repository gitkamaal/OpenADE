import { expect } from "@playwright/test";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { choose, daemon, ready, repo, setRepository, status, test, tmp, token } from "./helpers";

test.describe.configure({ mode: "serial" });

test("custom naming settings generate a title in an isolated read-only provider run", async ({ page, request }) => {
  await ready(page);
  await page.getByLabel("Open settings").click();
  await choose(page, "Naming provider", "codex");
  await choose(page, "Naming model", "fixture-sol");
  await expect(page.getByLabel("Naming model")).toHaveAttribute("data-value", "fixture-sol");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await setRepository(page, repo);
  await choose(page, "Provider", "codex");
  const prompt = "Please do bespoke naming for this tricky project";
  await page.getByLabel("New session prompt").fill(prompt);
  await page.getByLabel("Start session").click();
  await expect.poll(async () => {
    const payload = await (await request.get(`${daemon}/api/sessions`)).json();
    return (payload.sessions ?? []).find((item: { prompt: string }) => item.prompt === prompt);
  }).toMatchObject({ title: "Bespoke Fixture Name", status: "completed" });
  const payload = await (await request.get(`${daemon}/api/sessions`)).json();
  const named = payload.sessions.find((item: { prompt: string }) => item.prompt === prompt);
  await expect.poll(async () => (await (await request.get(`${daemon}/api/sessions/${named.id}`)).json()).branch).toMatch(/^ade\/bespoke-fixture-name-/);
  await expect(page.locator(".session-title h1")).toHaveText("Bespoke Fixture Name");
  const invocation = JSON.parse(fs.readFileSync(path.join(tmp, "provider-home/title-args.json"), "utf8"));
  expect(invocation.name).toBe("codex");
  expect(invocation.args).toContain("read-only");
  expect(invocation.args).toContain("--ephemeral");
  expect(invocation.args).toContain("fixture-sol");
  expect(invocation.cwd).not.toContain(repo);
  const attached = await request.post(`${daemon}/api/sessions`, { data: { title: "Attached chat", prompt: "Summarize the attached chart\n\nAttached images (local files — open them to view):\n- /private/secret-chart.png", agent: "codex", mode: "chat", repo_root: repo, base_branch: "main", auto_title: true } });
  expect(attached.status()).toBe(201);
  const attachedSession = await attached.json();
  await expect.poll(async () => (await (await request.get(`${daemon}/api/sessions/${attachedSession.id}`)).json()).title).toBe("Summarize the attached chart");
  const attachedInvocation = JSON.parse(fs.readFileSync(path.join(tmp, "provider-home/title-args.json"), "utf8"));
  expect(JSON.stringify(attachedInvocation.args)).not.toContain("secret-chart.png");
  await page.reload();
  await page.getByLabel("Open settings").click();
  await expect(page.getByLabel("Naming provider")).toHaveAttribute("data-value", "codex");
  await expect(page.getByLabel("Naming model")).toHaveAttribute("data-value", "fixture-sol");
});

test("manual rename wins a delayed generated title and a failed naming run falls back", async ({ request }) => {
  const first = await request.post(`${daemon}/api/sessions`, { data: { title: "wait-title preliminary", prompt: "wait-title preliminary", agent: "codex", mode: "chat", repo_root: repo, base_branch: "main", auto_title: true } });
  expect(first.status()).toBe(201);
  const session = await first.json();
  await expect.poll(() => status(request, session.id)).toBe("completed");
  await expect.poll(() => fs.existsSync(path.join(tmp, "provider-home/.e2e-title-started"))).toBe(true);
  const rename = await request.patch(`${daemon}/api/sessions/${session.id}`, { data: { title: "My own title" } });
  expect(rename.status()).toBe(204);
  fs.writeFileSync(path.join(tmp, "provider-home/.e2e-release-title"), "");
  await expect.poll(async () => (await (await request.get(`${daemon}/api/sessions/${session.id}`)).json()).title).toBe("My own title");
  const second = await request.post(`${daemon}/api/sessions`, { data: { title: "Pending title", prompt: "fail-title fix the broken login process now please", agent: "codex", mode: "chat", repo_root: repo, base_branch: "main", auto_title: true } });
  expect(second.status()).toBe(201);
  const failed = await second.json();
  await expect.poll(async () => (await (await request.get(`${daemon}/api/sessions/${failed.id}`)).json()).title, { timeout: 15000 }).toBe("fail-title fix the broken login process now");
  const settings = await request.patch(`${daemon}/api/title-settings`, { data: { harness: "", model: "" } });
  expect(settings.status()).toBe(200);
  expect(await settings.json()).toEqual({ harness: "", model: "" });
  const automatic = await request.post(`${daemon}/api/sessions`, { data: { title: "Awaiting generated title", prompt: "Automatic naming model probe", agent: "codex", mode: "chat", repo_root: repo, base_branch: "main", auto_title: true } });
  expect(automatic.status()).toBe(201);
  const automaticSession = await automatic.json();
  await expect.poll(async () => (await (await request.get(`${daemon}/api/sessions/${automaticSession.id}`)).json()).title).toBe("Automatic naming model probe");
  const invocation = JSON.parse(fs.readFileSync(path.join(tmp, "provider-home/title-args.json"), "utf8"));
  expect(invocation.args).toContain("fixture-luna");
});

test("a completed pending title resumes after daemon restart", async () => {
  const port = 7478, base = `http://127.0.0.1:${port}`, data = path.join(tmp, "title-recovery-data"), providerHome = path.join(tmp, "provider-home");
  const started = path.join(providerHome, ".e2e-title-started"), release = path.join(providerHome, ".e2e-release-title");
  for (const marker of [started, release]) if (fs.existsSync(marker)) fs.unlinkSync(marker);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const launch = () => spawn(path.join(tmp, "openade-e2e"), ["--daemon", "--addr", `127.0.0.1:${port}`, "--data-dir", data], { env: { ...process.env, OPENADE_AUTH_TOKEN: token, OPENADE_PROVIDER_HOME: providerHome, PATH: `${path.join(tmp, "bin")}:${process.env.PATH}`, SHELL: "/bin/sh" }, stdio: "pipe" });
  const stop = async (child: ChildProcess) => { if (child.exitCode !== null) return; child.kill("SIGTERM"); await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error("naming daemon did not stop")), 8000); child.once("exit", () => { clearTimeout(timer); resolve(); }); }); };
  let child = launch();
  try {
    await expect.poll(async () => { try { return (await fetch(base + "/api/health")).status; } catch { return 0; } }).toBe(200);
    const created = await fetch(base + "/api/sessions", { method: "POST", headers, body: JSON.stringify({ title: "Pending recovery name", prompt: "wait-title restart naming", agent: "codex", mode: "chat", repo_root: repo, base_branch: "main", auto_title: true }) });
    expect(created.status).toBe(201);
    const session = await created.json();
    await expect.poll(() => fs.existsSync(started)).toBe(true);
    await stop(child);
    child = launch();
    await expect.poll(async () => { try { return (await fetch(base + "/api/health")).status; } catch { return 0; } }).toBe(200);
    fs.writeFileSync(release, "");
    await expect.poll(async () => (await (await fetch(`${base}/api/sessions/${session.id}`, { headers })).json()).title).toBe("wait-title restart naming");
  } finally { await stop(child); }
});
