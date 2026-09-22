import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter } from "node:path";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_OPTIONS, loadClaudeHooks } from "../src/config.ts";
import { ClaudeHooksEngine } from "../src/engine.ts";
import { runCommandHook } from "../src/runner.ts";
import { claudeToolName, toClaudeToolInput, toolNameCandidates } from "../src/tools.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const GNUBIN = "/opt/homebrew/opt/coreutils/libexec/gnubin";
const hookEnv: NodeJS.ProcessEnv = existsSync(GNUBIN)
	? { ...process.env, PATH: `${GNUBIN}${delimiter}${process.env.PATH ?? ""}` }
	: { ...process.env };

async function hasGnuRealpath(): Promise<boolean> {
	const r = await runCommandHook("realpath -m /tmp/x/../y", "", { cwd: tmpdir(), env: hookEnv, timeoutMs: 5000 });
	return r.code === 0;
}

function makeHertekProject(): { projectDir: string; engine: ClaudeHooksEngine } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-claude-hooks-hertek-")));
	const home = join(root, "home");
	const projectDir = join(root, "project");
	mkdirSync(join(home, ".claude"), { recursive: true });
	mkdirSync(join(projectDir, ".claude"), { recursive: true });
	cpSync(join(fixtures, "hertek-settings.json"), join(projectDir, ".claude", "settings.json"));
	cpSync(join(fixtures, "hertek-apm-hooks.json"), join(projectDir, ".claude", "apm-hooks.json"));
	writeFileSync(join(home, ".claude", "settings.json"), "{}");
	const loaded = loadClaudeHooks({ home, projectDir, includeProject: true }, DEFAULT_OPTIONS);
	return { projectDir, engine: new ClaudeHooksEngine(loaded, DEFAULT_OPTIONS) };
}

function payload(projectDir: string, event: string, piTool: string, input: Record<string, unknown>) {
	return {
		session_id: "test",
		transcript_path: "",
		cwd: projectDir,
		hook_event_name: event,
		permission_mode: "default",
		tool_name: claudeToolName(piTool),
		tool_input: toClaudeToolInput(piTool, input),
		tool_use_id: "call_1",
		pi_tool_name: piTool,
	};
}

function runCtx(projectDir: string) {
	return { cwd: projectDir, env: { ...hookEnv, CLAUDE_PROJECT_DIR: projectDir } };
}

test("hertek hooks load once each from settings.json and apm-hooks.json", () => {
	const { engine } = makeHertekProject();
	assert.equal(engine.hooksFor("PreToolUse").length, 3);
	assert.equal(engine.hooksFor("PostToolUse").length, 1);
	assert.equal(engine.hooksFor("PreToolUse", toolNameCandidates("bash")).length, 1);
	assert.equal(engine.hooksFor("PreToolUse", toolNameCandidates("edit")).length, 2);
	assert.equal(engine.hooksFor("PreToolUse", toolNameCandidates("write")).length, 2);
	assert.equal(engine.hooksFor("PreToolUse", toolNameCandidates("read")).length, 0);
});

test("dangerous bash command is blocked with the hook's stderr message", async () => {
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PreToolUse",
		toolNameCandidates("bash"),
		payload(projectDir, "PreToolUse", "bash", { command: "rm -rf /" }),
		runCtx(projectDir),
	);
	assert.equal(outcome.blocked, true);
	assert.match(outcome.blockReason ?? "", /Dangerous destructive command/);
});

test("harmless bash command is allowed", async () => {
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PreToolUse",
		toolNameCandidates("bash"),
		payload(projectDir, "PreToolUse", "bash", { command: "ls -la" }),
		runCtx(projectDir),
	);
	assert.equal(outcome.blocked, false);
	assert.deepEqual(outcome.errors, []);
});

test("edit to an APM deploy target is blocked when GNU realpath is available", async (t) => {
	if (!(await hasGnuRealpath())) {
		t.skip("hertek hook needs `realpath -m` (GNU coreutils), not available on this machine");
		return;
	}
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PreToolUse",
		toolNameCandidates("edit"),
		payload(projectDir, "PreToolUse", "edit", { path: ".claude/skills/foo/SKILL.md", edits: [{ oldText: "a", newText: "b" }] }),
		runCtx(projectDir),
	);
	assert.equal(outcome.blocked, true);
	assert.match(outcome.blockReason ?? "", /APM deploy target/);
});

test("write to a generated file is blocked using file_path alias", async () => {
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PreToolUse",
		toolNameCandidates("write"),
		payload(projectDir, "PreToolUse", "write", { path: "connect-portal/src/shared/generated/api.ts", content: "x" }),
		runCtx(projectDir),
	);
	assert.equal(outcome.blocked, true);
	assert.match(outcome.blockReason ?? "", /generated files/);
});

test("edit to a normal file is allowed", async () => {
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PreToolUse",
		toolNameCandidates("edit"),
		payload(projectDir, "PreToolUse", "edit", { path: "connect-portal/src/app.ts", edits: [{ oldText: "a", newText: "b" }] }),
		runCtx(projectDir),
	);
	assert.equal(outcome.blocked, false);
});

test("PostToolUse comment warning fires on new_string synthesised from edits", async () => {
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PostToolUse",
		toolNameCandidates("edit"),
		payload(projectDir, "PostToolUse", "edit", {
			path: "connect-portal/src/app.ts",
			edits: [{ oldText: "const a = 1;", newText: "// compute the thing\nconst a = 2;" }],
		}),
		runCtx(projectDir),
	);
	assert.equal(outcome.blocked, false);
	assert.equal(outcome.feedback.length, 1);
	assert.match(outcome.feedback[0], /Comment detected/);
});

test("PostToolUse comment warning fires on write content", async () => {
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PostToolUse",
		toolNameCandidates("write"),
		payload(projectDir, "PostToolUse", "write", { path: "connect-backend/src/main/java/App.java", content: "// hello\nclass App {}" }),
		runCtx(projectDir),
	);
	assert.equal(outcome.feedback.length, 1);
});

test("PostToolUse comment warning stays quiet for comment-free code", async () => {
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PostToolUse",
		toolNameCandidates("write"),
		payload(projectDir, "PostToolUse", "write", { path: "connect-backend/src/main/java/App.java", content: "class App {}" }),
		runCtx(projectDir),
	);
	assert.deepEqual(outcome.feedback, []);
	assert.deepEqual(outcome.errors, []);
});

test("edit outside the project root is not treated as a deploy target", async (t) => {
	if (!(await hasGnuRealpath())) {
		t.skip("needs GNU realpath");
		return;
	}
	const { projectDir, engine } = makeHertekProject();
	const outcome = await engine.run(
		"PreToolUse",
		toolNameCandidates("edit"),
		payload(projectDir, "PreToolUse", "edit", { path: "/tmp/elsewhere/.claude/skills/foo/SKILL.md", edits: [{ oldText: "a", newText: "b" }] }),
		runCtx(projectDir),
	);
	assert.equal(outcome.blocked, false);
});
