declare const require: (moduleName: string) => any;
declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void };
declare const Buffer: { concat(list: readonly any[], totalLength?: number): any };
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

async function main(): Promise<void> {
  loadEnv();
  const child = spawn("uvx", ["tigergraph-mcp"], {
    env: {
      ...process.env,
      TG_HOST: process.env.TG_HOST,
      TG_SECRET: process.env.TG_SECRET,
      TG_GRAPHNAME: "FraudCommand",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const send = (msg: unknown) => {
    child.stdin.write(JSON.stringify(msg) + "\n");
  };

  let buffer = "";
  child.stdout.on("data", (d: any) => {
    buffer += d.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed.id === 2) {
          const tools = parsed.result?.tools?.map((t: any) => t.name) ?? [];
          console.log("ALL AVAILABLE MCP TOOLS:", JSON.stringify(tools, null, 2));
          child.kill();
          process.exit(0);
        }
      } catch (e) {}
    }
  });

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "tool-inspector", version: "1.0.0" },
    },
  });

  setTimeout(() => {
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
  }, 1000);
}

main().catch(console.error);
