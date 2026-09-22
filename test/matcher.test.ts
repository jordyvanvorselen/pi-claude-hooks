import assert from "node:assert/strict";
import { test } from "node:test";
import { matcherMatches } from "../src/matcher.ts";

test("undefined, empty and star matchers match everything", () => {
	assert.equal(matcherMatches(undefined, ["bash"]), true);
	assert.equal(matcherMatches("", ["bash"]), true);
	assert.equal(matcherMatches("*", ["bash"]), true);
});

test("pipe separated exact list matches Claude Code names case-insensitively", () => {
	assert.equal(matcherMatches("Edit|Write", ["edit", "Edit"]), true);
	assert.equal(matcherMatches("Edit|Write", ["write", "Write"]), true);
	assert.equal(matcherMatches("Edit|Write", ["read", "Read"]), false);
	assert.equal(matcherMatches("edit", ["edit", "Edit"]), true);
});

test("comma separated exact list is accepted", () => {
	assert.equal(matcherMatches("Edit, Write", ["write", "Write"]), true);
});

test("exact list does not do substring matching", () => {
	assert.equal(matcherMatches("Edit", ["notebookedit", "NotebookEdit"]), false);
});

test("regex matchers are unanchored and case-insensitive", () => {
	assert.equal(matcherMatches("^mcp__.*", ["mcp__github__list"]), true);
	assert.equal(matcherMatches("Edit.*", ["notebookedit", "NotebookEdit"]), true);
	assert.equal(matcherMatches("^Bash$", ["bash", "Bash"]), true);
	assert.equal(matcherMatches("^Bash$", ["powershell", "Bash"]), true);
});

test("invalid regex falls back to exact match", () => {
	assert.equal(matcherMatches("Bash(", ["Bash("]), true);
	assert.equal(matcherMatches("Bash(", ["Bash"]), false);
});
