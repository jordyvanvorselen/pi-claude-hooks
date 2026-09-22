import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_OPTIONS, extractHooksSection, globToRegex, loadClaudeHooks, loadOptions } from "../src/config.ts";

function makeProject(files: Record<string, unknown>): { home: string; projectDir: string } {
	const root = mkdtempSync(join(tmpdir(), "pi-claude-hooks-"));
	const home = join(root, "home");
	const projectDir = join(root, "project");
	mkdirSync(join(home, ".claude"), { recursive: true });
	mkdirSync(join(projectDir, ".claude"), { recursive: true });
	for (const [rel, content] of Object.entries(files)) {
		const abs = rel.startsWith("~/") ? join(home, rel.slice(2)) : join(projectDir, rel);
		writeFileSync(abs, JSON.stringify(content));
	}
	return { home, projectDir };
}

const hook = (command: string, matcher?: string) => ({ matcher, hooks: [{ type: "command", command }] });

test("hooks merge in order: user, project, local, extra files", () => {
	const { home, projectDir } = makeProject({
		"~/.claude/settings.json": { hooks: { PreToolUse: [hook("echo user", "Bash")] } },
		".claude/settings.json": { hooks: { PreToolUse: [hook("echo project", "Bash")] } },
		".claude/settings.local.json": { hooks: { PreToolUse: [hook("echo local", "Bash")] } },
		".claude/apm-hooks.json": { PreToolUse: [hook("echo apm", "Bash")] },
	});
	const result = loadClaudeHooks({ home, projectDir, includeProject: true }, DEFAULT_OPTIONS);
	assert.deepEqual(
		result.hooks.map((h) => h.command),
		["echo user", "echo project", "echo local", "echo apm"],
	);
	assert.equal(result.sources.length, 4);
});

test("identical hooks appearing in two files run once", () => {
	const { home, projectDir } = makeProject({
		".claude/settings.json": { hooks: { PreToolUse: [hook("echo same", "Bash")] } },
		".claude/apm-hooks.json": { PreToolUse: [hook("echo same", "Bash")] },
	});
	const result = loadClaudeHooks({ home, projectDir, includeProject: true }, DEFAULT_OPTIONS);
	assert.equal(result.hooks.length, 1);
});

test("untrusted project loads only user hooks", () => {
	const { home, projectDir } = makeProject({
		"~/.claude/settings.json": { hooks: { PreToolUse: [hook("echo user")] } },
		".claude/settings.json": { hooks: { PreToolUse: [hook("echo project")] } },
	});
	const result = loadClaudeHooks({ home, projectDir, includeProject: false }, DEFAULT_OPTIONS);
	assert.deepEqual(
		result.hooks.map((h) => h.command),
		["echo user"],
	);
});

test("non-command hook types are skipped with one warning per type", () => {
	const { home, projectDir } = makeProject({
		".claude/settings.json": {
			hooks: {
				PreToolUse: [
					{ hooks: [{ type: "prompt", prompt: "x" }] },
					{ hooks: [{ type: "prompt", prompt: "y" }] },
					{ hooks: [{ type: "http", url: "http://x" }] },
				],
			},
		},
	});
	const result = loadClaudeHooks({ home, projectDir, includeProject: true }, DEFAULT_OPTIONS);
	assert.equal(result.hooks.length, 0);
	assert.equal(result.warnings.length, 2);
});

test("extra file glob is configurable", () => {
	const { home, projectDir } = makeProject({
		".claude/apm-hooks.json": { PreToolUse: [hook("echo apm")] },
		".claude/other.json": { hooks: { PreToolUse: [hook("echo other")] } },
	});
	const only = loadClaudeHooks({ home, projectDir, includeProject: true }, { ...DEFAULT_OPTIONS, extraFiles: ["apm-*.json"] });
	assert.deepEqual(
		only.hooks.map((h) => h.command),
		["echo apm"],
	);
	const none = loadClaudeHooks({ home, projectDir, includeProject: true }, { ...DEFAULT_OPTIONS, extraFiles: [] });
	assert.equal(none.hooks.length, 0);
});

test("json files without hooks are ignored", () => {
	const { home, projectDir } = makeProject({
		".claude/random.json": { foo: "bar" },
	});
	const result = loadClaudeHooks({ home, projectDir, includeProject: true }, DEFAULT_OPTIONS);
	assert.equal(result.sources.length, 0);
});

test("hook timeout defaults and per hook override in seconds", () => {
	const { home, projectDir } = makeProject({
		".claude/settings.json": {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "a" }, { type: "command", command: "b", timeout: 5 }] }],
				SessionEnd: [hook("c")],
			},
		},
	});
	const result = loadClaudeHooks({ home, projectDir, includeProject: true }, DEFAULT_OPTIONS);
	assert.equal(result.hooks[0].timeoutMs, 600_000);
	assert.equal(result.hooks[1].timeoutMs, 5_000);
	assert.equal(result.hooks[2].timeoutMs, 1_500);
});

test("extractHooksSection accepts wrapped and bare shapes", () => {
	assert.deepEqual(extractHooksSection({ hooks: { PreToolUse: [] } }), { PreToolUse: [] });
	assert.deepEqual(extractHooksSection({ PreToolUse: [], other: 1 }), { PreToolUse: [] });
	assert.equal(extractHooksSection({ other: 1 }), undefined);
});

test("globToRegex matches simple patterns", () => {
	assert.equal(globToRegex("*.json").test("apm-hooks.json"), true);
	assert.equal(globToRegex("apm-*.json").test("settings.json"), false);
	assert.equal(globToRegex("a?c").test("abc"), true);
});

test("loadOptions reads project override file and env var", () => {
	const { home, projectDir } = makeProject({});
	mkdirSync(join(projectDir, ".pi"), { recursive: true });
	writeFileSync(join(projectDir, ".pi", "claude-hooks.json"), JSON.stringify({ extraFiles: ["x.json"], verbose: true }));
	const opts = loadOptions(projectDir, home);
	assert.deepEqual(opts.extraFiles, ["x.json"]);
	assert.equal(opts.verbose, true);
	process.env.PI_CLAUDE_HOOKS_EXTRA_FILES = "a.json, b.json";
	try {
		assert.deepEqual(loadOptions(projectDir, home).extraFiles, ["a.json", "b.json"]);
	} finally {
		delete process.env.PI_CLAUDE_HOOKS_EXTRA_FILES;
	}
});

test("startupSummary option accepts only known modes", () => {
	const { home, projectDir } = makeProject({});
	mkdirSync(join(projectDir, ".pi"), { recursive: true });
	writeFileSync(join(projectDir, ".pi", "claude-hooks.json"), JSON.stringify({ startupSummary: "full" }));
	assert.equal(loadOptions(projectDir, home).startupSummary, "full");
	writeFileSync(join(projectDir, ".pi", "claude-hooks.json"), JSON.stringify({ startupSummary: "bogus" }));
	assert.equal(loadOptions(projectDir, home).startupSummary, "compact");
});
