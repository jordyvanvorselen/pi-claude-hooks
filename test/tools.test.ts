import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeToolName, fromClaudeToolInput, replaceInputInPlace, toClaudeToolInput, toolNameCandidates } from "../src/tools.ts";

test("pi tool names map to Claude Code names", () => {
	assert.equal(claudeToolName("bash"), "Bash");
	assert.equal(claudeToolName("edit"), "Edit");
	assert.equal(claudeToolName("write"), "Write");
	assert.equal(claudeToolName("read"), "Read");
	assert.equal(claudeToolName("grep"), "Grep");
	assert.equal(claudeToolName("find"), "Glob");
	assert.equal(claudeToolName("ls"), "LS");
	assert.equal(claudeToolName("mcp__github__search"), "mcp__github__search");
});

test("candidates include both pi and Claude names without duplicates", () => {
	assert.deepEqual(toolNameCandidates("edit"), ["edit", "Edit"]);
	assert.deepEqual(toolNameCandidates("my_tool"), ["my_tool"]);
});

test("edit input gains file_path, old_string and new_string while keeping pi fields", () => {
	const out = toClaudeToolInput("edit", {
		path: "src/a.ts",
		edits: [
			{ oldText: "a", newText: "b" },
			{ oldText: "c", newText: "d" },
		],
	});
	assert.equal(out.file_path, "src/a.ts");
	assert.equal(out.path, "src/a.ts");
	assert.equal(out.old_string, "a\nc");
	assert.equal(out.new_string, "b\nd");
	assert.equal(Array.isArray(out.edits), true);
});

test("write and read inputs gain file_path", () => {
	assert.equal(toClaudeToolInput("write", { path: "x", content: "y" }).file_path, "x");
	assert.equal(toClaudeToolInput("write", { path: "x", content: "y" }).content, "y");
	assert.equal(toClaudeToolInput("read", { path: "x" }).file_path, "x");
});

test("bash input passes command through", () => {
	assert.deepEqual(toClaudeToolInput("bash", { command: "ls", timeout: 5 }), { command: "ls", timeout: 5 });
});

test("grep ignoreCase is mirrored to -i", () => {
	assert.equal(toClaudeToolInput("grep", { pattern: "x", ignoreCase: true })["-i"], true);
});

test("updatedInput file_path maps back to path", () => {
	const original = { path: "a.ts", content: "hi" };
	const mapped = fromClaudeToolInput("write", original, { file_path: "b.ts", path: "a.ts", content: "hi" });
	assert.deepEqual(mapped.input, { path: "b.ts", content: "hi" });
	assert.deepEqual(mapped.warnings, []);
});

test("updatedInput that only changes path keeps that change", () => {
	const original = { path: "a.ts", content: "hi" };
	const mapped = fromClaudeToolInput("write", original, { file_path: "a.ts", path: "c.ts", content: "hi" });
	assert.equal(mapped.input.path, "c.ts");
});

test("updatedInput new_string maps back to a single edit", () => {
	const original = { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] };
	const mapped = fromClaudeToolInput("edit", original, {
		file_path: "a.ts",
		path: "a.ts",
		edits: original.edits,
		old_string: "x",
		new_string: "z",
	});
	assert.deepEqual(mapped.input, { path: "a.ts", edits: [{ oldText: "x", newText: "z" }] });
});

test("updatedInput new_string with multiple edits warns and keeps edits", () => {
	const original = {
		path: "a.ts",
		edits: [
			{ oldText: "x", newText: "y" },
			{ oldText: "p", newText: "q" },
		],
	};
	const mapped = fromClaudeToolInput("edit", original, { file_path: "a.ts", old_string: "x\np", new_string: "changed" });
	assert.equal(mapped.warnings.length, 1);
	assert.deepEqual(mapped.input.edits, original.edits);
	assert.equal("new_string" in mapped.input, false);
});

test("replaceInputInPlace keeps the same object identity", () => {
	const target: Record<string, unknown> = { command: "ls", timeout: 3 };
	replaceInputInPlace(target, { command: "pwd" });
	assert.deepEqual(target, { command: "pwd" });
});
