# Remote control: how it works and what it protects against

Remote control lets a phone or tablet watch your terminals, type into them, press keys (Enter, Esc, Ctrl+C, arrows, y/n) and get an alert when a terminal needs you. It is **off by default**.

## How it works
- Turn it on in *Settings > Remote control* (or the command palette). OrchestrAI then runs a small web server **on your computer**. There is no cloud service and no relay: the phone talks straight to your computer.
- You choose where the server listens:
  - **This computer only** (`127.0.0.1`): for use through a tunnel you run yourself (an SSH port forward, a reverse proxy with TLS).
  - **My Tailscale network**: the server binds only to the computer's Tailscale address (`100.64.0.0/10`). Tailscale encrypts and authenticates the traffic. If no Tailscale address exists the server does not start.
  - **My local network**: binds every interface. Traffic is plain HTTP, so you must tick a box saying you accept that. Use it only on a network you trust.
- To add a device, press **Pair a device**. An 8-character code appears on the computer. Open the address on the device, type the code and a name. The code works once, for two minutes, and five wrong tries lock the pairing.
- The device then holds a random 256-bit token in an `HttpOnly`, `SameSite=Strict` cookie. Only a SHA-256 hash of the token is stored on the computer (`remote.json` in the data folder).
- **Revoke** removes a device. Its live connection is closed at once and its token stops working. *Revoke all* does the same for every device. Turning remote control off closes the port and cancels any open pairing.

## What a paired device can do
List terminals (name, floor, status, role), read the last lines of a terminal's screen, type text (with or without Enter), press one of a fixed list of keys or a single letter or digit, and clear a terminal's attention flag. It cannot create or close nodes, read files, change settings, or reach anything outside the terminals.

## Threat model
| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| A stranger on the network finds the port | Off by default; loopback by default; no API call works without a paired session; unauthenticated probing is rate limited (10 failures per minute per address) | The web page itself (static) is visible to anyone who can reach the port |
| Guessing the pairing code | Single use, 2-minute lifetime, 5 tries then locked, only exists while you have pressed *Pair*, compared in constant time | 32-bit code: acceptable only because of the limits above |
| Stealing a session on the network | Tailscale mode relies on WireGuard; tokens are random and only hashed on disk | **On the local-network mode the traffic is not encrypted**: someone on the same network can read terminal output and steal the cookie. Use Tailscale or a TLS tunnel instead |
| A website in your browser attacking the local server (CSRF) | Every API call needs a custom header and an `Origin` that matches the host; the cookie is `SameSite=Strict` | None known |
| DNS rebinding | The `Host` header must be an IP address, `localhost`, this machine's name or `*.ts.net`; anything else gets `421` | None known |
| Script injection through terminal output | Terminal text is placed on the page with `textContent`; the page has a strict CSP (nonce for its one script and style, no other sources, no framing) | None known |
| A lost or stolen phone | Revoke it from the desktop; sessions end immediately | Anything the phone showed before |
| Over-large or malformed requests | Bodies are limited to 16 KB; JSON is parsed defensively; ids in paths are restricted to a safe alphabet | None known |
| An agent running in a terminal attacking the server | The server is separate from the agent bridge; an agent can reach it like any local program, but needs a paired token to use it | A hostile local program can read `remote.json`, which holds only hashes |

## Things it deliberately does not do
- No accounts, no passwords, no remote access to the file system, no screen sharing of other apps.
- No notifications while the page is closed. The page vibrates and shows a browser notification when it is open (browser notifications need a secure context, so over plain HTTP they only work on `localhost`; the page title and an in-page banner always work).
- No TLS of its own. Put it behind Tailscale or a tunnel.

## Reporting a problem
If you find a way around any of the above, please open a private security advisory on the repository rather than a public issue.
