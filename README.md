# pi-mcp

A one-tool MCP server for persistent conversations with the [Pi coding
agent](https://pi.dev). It uses Pi's supported SDK; it is not a fork.

The server exposes one tool:

```text
pi_message(message: string, sessionId?: string)
  -> { reply: string, sessionId: string }
```

Omit `sessionId` to start a conversation. Keep the returned ID and pass it to a
later call—even from another MCP harness or a restarted server—to continue the
same Pi thread.

## Setup

```bash
git clone https://github.com/JoeEverest/pi-mcp.git
cd pi-mcp
npm ci
npm run build
```

Pi must have credentials for at least one model provider. You can use the Pi CLI
to log in (credentials are stored in Pi's normal `~/.pi/agent` directory):

```bash
npx -p @earendil-works/pi-coding-agent pi
```

Then run `/login` inside Pi. Provider API-key environment variables supported by
Pi also work.

## MCP client configuration

Point any stdio MCP client at the built server:

```json
{
  "mcpServers": {
    "pi": {
      "command": "node",
      "args": ["/absolute/path/to/pi-mcp/dist/index.js"],
      "env": {
        "PI_MCP_CWD": "/absolute/path/to/the/project"
      }
    }
  }
}
```

`PI_MCP_CWD` defaults to the MCP server process's current directory. Pi's normal
project instructions, extensions, skills, settings, and session storage are
loaded for that directory.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `PI_MCP_SESSION_DIR` | Override Pi's session storage directory. |
| `PI_MCP_PROVIDER` | Pin a provider; requires `PI_MCP_MODEL`. |
| `PI_MCP_MODEL` | Pin a model; requires `PI_MCP_PROVIDER`. |
| `PI_MCP_THINKING` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |

Example calls:

```json
{ "message": "Inspect this project and tell me why the tests fail." }
```

```json
{
  "message": "Now implement the fix and run the tests.",
  "sessionId": "019c..."
}
```

Both MCP text content and `structuredContent` contain the JSON result, which
makes the tool usable by clients with or without structured-output support.

## Security and concurrency

Pi starts with its usual coding tools, so an MCP caller can read files, execute
commands, and edit files under the configured working directory. Only connect
trusted MCP clients.

Calls targeting the same session are serialized within one server process. A
session is persisted after each turn, so another process can resume it later;
do not write to the same session concurrently from multiple server processes.

## Development

```bash
npm run typecheck
npm test
npm run build
```
