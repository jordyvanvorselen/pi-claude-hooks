import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretResults, parseHookJson } from "../src/output.ts";
import type { HookRunResult, LoadedHook } from "../src/types.ts";

const hook = (event: string): LoadedHook => ({ event, matcher: undefined, command: "x", timeoutMs: 1000, source: "test" });

function result(event: string, partial: Partial<HookRunResult>): HookRunResult {
	const stdout = partial.stdout ?? "";
	return { hook: hook(event), code: 0, stdout, stderr: "", timedOut: false, json: parseHookJson(stdout), ...partial };
}

test("parseHookJson only accepts a JSON object", () => {
	assert.deepEqual(parseHookJson('{"continue": true}'), { continue: true });
	assert.equal(parseHookJson("plain text"), undefined);
	assert.equal(parseHookJson("[1]"), undefined);
});

test("PreToolUse exit 2 blocks with stderr as reason", () => {
	const o = interpretResults("PreToolUse", [result("PreToolUse", { code: 2, stderr: "BLOCKED: no\n" })]);
	assert.equal(o.blocked, true);
	assert.equal(o.blockReason, "BLOCKED: no");
});

test("PreToolUse permissionDecision deny wins over allow from another hook", () => {
	const o = interpretResults("PreToolUse", [
		result("PreToolUse", { stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}' }),
		result("PreToolUse", {
			stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"nope"}}',
		}),
	]);
	assert.equal(o.blocked, true);
	assert.equal(o.blockReason, "nope");
	assert.equal(o.allow, true);
});

test("PreToolUse ask and updatedInput are surfaced", () => {
	const o = interpretResults("PreToolUse", [
		result("PreToolUse", {
			stdout: JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "ask",
					permissionDecisionReason: "sure?",
					updatedInput: { file_path: "b" },
					additionalContext: "ctx",
				},
			}),
		}),
	]);
	assert.equal(o.ask, true);
	assert.equal(o.askReason, "sure?");
	assert.deepEqual(o.updatedInputs, [{ file_path: "b" }]);
	assert.deepEqual(o.context, ["ctx"]);
});

test("legacy decision block on PreToolUse blocks", () => {
	const o = interpretResults("PreToolUse", [result("PreToolUse", { stdout: '{"decision":"block","reason":"legacy"}' })]);
	assert.equal(o.blocked, true);
	assert.equal(o.blockReason, "legacy");
});

test("PostToolUse exit 2 becomes model feedback and does not block", () => {
	const o = interpretResults("PostToolUse", [result("PostToolUse", { code: 2, stderr: "Comment detected" })]);
	assert.equal(o.blocked, false);
	assert.deepEqual(o.feedback, ["Comment detected"]);
});

test("PostToolUse decision block reason becomes feedback", () => {
	const o = interpretResults("PostToolUse", [result("PostToolUse", { stdout: '{"decision":"block","reason":"fix it"}' })]);
	assert.deepEqual(o.feedback, ["fix it"]);
});

test("UserPromptSubmit plain stdout is context and exit 2 blocks", () => {
	const ctx = interpretResults("UserPromptSubmit", [result("UserPromptSubmit", { stdout: "remember X\n" })]);
	assert.deepEqual(ctx.context, ["remember X"]);
	const blocked = interpretResults("UserPromptSubmit", [result("UserPromptSubmit", { code: 2, stderr: "no" })]);
	assert.equal(blocked.blocked, true);
});

test("SessionStart plain stdout is context and exit 2 is only an error", () => {
	const o = interpretResults("SessionStart", [
		result("SessionStart", { stdout: "hello" }),
		result("SessionStart", { code: 2, stderr: "oops" }),
	]);
	assert.deepEqual(o.context, ["hello"]);
	assert.equal(o.blocked, false);
	assert.deepEqual(o.errors, ["oops"]);
});

test("continue false stops and blocks on blockable events", () => {
	const o = interpretResults("PreToolUse", [result("PreToolUse", { stdout: '{"continue":false,"stopReason":"done"}' })]);
	assert.equal(o.stop, true);
	assert.equal(o.stopReason, "done");
	assert.equal(o.blocked, true);
});

test("other exit codes are non-blocking errors but valid json still applies", () => {
	const o = interpretResults("PreToolUse", [
		result("PreToolUse", { code: 1, stderr: "boom", stdout: '{"hookSpecificOutput":{"permissionDecision":"deny"}}' }),
	]);
	assert.equal(o.errors.length, 1);
	assert.equal(o.blocked, true);
});

test("timeouts are reported as errors and never block", () => {
	const o = interpretResults("PreToolUse", [result("PreToolUse", { code: 1, timedOut: true })]);
	assert.equal(o.blocked, false);
	assert.match(o.errors[0], /timed out/);
});

test("systemMessage is collected", () => {
	const o = interpretResults("Stop", [result("Stop", { stdout: '{"systemMessage":"hi"}' })]);
	assert.deepEqual(o.systemMessages, ["hi"]);
});
