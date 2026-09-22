import assert from "node:assert/strict";
import { test } from "node:test";
import { matcherMatches } from "../src/matcher.ts";

test("undefined, empty and star matchers match everything", () => {
	assert.equal(matcherMatches(undefined, ["bash"]), true);
	assert.equal(matcherMatches("", ["bash"]), true);
	assert.equal(matcherMatches("*", ["bash"]), true);
});

test("pipe separated exact list matches names case-sensitively", () => {
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

test("regex matchers are unanchored and case-sensitive", () => {
	assert.equal(matcherMatches("^mcp__.*", ["mcp__github__list"]), true);
	assert.equal(matcherMatches("Edit.*", ["notebookedit"]), false);
	assert.equal(matcherMatches("Edit.*", ["NotebookEdit"]), true);
	assert.equal(matcherMatches("^Bash$", ["bash", "Bash"]), true);
	assert.equal(matcherMatches("^Bash$", ["powershell", "Bash"]), true);
});

test("invalid regex never matches and warns", () => {
	let warning = "";
	assert.equal(matcherMatches("Bash(", ["Bash("], (message) => (warning = message)), false);
	assert.match(warning, /Invalid/);
});
