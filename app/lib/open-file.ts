import { spawn } from "node:child_process";

export function openPath(targetPath: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(command, [targetPath], { detached: true, stdio: "ignore" });
  child.unref();
}
