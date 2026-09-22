import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildSummary,
	compactEventList,
	displayPath,
	formatCompact,
	formatExpanded,
	formatForCommand,
	PLAIN_STYLE,
	shouldAppendSummary,
} from "../src/summary.ts";
import type { LoadResult, LoadedHook } from "../src/types.ts";

const hook = (event: string, source: string, matcher?: string, command = "echo hi"): LoadedHook => ({
	event,
	matcher,
	command,
	timeoutMs: 1000,
	source,
});

const loaded: LoadResult = {
	sources: ["/home/me/.claude/settings.json", "/proj/.claude/settings.json", "/proj/.claude/empty.json"],
	hooks: [
		hook("SessionStart", "/home/me/.claude/settings.json", "startup"),
		hook("PreToolUse", "/proj/.claude/settings.json", "Bash"),
		hook("PreToolUse", "/proj/.claude/settings.json", "Edit|Write"),
		hook("PostToolUse", "/proj/.claude/settings.json", undefined, "x".repeat(100)),
	],
	warnings: ["Hook type \"prompt\" is not supported"],
};

test("summary counts hooks per event in load order", () => {
	const s = buildSummary(loaded, "/home/me");
	assert.equal(compactEventList(s), "SessionStart (1), PreToolUse (2), PostToolUse (1)");
	assert.equal(s.total, 4);
});

test("summary groups hooks by source with home shortened and commands truncated", () => {
	const s = buildSummary(loaded, "/home/me");
	assert.deepEqual(
		s.sources.map((src) => src.path),
		["~/.claude/settings.json", "/proj/.claude/settings.json", "/proj/.claude/empty.json"],
	);
	assert.deepEqual(s.sources[1].hooks.map((h) => h.matcher), ["PreToolUse [Bash]", "PreToolUse [Edit|Write]", "PostToolUse [*]"]);
	assert.equal(s.sources[1].hooks[2].command.length, 70);
	assert.deepEqual(s.sources[2].hooks, []);
});

test("compact form is a header plus one indented line", () => {
	const s = buildSummary(loaded, "/home/me");
	assert.equal(formatCompact(s, PLAIN_STYLE), "[Claude hooks]\n  SessionStart (1), PreToolUse (2), PostToolUse (1)");
});

test("expanded form lists sources, hooks and warnings", () => {
	const s = buildSummary(loaded, "/home/me");
	const text = formatExpanded(s, PLAIN_STYLE);
	assert.equal(text.split("\n")[0], "[Claude hooks]");
	assert.match(text, /\n {2}~\/\.claude\/settings\.json\n {4}SessionStart \[startup\] echo hi\n/);
	assert.match(text, /\n {2}\/proj\/\.claude\/empty\.json\n {4}\(no new hooks, [^)]*\)\n/);
	assert.match(text, /\n {2}Warning: Hook type "prompt" is not supported$/);
});

test("style callbacks wrap header, source, body and warning lines", () => {
	const s = buildSummary(loaded, "/home/me");
	const text = formatExpanded(s, {
		header: (t) => `<h>${t}</h>`,
		source: (t) => `<s>${t}</s>`,
		dim: (t) => `<d>${t}</d>`,
		warning: (t) => `<w>${t}</w>`,
	});
	assert.match(text, /^<h>\[Claude hooks\]<\/h>\n {2}<s>~\/\.claude\/settings\.json<\/s>\n<d> {4}SessionStart/);
	assert.match(text, /<w> {2}Warning:/);
});

test("command output reports when nothing was found", () => {
	assert.equal(formatForCommand(buildSummary({ sources: [], hooks: [], warnings: [] })), "No Claude Code hook files found.");
	assert.match(formatForCommand(buildSummary(loaded, "/home/me")), /Total: 4$/);
});

test("displayPath shortens the home directory only", () => {
	assert.equal(displayPath("/home/me/x", "/home/me"), "~/x");
	assert.equal(displayPath("/other/x", "/home/me"), "/other/x");
});

test("startup summary is appended once per session and only with UI, hooks and a mode", () => {
	const base = { hasUI: true, mode: "compact" as const, hookCount: 3, existing: 0 };
	assert.equal(shouldAppendSummary(base), true);
	assert.equal(shouldAppendSummary({ ...base, mode: "full" }), true);
	assert.equal(shouldAppendSummary({ ...base, existing: 1 }), false);
	assert.equal(shouldAppendSummary({ ...base, hasUI: false }), false);
	assert.equal(shouldAppendSummary({ ...base, mode: "off" }), false);
	assert.equal(shouldAppendSummary({ ...base, hookCount: 0 }), false);
});
