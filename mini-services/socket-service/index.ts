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
 * In production Socket.IO uses its standard /socket.io/ path and shares the
 * Render-assigned HTTP port with the HMAC-protected /emit endpoint. This keeps
 * WebSocket traffic and server-to-server notification delivery on one service
 * and one public port. Local sandbox mode can still set SOCKET_PATH="/".
 */

const PORT = Number(process.env.PORT || process.env.SOCKET_PORT || 3003);
const SOCKET_PATH = process.env.SOCKET_PATH || "/socket.io/";
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production" ? "" : "medsync-ai-sandbox-secret");

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured for production.");
}

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

const httpServer = createServer(async (req, res) => {
  const requestPath = req.url?.split("?")[0] || "";

  if (req.method === "POST" && requestPath === "/emit") {
    // Bound memory use; this endpoint accepts compact notification payloads only.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += part.length;
      if (totalBytes > 1_048_576) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "payload too large" }));
        return;
      }
      chunks.push(part);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
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
      const parsed = JSON.parse(raw) as {
        userId?: string | null;
        notification?: { title?: string; message?: string; [key: string]: unknown };
      };
      if (
        (parsed.userId !== null && parsed.userId !== undefined && typeof parsed.userId !== "string") ||
        !parsed.notification ||
        typeof parsed.notification !== "object" ||
        typeof parsed.notification.title !== "string" ||
        typeof parsed.notification.message !== "string"
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "invalid payload" }));
        return;
      }
      if (parsed.userId) {
        io.to(`user-${parsed.userId}`).emit("notification", parsed.notification);
        console.log(`Notification sent to user ${parsed.userId}: ${parsed.notification.title}`);
      } else {
        io.emit("notification", parsed.notification);
        console.log(`Notification sent to all clients: ${parsed.notification.title}`);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "invalid JSON" }));
    }
    return;
  }

  if (req.method === "GET" && requestPath === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Let Socket.IO's request listener handle its own transport path. This
  // listener runs before Socket.IO's listener, so answering 404 here would
  // otherwise break the WebSocket handshake.
  const socketPathRoot = SOCKET_PATH.replace(/\/+$/, "") || "/";
  const isSocketRequest =
    socketPathRoot === "/"
      ? requestPath === "/"
      : requestPath === socketPathRoot || requestPath.startsWith(`${socketPathRoot}/`);
  if (isSocketRequest) return;

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});
const io = new Server(httpServer, {
  path: SOCKET_PATH,
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

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`MedSync socket service running on port ${PORT}`);
});

// The HTTP /emit endpoint and Socket.IO share the same Render web port.
const shutdown = () => {
  io.close(() => process.exit(0));
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
