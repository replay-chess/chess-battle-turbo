// CI diagnostic logs (owner request, CI run 43599091643: devices-game showed only "Process from config.webServer was not
// able to start. Exit code: 1"). With E2E_LOG_DIR set (ci.yml sets it for every job that starts servers), each local
// server Playwright starts also writes its stdout and stderr to `<E2E_LOG_DIR>/<name>.log`, whatever the webServer's
// `stdout` setting, so a build or boot error survives the run: the job prints the tail of each file on failure and
// uploads the directory. `pipefail` keeps the server's own exit code (a failed `pnpm build` still fails the start).
// Without E2E_LOG_DIR the command is unchanged (local runs).
import path from "node:path";

/** POSIX single-quoting for `bash -c`. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `command`, teeing its stdout+stderr into `<E2E_LOG_DIR>/<name>.log` when E2E_LOG_DIR is set. */
export function loggedCommand(name: string, command: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const dir = env.E2E_LOG_DIR?.trim();
  if (!dir) return command;
  if (!/^[\w.-]+$/.test(name)) throw new Error(`server log name must be a plain file name: ${name}`);
  const file = path.join(dir, `${name}.log`);
  const script = `mkdir -p ${shellQuote(dir)} && { ${command} ; } 2>&1 | tee -a ${shellQuote(file)}`;
  return `bash -o pipefail -c ${shellQuote(script)}`;
}
