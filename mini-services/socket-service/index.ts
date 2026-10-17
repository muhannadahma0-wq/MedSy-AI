import { createServer } from "http";
import { Server } from "socket.io";
import crypto from "crypto";

/**
 * MedSync AI — Socket.IO notification service (port 3003).
 *
 * Port of the Socket.IO layer that lived inside the original Express server
 * (server/src/index.js + services/socketService.js + middlewares/socketAuth.js):
 *  - JWT handshake auth (same HS256 token the Next.js API issues)
 *  - `join-user` → joins room `user-<id>` for targeted notifications
 *  - `notification` events pushed to a user's room (or broadcast)
 *
 * MASTER AUDIT hardening (P0-14/15/16 + P1-53):
 *  - P0-14: the token is accepted ONLY from `handshake.auth.token` — NEVER
 *    from the query string (query strings leak through logs/proxies). The
 *    bundled frontend already sends it there.
 *  - P0-15/16: the room is ALWAYS derived from the VERIFIED token identity
 *    (`socket.data.user.id`). The `join-user` event payload is ignored — a
 *    client can never subscribe to another user's room, and can never
 *    override `socket.user`, room ownership or permissions.
 *  - P1-53: CORS origins are environment-controlled (SOCKET_CORS_ORIGINS,
 *    comma-separated). The sandbox default "*" keeps the preview working
 *    (no credentials are carried by CORS on this transport — the JWT travels
 *    in the handshake auth payload, not cookies); production must set real
 *    origins.
 *
 * Because socket.io owns path "/" on port 3003 (required by the Caddy
 * gateway), the internal /emit HTTP bridge used by the Next.js notification
 * scheduler runs on a separate loopback-only server on port 3004.
 */

const PORT = 3003;
const EMIT_PORT = 3004;
const JWT_SECRET = process.env.JWT_SECRET || "medsync-ai-sandbox-secret";

// P1-53 — environment-controlled CORS. Sandbox default keeps the gateway
// preview functional; production sets SOCKET_CORS_ORIGINS=https://app.example
const corsOrigins = (process.env.SOCKET_CORS_ORIGINS || "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function fromBase64url(input: string): Buffer {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
}

function verifyToken(token: string): { id: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = Buffer.from(
      crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest()
    )
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(fromBase64url(body).toString("utf8"));
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.id) return null;
    return { id: String(payload.id) };
  } catch {
    return null;
  }
}

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: "/",
  cors: {
    origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Socket.IO JWT auth middleware (port of middlewares/socketAuth.js) ──────
io.use((socket, next) => {
  try {
    // P0-14 — auth payload ONLY. Query-string tokens are rejected outright.
    const token = socket.handshake.auth?.token;
    if (!token || token === "null" || token === "undefined" || String(token).trim() === "") {
      return next(new Error("Authentication token missing"));
    }
    const decoded = verifyToken(String(token));
    if (!decoded) return next(new Error("Invalid token"));
    socket.data.user = decoded;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  // P0-15/16 — the verified token identity is the ONLY identity on this
  // socket. The room is joined automatically at connection time and derived
  // exclusively from it.
  const verifiedUserId = socket.data.user?.id;
  console.log("Client connected:", socket.id, "| user:", verifiedUserId);
  if (verifiedUserId) {
    socket.join(`user-${verifiedUserId}`);
  }

  // Backward-compatible event: the bundled frontend still emits `join-user`
  // with its locally stored id. The PAYLOAD IS IGNORED — the room is always
  // the authenticated user's own room, so a tampered payload cannot subscribe
  // to anyone else's notifications (P0-15).
  socket.on("join-user", (payload) => {
    if (payload !== verifiedUserId) {
      // Honest rejection: the client tried to join a room that is not theirs.
      console.warn(
        `[socket] rejected room join: socket ${socket.id} (user ${verifiedUserId}) asked for user-${payload}`
      );
    }
    // Always (re)join ONLY the verified room — idempotent by design.
    if (verifiedUserId) socket.join(`user-${verifiedUserId}`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });

  socket.on("error", (error: unknown) => {
    console.error(`Socket error (${socket.id}):`, error);
  });
});

httpServer.listen(PORT, () => {
  console.log(`MedSync socket service running on port ${PORT}`);
});

// ── Internal /emit bridge (port 3004, loopback only) ───────────────────────
const emitServer = createServer(async (req, res) => {
  const url = req.url?.split("?")[0] || "";
  if (req.method === "POST" && url === "/emit") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    // MR-19 central fix (2026-10-01): the /emit bridge now requires an
    // HMAC-SHA256 signature over the raw body (shared JWT_SECRET, header
    // "x-emit-signature", timing-safe compare). Loopback binding alone let
    // ANY local process push notifications to every connected client.
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(raw).digest("hex");
    const provided = String(req.headers["x-emit-signature"] || "");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "bad signature" }));
      return;
    }
    try {
      const { userId, notification } = JSON.parse(raw);
      if (userId) {
        io.to(`user-${userId}`).emit("notification", notification);
        console.log(`Notification sent to user ${userId}: ${notification?.title}`);
      } else {
        io.emit("notification", notification);
        console.log(`Notification sent to all clients: ${notification?.title}`);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error("Emit error:", err);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false }));
    }
    return;
  }
  if (req.method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

emitServer.listen(EMIT_PORT, "127.0.0.1", () => {
  console.log(`Internal emit bridge running on 127.0.0.1:${EMIT_PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
  emitServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
  emitServer.close(() => process.exit(0));
});
