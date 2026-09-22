import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface RunCommandOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
	signal?: AbortSignal;
	shell?: string;
}

export interface RunCommandResult {
	code: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

const TERMINATION_GRACE_MS = 250;

export function resolveShell(preferred?: string): string | boolean {
	if (preferred) return preferred;
	if (process.platform === "win32") return true;
	if (existsSync("/bin/bash")) return "/bin/bash";
	return true;
}

/** Run a hook and do not resolve until its streams and process tree have closed. */
export function runCommandHook(command: string, stdin: string, options: RunCommandOptions): Promise<RunCommandResult> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let proc: ReturnType<typeof spawn> | undefined;
		let timer: NodeJS.Timeout | undefined;
		let forceTimer: NodeJS.Timeout | undefined;
		let terminating = false;

		const clearTimers = () => {
			if (timer) clearTimeout(timer);
			if (forceTimer) clearTimeout(forceTimer);
			timer = undefined;
			forceTimer = undefined;
		};

		const cleanup = () => {
			clearTimers();
			options.signal?.removeEventListener("abort", onAbort);
		};

		const finish = (code: number) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve({ code, stdout, stderr, timedOut });
		};

		const processAlive = () => {
			if (!proc?.pid) return false;
			try {
				if (process.platform !== "win32") process.kill(-proc.pid, 0);
				else process.kill(proc.pid, 0);
				return true;
			} catch {
				return false;
			}
		};

		const killTree = (force: boolean) => {
			if (!proc?.pid) return;
			try {
				if (process.platform === "win32") {
					// taskkill is the only reliable way to include descendants on Windows.
					spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
				} else {
					process.kill(-proc.pid, force ? "SIGKILL" : "SIGTERM");
				}
			} catch {
				// The process may have exited between the liveness check and kill.
			}
		};

		const beginTermination = () => {
			if (terminating || settled || !proc) return;
			terminating = true;
			try {
				if (process.platform === "win32") killTree(true);
				else killTree(false);
			} finally {
				// Never trust a child to honour TERM. The force attempt is bounded and
				// happens even when the leader has already closed but descendants remain.
				forceTimer = setTimeout(() => {
					if (processAlive()) killTree(true);
				}, TERMINATION_GRACE_MS);
				forceTimer.unref();
			}
		};

		const onAbort = () => beginTermination();

		if (options.signal?.aborted) {
			resolve({ code: 1, stdout: "", stderr: "", timedOut: false });
			return;
		}

		try {
			proc = spawn(command, {
				cwd: options.cwd,
				env: options.env,
				shell: resolveShell(options.shell),
				// A negative pid targets the complete group on POSIX.
				detached: process.platform !== "win32",
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (err) {
			stderr = err instanceof Error ? err.message : String(err);
			finish(1);
			return;
		}

		if (options.timeoutMs > 0) {
			timer = setTimeout(() => {
				timedOut = true;
				beginTermination();
			}, options.timeoutMs);
			timer.unref();
		}
		options.signal?.addEventListener("abort", onAbort, { once: true });
		// Abort can race spawn and listener registration.
		if (options.signal?.aborted) onAbort();

		proc.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("error", (err) => {
			// ChildProcess emits close after error; wait for it so streams are drained.
			stderr += err.message;
		});
		proc.on("close", (code) => finish(code ?? 1));
		proc.stdin?.on("error", () => {});
		proc.stdin?.end(stdin);
	});
}
