import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { runCommandHook } from "../src/runner.ts";

const base = { cwd: tmpdir(), env: { ...process.env, CLAUDE_PROJECT_DIR: "/proj" } };

test("hook receives the payload on stdin and the env vars", async () => {
	const r = await runCommandHook("jq -r .tool_input.file_path; echo $CLAUDE_PROJECT_DIR", '{"tool_input":{"file_path":"a.ts"}}', {
		...base,
		timeoutMs: 5000,
	});
	assert.equal(r.code, 0);
	assert.equal(r.stdout, "a.ts\n/proj\n");
});

test("exit code and stderr are captured", async () => {
	const r = await runCommandHook("echo nope >&2; exit 2", "{}", { ...base, timeoutMs: 5000 });
	assert.equal(r.code, 2);
	assert.equal(r.stderr, "nope\n");
});

test("timeouts kill the hook and are flagged", async () => {
	const r = await runCommandHook("sleep 5", "{}", { ...base, timeoutMs: 200 });
	assert.equal(r.timedOut, true);
	assert.notEqual(r.code, 0);
});

test("abort signal kills the hook", async () => {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 100);
	const r = await runCommandHook("sleep 5", "{}", { ...base, timeoutMs: 5000, signal: controller.signal });
	assert.notEqual(r.code, 0);
});
