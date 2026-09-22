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

export function resolveShell(preferred?: string): string | boolean {
	if (preferred) return preferred;
	if (process.platform === "win32") return true;
	if (existsSync("/bin/bash")) return "/bin/bash";
	return true;
}

export function runCommandHook(command: string, stdin: string, options: RunCommandOptions): Promise<RunCommandResult> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let proc: ReturnType<typeof spawn>;

		const finish = (code: number) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			resolve({ code, stdout, stderr, timedOut });
		};

		const kill = () => {
			try {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
				}, 2000).unref();
			} catch {}
		};

		const onAbort = () => {
			kill();
			finish(1);
		};

		try {
			proc = spawn(command, {
				cwd: options.cwd,
				env: options.env,
				shell: resolveShell(options.shell),
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err) {
			stderr = err instanceof Error ? err.message : String(err);
			finish(1);
			return;
		}

		const timer =
			options.timeoutMs > 0
				? setTimeout(() => {
						timedOut = true;
						kill();
					}, options.timeoutMs)
				: undefined;

		if (options.signal) {
			if (options.signal.aborted) {
				onAbort();
				return;
			}
			options.signal.addEventListener("abort", onAbort, { once: true });
		}

		proc.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("error", (err) => {
			stderr += err.message;
			finish(1);
		});
		proc.on("close", (code) => {
			finish(code ?? 1);
		});

		proc.stdin?.on("error", () => {});
		proc.stdin?.end(stdin);
	});
}
