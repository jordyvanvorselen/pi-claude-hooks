import assert from "node:assert/strict";
import { test } from "node:test";
import { buildToolCallPayload, buildToolResultPayload } from "../src/payload.ts";

test("tool result payload preserves Pi blocks and details", () => {
	const content = [{ type: "text", text: "ok" }, { type: "image", data: "abc", mimeType: "image/png" }];
	const payload = buildToolResultPayload({}, "bash", { command: "true" }, "call-1", content, { exitCode: 0 }, false, false);
	assert.equal((payload.tool_response as Record<string, unknown>).output, "ok\n[image]");
	assert.deepEqual((payload.tool_response as Record<string, unknown>).content, content);
	assert.deepEqual((payload.tool_response as Record<string, unknown>).details, { exitCode: 0 });
	assert.equal((payload.tool_response as Record<string, unknown>).is_error, false);
});

test("failure payload infers interrupts without inventing fields", () => {
	const payload = buildToolResultPayload({}, "bash", {}, "call-1", [{ type: "text", text: "Command aborted" }], undefined, true, false);
	assert.deepEqual(payload, {
		tool_name: "Bash",
		pi_tool_name: "bash",
		tool_input: {},
		tool_use_id: "call-1",
		error: "Command aborted",
		is_interrupt: true,
	});
});

test("tool call payload normalizes input and names", () => {
	assert.deepEqual(buildToolCallPayload({}, "read", { path: "a" }, "call-1"), {
		tool_name: "Read",
		pi_tool_name: "read",
		tool_input: { path: "a", file_path: "a" },
		tool_use_id: "call-1",
	});
});
