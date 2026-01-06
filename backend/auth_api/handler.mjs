import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const JWT_SECRET = process.env.JWT_SECRET || "";
const USERS_TABLE = process.env.USERS_TABLE || "";

const ADMIN_EMAIL_ALLOWLIST = (process.env.ADMIN_EMAIL_ALLOWLIST || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Basic env sanity (fail fast, loudly in logs)
if (!GOOGLE_CLIENT_ID) console.error("Missing env GOOGLE_CLIENT_ID");
if (!JWT_SECRET) console.error("Missing env JWT_SECRET");
if (!USERS_TABLE) console.error("Missing env USERS_TABLE");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// You can pass client_id here or not; verifyIdToken() will enforce audience.
// Keeping it here is fine as long as GOOGLE_CLIENT_ID is set.
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function nowISO() { return new Date().toISOString(); }

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body),
  };
}
const bad = (m) => resp(400, { error: m });
const unauth = (m = "Unauthorized") => resp(401, { error: m });
const forbid = (m = "Forbidden") => resp(403, { error: m });

function bearer(headers = {}) {
  const h = headers.Authorization || headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] || null;
}

function signToken(user) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET not set");
  return jwt.sign(
    { sub: user.sub, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d", issuer: "current-api", audience: "current-web" }
  );
}

function verifyToken(token) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET not set");
  return jwt.verify(token, JWT_SECRET, {
    issuer: "current-api",
    audience: "current-web",
    clockTolerance: 60, // helps small clock skew
  });
}

async function getUser(sub) {
  const pk = `USER#${sub}`;
  const r = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { pk, sk: "PROFILE" }
  }));
  return r.Item || null;
}

async function upsertUserFromGoogle(payload) {
  if (!USERS_TABLE) throw new Error("USERS_TABLE not set");

  const sub = payload.sub;
  const pk = `USER#${sub}`;
  const existing = await getUser(sub);

  const emailLower = (payload.email || "").toLowerCase();
  const isAdmin = ADMIN_EMAIL_ALLOWLIST.includes(emailLower);

  const existingRole = (existing?.role || "").toLowerCase();
  const role = isAdmin ? "admin" : (existingRole === "artist" ? "artist" : "listener");

  // ✅ FIX: define artistStatus instead of referencing an undefined variable
  const artistStatus = existing?.artistStatus || null;

  const item = {
    pk, sk: "PROFILE",
    sub,
    email: payload.email || "",
    name: payload.name || payload.email || "User",
    picture: payload.picture || "",
    role,

    artistStatus, // ✅ now defined
    artistApplication: existing?.artistApplication || null,

    createdAt: existing?.createdAt || nowISO(),
    updatedAt: nowISO(),
    lastLoginAt: nowISO(),
  };

  await ddb.send(new PutCommand({ TableName: USERS_TABLE, Item: item }));
  return item;
}

function requireAuth(event) {
  const t = bearer(event.headers || {});
  if (!t) throw new Error("NO_TOKEN");
  return verifyToken(t);
}

function requireAdmin(decoded) {
  if (decoded.role !== "admin") throw new Error("NOT_ADMIN");
}

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || "";
  const path = event.rawPath || event.path || "";

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: resp(200, {}).headers, body: "" };
  }

  // POST /auth/google
  if (method === "POST" && path.endsWith("/auth/google")) {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    if (!body.credential) return bad("Missing credential");
    if (!GOOGLE_CLIENT_ID) return resp(500, { error: "Server missing GOOGLE_CLIENT_ID" });

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: body.credential,
        audience: GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload?.sub) return unauth("Invalid Google token");

      const user = await upsertUserFromGoogle(payload);
      const token = signToken(user);
      return resp(200, { token, user });

    } catch (e) {
      // ✅ FIX: log the real reason (CloudWatch), don’t mask it
      console.error("verifyIdToken/upsert/signToken failed:", e);
      return unauth("Google token verification failed");
    }
  }

  // GET /me
  if (method === "GET" && path.endsWith("/me")) {
    try {
      const decoded = requireAuth(event);
      const user = await getUser(decoded.sub);
      if (!user) return unauth("User not found");
      return resp(200, { user });
    } catch (e) {
      console.error("/me failed:", e);
      return unauth("Invalid/expired token");
    }
  }

  // POST /artist/apply
  if (method === "POST" && path.endsWith("/artist/apply")) {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const displayName = (body.displayName || "").trim();
    const bio = (body.bio || "").trim();
    const links = (body.links || "").trim();
    if (!displayName) return bad("displayName is required");

    try {
      const decoded = requireAuth(event);
      const user = await getUser(decoded.sub);
      if (!user) return unauth("User not found");
      if (user.role === "admin" || user.role === "artist") {
        return resp(200, { user, message: "Already an artist/admin." });
      }

      const submittedAt = nowISO();
      const pk = `USER#${decoded.sub}`;

      const u = await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { pk, sk: "PROFILE" },
        UpdateExpression: `
          SET artistStatus = :pending,
              artistApplication = :app,
              gsi1pk = :g1pk,
              gsi1sk = :g1sk,
              updatedAt = :u
        `,
        ExpressionAttributeValues: {
          ":pending": "pending",
          ":app": { displayName, bio, links, submittedAt },
          ":g1pk": "ARTIST#PENDING",
          ":g1sk": `${submittedAt}#${decoded.sub}`,
          ":u": nowISO(),
        },
        ReturnValues: "ALL_NEW"
      }));

      const newUser = u.Attributes;
      const token = signToken(newUser);
      return resp(200, { token, user: newUser });
    } catch (e) {
      console.error("/artist/apply failed:", e);
      return unauth("Invalid/expired token");
    }
  }

  // GET /admin/artist-applications
  if (method === "GET" && path.endsWith("/admin/artist-applications")) {
    try {
      const decoded = requireAuth(event);
      requireAdmin(decoded);

      const r = await ddb.send(new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": "ARTIST#PENDING" },
        ScanIndexForward: true
      }));

      return resp(200, { items: r.Items || [] });
    } catch (e) {
      console.error("/admin/artist-applications failed:", e);
      if (String(e.message) === "NOT_ADMIN") return forbid("Admin only");
      return unauth("Invalid/expired token");
    }
  }

  // POST /admin/artist-applications/{sub}/approve
  if (method === "POST" && path.includes("/admin/artist-applications/") && path.endsWith("/approve")) {
    try {
      const decoded = requireAuth(event);
      requireAdmin(decoded);

      const sub = path.split("/admin/artist-applications/")[1]
        .split("/approve")[0]
        .replace(/\//g, "")
        .trim();

      if (!sub) return bad("Missing user sub");

      const pk = `USER#${sub}`;
      const u = await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { pk, sk: "PROFILE" },
        UpdateExpression: `
          SET #role = :artist,
              artistStatus = :approved,
              updatedAt = :u
          REMOVE gsi1pk, gsi1sk
        `,
        ExpressionAttributeNames: {
          "#role": "role",
        },
        ExpressionAttributeValues: {
          ":artist": "artist",
          ":approved": "approved",
          ":u": nowISO()
        },
        ReturnValues: "ALL_NEW"
      }));

      return resp(200, { user: u.Attributes });
    } catch (e) {
      console.error("APPROVE ERROR", e);
      if (String(e.message) === "NOT_ADMIN") return forbid("Admin only");
      return resp(500, { error: "Approve failed", detail: String(e?.message || e) });
    }
  }

  // POST /admin/artist-applications/{sub}/reject
  if (method === "POST" && path.includes("/admin/artist-applications/") && path.endsWith("/reject")) {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const reason = (body.reason || "").trim();

    try {
      const decoded = requireAuth(event);
      requireAdmin(decoded);

      const sub = path.split("/admin/artist-applications/")[1]
        .split("/reject")[0]
        .replace(/\//g, "")
        .trim();

      if (!sub) return bad("Missing user sub");

      const pk = `USER#${sub}`;
      const u = await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { pk, sk: "PROFILE" },
        UpdateExpression: `
          SET artistStatus = :rejected,
              artistRejectionReason = :r,
              updatedAt = :u
          REMOVE gsi1pk, gsi1sk
        `,
        ExpressionAttributeValues: {
          ":rejected": "rejected",
          ":r": reason || "Not approved",
          ":u": nowISO()
        },
        ReturnValues: "ALL_NEW"
      }));

      return resp(200, { user: u.Attributes });
    } catch (e) {
      console.error("REJECT ERROR", e);
      if (String(e.message) === "NOT_ADMIN") return forbid("Admin only");
      return resp(500, { error: "Reject failed", detail: String(e?.message || e) });
    }
  }

  return resp(404, { error: "Not found", path });
}
