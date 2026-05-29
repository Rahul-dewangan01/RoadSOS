import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";
import { z } from "zod";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const PORT = Number(process.env.PORT || 8080);
const DATABASE_PATH = process.env.DATABASE_PATH || "./roadsos.sqlite";
const app = express();
const db = new DatabaseSync(DATABASE_PATH);

app.use(helmet());
app.use(cors({ origin: process.env.APP_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

// ─── Routes ──────────────────────────────────────────────────────────────────

app.delete("/api/me/account", requireAuth, (req, res, next) => {
  try {
    const userId = req.user.id;
    // Delete all tokens and user data. Foreign keys with ON DELETE CASCADE will handle auth_tokens and user_data, but let's be explicit just in case.
    db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_data WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    res.json({ success: true, message: "Account completely deleted" });
  } catch (error) { next(error); }
});

// ─── Schema Setup ────────────────────────────────────────────────────────────

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    full_name   TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL UNIQUE,
    dob         TEXT NOT NULL DEFAULT '',
    gender      TEXT NOT NULL DEFAULT '',
    permanent_address TEXT NOT NULL DEFAULT '',
    temporary_address TEXT NOT NULL DEFAULT '',
    profile_image_base64 TEXT,
    provider    TEXT NOT NULL DEFAULT 'phone',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS otps (
    phone      TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_otps (
    email      TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS signup_sessions (
    session_id TEXT PRIMARY KEY,
    phone      TEXT NOT NULL,
    email      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_data (
    user_id    TEXT NOT NULL,
    data_key   TEXT NOT NULL,
    data_json  TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, data_key),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS emergency_services (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL,
    latitude       REAL NOT NULL,
    longitude      REAL NOT NULL,
    phone          TEXT NOT NULL DEFAULT '',
    address        TEXT NOT NULL DEFAULT '',
    operating_area TEXT NOT NULL DEFAULT '',
    last_updated   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS volunteer_profiles (
    user_id       TEXT PRIMARY KEY,
    full_name     TEXT NOT NULL DEFAULT '',
    age           INTEGER NOT NULL DEFAULT 0,
    gender        TEXT NOT NULL DEFAULT '',
    blood_group   TEXT NOT NULL DEFAULT '',
    skills        TEXT NOT NULL DEFAULT '',
    city_area     TEXT NOT NULL DEFAULT '',
    id_proof_type TEXT NOT NULL DEFAULT '',
    id_proof_ref  TEXT NOT NULL DEFAULT '',
    verified_at   INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS volunteer_status (
    user_id      TEXT PRIMARY KEY,
    mode_enabled INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'OFFLINE',
    latitude     REAL,
    longitude    REAL,
    current_request_id TEXT NOT NULL DEFAULT '',
    updated_at   INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS volunteer_alerts (
    id          TEXT PRIMARY KEY,
    victim_id   TEXT NOT NULL,
    volunteer_id TEXT NOT NULL,
    emergency_type TEXT NOT NULL DEFAULT '',
    details     TEXT NOT NULL DEFAULT '',
    approx_lat  REAL,
    approx_lng  REAL,
    status      TEXT NOT NULL DEFAULT 'NOTIFIED',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY(victim_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(volunteer_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Add missing columns for existing databases
try { db.exec("ALTER TABLE users ADD COLUMN dob TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN permanent_address TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN temporary_address TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN profile_image_base64 TEXT"); } catch (_) {}

importEmergencyDirectory();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "Enter a valid international phone number starting with + and country code (e.g., +14155552671)");

const emailSchema = z
  .string()
  .email("Enter a valid email address")
  .max(254);

const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD format")
  .refine((d) => {
    const date = new Date(d);
    if (isNaN(date.getTime())) return false;
    const now = new Date();
    const minAge = new Date(now.getFullYear() - 120, now.getMonth(), now.getDate());
    const maxAge = new Date(now.getFullYear() - 13, now.getMonth(), now.getDate());
    return date >= minAge && date <= maxAge;
  }, "You must be at least 13 years old and provide a valid date of birth");

const genderSchema = z
  .enum(["Male", "Female", "Non-binary", "Prefer not to say"], {
    errorMap: () => ({ message: "Gender must be one of: Male, Female, Non-binary, Prefer not to say" })
  });

const addressSchema = z.object({
  street: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  postalCode: z.string().optional().default(""),
  country: z.string().optional().default("")
});

const profileSchema = z.object({
  uid: z.string().optional().default(""),
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(100),
  phone: phoneSchema,
  email: emailSchema,
  dob: dobSchema,
  gender: genderSchema,
  permanentAddress: z.union([z.string(), addressSchema]).optional().default(""),
  temporaryAddress: z.union([z.string(), addressSchema]).optional().default(""),
  profileImageBase64: z.string().nullable().optional(),
  createdAt: z.number().optional()
});

const volunteerDetailsSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  age: z.coerce.number().int().min(18).max(100),
  gender: z.string().trim().min(1).max(40),
  bloodGroup: z.string().trim().max(8).optional().default(""),
  skillsExperience: z.string().trim().min(3).max(1000),
  cityArea: z.string().trim().min(2).max(160),
  idProofType: z.string().trim().max(80).optional().default(""),
  idProofReference: z.string().trim().max(120).optional().default(""),
  availabilityStatus: z.enum(["ONLINE", "OFFLINE", "BUSY"]).optional().default("OFFLINE"),
  verifiedAt: z.number().optional().default(0),
  lastLat: z.number().nullable().optional(),
  lastLng: z.number().nullable().optional(),
  updatedAt: z.number().optional()
});

const volunteerStatusSchema = z.object({
  modeEnabled: z.boolean(),
  status: z.enum(["ONLINE", "OFFLINE", "BUSY"]).optional().default("OFFLINE"),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional()
});

const volunteerAlertSchema = z.object({
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  emergencyType: z.string().trim().max(120).optional().default("Emergency"),
  details: z.string().trim().max(1000).optional().default("")
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now() { return Date.now(); }

function makeToken(userId) {
  const token = nanoid(48);
  db.prepare("INSERT INTO auth_tokens (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, now());
  return token;
}

function publicUser(row) {
  return {
    uid: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    dob: row.dob || "",
    gender: row.gender || "",
    permanentAddress: row.permanent_address || "",
    temporaryAddress: row.temporary_address || "",
    profileImageBase64: row.profile_image_base64 || null,
    createdAt: row.created_at
  };
}

function addressToStorage(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return [value.street, value.city, value.state, value.postalCode, value.country]
    .filter((part) => typeof part === "string" && part.trim())
    .map((part) => part.trim())
    .join(", ");
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function getUserByPhone(phone) {
  return db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
}

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = db.prepare("SELECT user_id FROM auth_tokens WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const user = getUserById(session.user_id);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  next();
}

function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join(", ");
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }
  return result.data;
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function shouldReturnDevOtp() {
  return process.env.DISABLE_DEV_OTP_AUTOFILL !== "true";
}

function getData(userId, key, fallback) {
  const row = db.prepare("SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?").get(userId, key);
  return row ? JSON.parse(row.data_json) : fallback;
}

function putData(userId, key, value) {
  db.prepare(`
    INSERT INTO user_data (user_id, data_key, data_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, data_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(userId, key, JSON.stringify(value), now());
}

function getVolunteerDetails(userId) {
  const row = db.prepare(`
    SELECT p.*, s.mode_enabled, s.status, s.latitude, s.longitude
    FROM volunteer_profiles p
    LEFT JOIN volunteer_status s ON s.user_id = p.user_id
    WHERE p.user_id = ?
  `).get(userId);
  if (!row) return null;
  return {
    fullName: row.full_name,
    age: row.age,
    gender: row.gender,
    bloodGroup: row.blood_group || "",
    skillsExperience: row.skills || "",
    cityArea: row.city_area || "",
    idProofType: row.id_proof_type || "",
    idProofReference: row.id_proof_ref ? "stored" : "",
    availabilityStatus: row.status || "OFFLINE",
    verifiedAt: row.verified_at || 0,
    lastLat: row.latitude ?? null,
    lastLng: row.longitude ?? null,
    updatedAt: row.updated_at
  };
}

function isVolunteerComplete(details) {
  return details && details.fullName?.trim().length >= 2 &&
    details.age >= 18 && details.age <= 100 &&
    details.gender?.trim() &&
    details.skillsExperience?.trim().length >= 3 &&
    details.cityArea?.trim().length >= 2;
}

function publicVolunteerService(row, lat, lng) {
  return {
    id: `volunteer_${row.user_id}`,
    name: row.full_name || "Road SoS Volunteer",
    category: "Volunteer",
    serviceType: "VOLUNTEER",
    distanceKm: Number(distanceKm(lat, lng, row.latitude, row.longitude).toFixed(2)),
    phone: "",
    address: row.city_area || "Approximate nearby area",
    lat: roundApprox(row.latitude),
    lng: roundApprox(row.longitude),
    source: "roadsos_volunteers",
    isOfflineFallback: false
  };
}

function roundApprox(value) {
  return typeof value === "number" ? Number(value.toFixed(3)) : 0;
}

function findNearbyActiveVolunteers(lat, lng, radiusKm = 8, excludeUserId = "") {
  if (typeof lat !== "number" || typeof lng !== "number") return [];
  return db.prepare(`
    SELECT p.user_id, p.full_name, p.city_area, p.skills, s.latitude, s.longitude
    FROM volunteer_profiles p
    JOIN volunteer_status s ON s.user_id = p.user_id
    WHERE s.mode_enabled = 1
      AND s.status = 'ONLINE'
      AND s.latitude IS NOT NULL
      AND s.longitude IS NOT NULL
      AND p.user_id != ?
  `).all(excludeUserId)
    .map((row) => ({ ...row, distanceKm: distanceKm(lat, lng, row.latitude, row.longitude) }))
    .filter((row) => row.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "roadsos-backend" });
});

// STEP 1 of Signup: Request phone + email OTPs
// The client sends phone + email. We check they are not already taken, then issue OTPs.
app.post("/api/auth/request-signup-otp", (req, res, next) => {
  try {
    const body = parseBody(z.object({ phone: phoneSchema, email: emailSchema }), req.body);

    // Strict uniqueness check: no two accounts can share a phone or email
    if (getUserByPhone(body.phone)) {
      return res.status(409).json({ error: "This phone number is already registered. Please log in." });
    }
    if (getUserByEmail(body.email)) {
      return res.status(409).json({ error: "This email address is already registered. Please log in or use a different email." });
    }

    const phoneCode = generateOtp();
    const emailCode = generateOtp();
    const expiresAt = now() + 10 * 60 * 1000; // 10 minutes

    // Store phone OTP
    db.prepare(`
      INSERT INTO otps (phone, code, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
    `).run(body.phone, phoneCode, expiresAt);

    // Store email OTP
    db.prepare(`
      INSERT INTO email_otps (email, code, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
    `).run(body.email, emailCode, expiresAt);

    // Production hooks:
    // - Send phoneCode via Twilio SMS to body.phone
    // - Send emailCode via Nodemailer/SendGrid to body.email

    const isDev = shouldReturnDevOtp();
    res.json({
      ok: true,
      devPhoneOtp: isDev ? phoneCode : undefined,
      devEmailOtp: isDev ? emailCode : undefined
    });
  } catch (error) {
    next(error);
  }
});

// STEP 2 of Signup: Verify OTPs + Create Account
app.post("/api/auth/signup", (req, res, next) => {
  try {
    const body = parseBody(z.object({
      profile: profileSchema,
      phoneOtp: z.string().length(6, "Phone OTP must be 6 digits"),
      emailOtp: z.string().length(6, "Email OTP must be 6 digits"),
      documents: z.any().optional(),
      medical: z.any().optional()
    }), req.body);

    const profile = body.profile;

    // Re-check uniqueness (race condition protection)
    if (getUserByPhone(profile.phone)) {
      return res.status(409).json({ error: "This phone number is already registered." });
    }
    if (getUserByEmail(profile.email)) {
      return res.status(409).json({ error: "This email address is already registered." });
    }

    // Verify phone OTP
    const phoneOtpRow = db.prepare("SELECT * FROM otps WHERE phone = ?").get(profile.phone);
    if (!phoneOtpRow || phoneOtpRow.code !== body.phoneOtp || phoneOtpRow.expires_at < now()) {
      return res.status(401).json({ error: "Invalid or expired phone OTP. Please request a new one." });
    }

    // Verify email OTP
    const emailOtpRow = db.prepare("SELECT * FROM email_otps WHERE email = ?").get(profile.email);
    if (!emailOtpRow || emailOtpRow.code !== body.emailOtp || emailOtpRow.expires_at < now()) {
      return res.status(401).json({ error: "Invalid or expired email OTP. Please request a new one." });
    }

    // Consume OTPs
    db.prepare("DELETE FROM otps WHERE phone = ?").run(profile.phone);
    db.prepare("DELETE FROM email_otps WHERE email = ?").run(profile.email);

    // Create new user (no upsert — strict new user only)
    const ts = now();
    const id = profile.uid?.trim() || nanoid(24);
    const permanentAddress = addressToStorage(profile.permanentAddress);
    const temporaryAddress = addressToStorage(profile.temporaryAddress);
    const profileImageBase64 = profile.profileImageBase64 ?? null;
    db.prepare(`
      INSERT INTO users (id, full_name, phone, email, dob, gender, permanent_address, temporary_address, profile_image_base64, provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'phone', ?, ?)
    `).run(id, profile.fullName, profile.phone, profile.email, profile.dob, profile.gender, permanentAddress, temporaryAddress, profileImageBase64, profile.createdAt || ts, ts);

    const user = getUserById(id);
    const token = makeToken(user.id);

    if (body.documents) putData(user.id, "documents", body.documents);
    if (body.medical) putData(user.id, "medical", body.medical);

    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

// Login Step 1: Request OTP (existing users only)
app.post("/api/auth/request-otp", (req, res, next) => {
  try {
    const { phone } = parseBody(z.object({ phone: phoneSchema }), req.body);
    const user = getUserByPhone(phone);
    if (!user) {
      return res.status(404).json({ error: "No Road SoS account exists for this phone number. Please sign up first." });
    }

    const code = generateOtp();
    db.prepare(`
      INSERT INTO otps (phone, code, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
    `).run(phone, code, now() + 5 * 60 * 1000);

    // Production hook: send code via Twilio Verify
    const isDev = shouldReturnDevOtp();
    res.json({ ok: true, devOtp: isDev ? code : undefined });
  } catch (error) {
    next(error);
  }
});

// Login Step 2: Verify OTP
app.post("/api/auth/verify-otp", (req, res, next) => {
  try {
    const { phone, otp } = parseBody(z.object({ phone: phoneSchema, otp: z.string().min(4).max(8) }), req.body);
    const row = db.prepare("SELECT * FROM otps WHERE phone = ?").get(phone);
    if (!row || row.code !== otp || row.expires_at < now()) {
      return res.status(401).json({ error: "Invalid or expired OTP" });
    }
    const user = getUserByPhone(phone);
    if (!user) return res.status(404).json({ error: "Account not found" });
    db.prepare("DELETE FROM otps WHERE phone = ?").run(phone);
    res.json({ token: makeToken(user.id), user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

// Google sign-in (for existing accounts linked by Google)
app.post("/api/auth/google", (req, res, next) => {
  try {
    const body = parseBody(z.object({
      fullName: z.string().trim().min(1),
      phone: phoneSchema,
      email: emailSchema,
      googleIdToken: z.string().optional()
    }), req.body);
    // Production hook: verify body.googleIdToken against GOOGLE_CLIENT_ID here.

    // Check if user exists; if so, log in. Otherwise, reject (require full signup).
    const existingByPhone = getUserByPhone(body.phone);
    const existingByEmail = getUserByEmail(body.email);
    const existing = existingByPhone || existingByEmail;
    if (!existing) {
      return res.status(404).json({ error: "No account found. Please sign up first." });
    }
    res.json({ token: makeToken(existing.id), user: publicUser(existing) });
  } catch (error) {
    next(error);
  }
});

// Profile endpoints
app.get("/api/me/profile", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

app.put("/api/me/profile", requireAuth, (req, res, next) => {
  try {
    const profile = parseBody(profileSchema, req.body);
    const ts = now();

    // Check uniqueness when updating (allow same user's own phone/email)
    const phoneUser = getUserByPhone(profile.phone);
    if (phoneUser && phoneUser.id !== req.user.id) {
      return res.status(409).json({ error: "This phone number belongs to another account." });
    }
    const emailUser = getUserByEmail(profile.email);
    if (emailUser && emailUser.id !== req.user.id) {
      return res.status(409).json({ error: "This email address belongs to another account." });
    }

    db.prepare(`
      UPDATE users SET full_name = ?, phone = ?, email = ?, dob = ?, gender = ?, permanent_address = ?, temporary_address = ?, profile_image_base64 = ?, updated_at = ? WHERE id = ?
    `).run(
      profile.fullName,
      profile.phone,
      profile.email,
      profile.dob,
      profile.gender,
      addressToStorage(profile.permanentAddress),
      addressToStorage(profile.temporaryAddress),
      profile.profileImageBase64 ?? null,
      ts,
      req.user.id
    );

    res.json(publicUser(getUserById(req.user.id)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/me/volunteer", requireAuth, (req, res) => {
  res.json(getVolunteerDetails(req.user.id) || {});
});

app.put("/api/me/volunteer", requireAuth, (req, res, next) => {
  try {
    const details = parseBody(volunteerDetailsSchema, req.body);
    const ts = now();
    db.prepare(`
      INSERT INTO volunteer_profiles
        (user_id, full_name, age, gender, blood_group, skills, city_area, id_proof_type, id_proof_ref, verified_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        full_name = excluded.full_name,
        age = excluded.age,
        gender = excluded.gender,
        blood_group = excluded.blood_group,
        skills = excluded.skills,
        city_area = excluded.city_area,
        id_proof_type = excluded.id_proof_type,
        id_proof_ref = excluded.id_proof_ref,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at
    `).run(
      req.user.id,
      details.fullName,
      details.age,
      details.gender,
      details.bloodGroup || "",
      details.skillsExperience,
      details.cityArea,
      details.idProofType || "",
      details.idProofReference || "",
      details.verifiedAt || ts,
      ts
    );
    db.prepare(`
      INSERT INTO volunteer_status (user_id, mode_enabled, status, latitude, longitude, updated_at)
      VALUES (?, 0, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        status = excluded.status,
        latitude = COALESCE(excluded.latitude, volunteer_status.latitude),
        longitude = COALESCE(excluded.longitude, volunteer_status.longitude),
        updated_at = excluded.updated_at
    `).run(req.user.id, details.availabilityStatus || "OFFLINE", details.lastLat ?? null, details.lastLng ?? null, ts);
    res.json({ ok: true, modeEnabled: false, status: details.availabilityStatus || "OFFLINE", detailsComplete: true, details: getVolunteerDetails(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/me/volunteer/status", requireAuth, (req, res, next) => {
  try {
    const body = parseBody(volunteerStatusSchema, req.body);
    const details = getVolunteerDetails(req.user.id);
    if (body.modeEnabled && !isVolunteerComplete(details)) {
      return res.status(409).json({ error: "Volunteer verification is required before enabling volunteer mode." });
    }
    const status = body.modeEnabled ? body.status : "OFFLINE";
    db.prepare(`
      INSERT INTO volunteer_status (user_id, mode_enabled, status, latitude, longitude, current_request_id, updated_at)
      VALUES (?, ?, ?, ?, ?, '', ?)
      ON CONFLICT(user_id) DO UPDATE SET
        mode_enabled = excluded.mode_enabled,
        status = excluded.status,
        latitude = COALESCE(excluded.latitude, volunteer_status.latitude),
        longitude = COALESCE(excluded.longitude, volunteer_status.longitude),
        current_request_id = CASE WHEN excluded.status = 'ONLINE' THEN '' ELSE volunteer_status.current_request_id END,
        updated_at = excluded.updated_at
    `).run(req.user.id, body.modeEnabled ? 1 : 0, status, body.lat ?? null, body.lng ?? null, now());
    putData(req.user.id, "settings", { ...getData(req.user.id, "settings", {}), volunteer_mode: body.modeEnabled, volunteer_availability: status });
    res.json({ ok: true, modeEnabled: body.modeEnabled, status, detailsComplete: !!details, details: getVolunteerDetails(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me/volunteer/alerts", requireAuth, (req, res, next) => {
  try {
    const alerts = db.prepare(`
      SELECT id, emergency_type, details, approx_lat, approx_lng, status, created_at
      FROM volunteer_alerts
      WHERE volunteer_id = ? AND status = 'NOTIFIED'
      ORDER BY created_at DESC
      LIMIT 5
    `).all(req.user.id).map((row) => ({
      requestId: row.id.split("_")[0],
      alertId: row.id,
      emergencyType: row.emergency_type,
      details: row.details,
      approxLat: row.approx_lat,
      approxLng: row.approx_lng,
      status: row.status,
      createdAt: row.created_at
    }));
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

app.post("/api/volunteer-alerts", requireAuth, (req, res, next) => {
  try {
    const body = parseBody(volunteerAlertSchema, req.body);
    if (typeof body.lat !== "number" || typeof body.lng !== "number") {
      return res.json({ ok: true, requestId: "", notifiedCount: 0, volunteers: [], message: "GPS Required: volunteer matching paused safely." });
    }
    const volunteers = findNearbyActiveVolunteers(body.lat, body.lng, 8, req.user.id);
    if (volunteers.length === 0) {
      return res.json({ ok: true, requestId: "", notifiedCount: 0, volunteers: [], message: "No nearby volunteers are online right now." });
    }
    const requestGroupId = nanoid(18);
    const ts = now();
    const stmt = db.prepare(`
      INSERT INTO volunteer_alerts (id, victim_id, volunteer_id, emergency_type, details, approx_lat, approx_lng, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'NOTIFIED', ?, ?)
    `);
    for (const volunteer of volunteers) {
      stmt.run(`${requestGroupId}_${volunteer.user_id}`, req.user.id, volunteer.user_id, body.emergencyType, body.details, roundApprox(body.lat), roundApprox(body.lng), ts, ts);
    }
    res.json({
      ok: true,
      requestId: requestGroupId,
      notifiedCount: volunteers.length,
      volunteers: volunteers.map((v) => publicVolunteerService(v, body.lat, body.lng)),
      message: "Nearby Volunteers Notified"
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/volunteer-alerts/:requestId/accept", requireAuth, (req, res, next) => {
  try {
    const alertId = `${req.params.requestId}_${req.user.id}`;
    const alert = db.prepare("SELECT * FROM volunteer_alerts WHERE id = ? AND volunteer_id = ?").get(alertId, req.user.id);
    if (!alert) return res.status(404).json({ error: "Volunteer request not found." });
    const ts = now();
    db.prepare("UPDATE volunteer_alerts SET status = 'ACCEPTED', updated_at = ? WHERE id = ?").run(ts, alert.id);
    db.prepare(`
      INSERT INTO volunteer_status (user_id, mode_enabled, status, current_request_id, updated_at)
      VALUES (?, 1, 'BUSY', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET status = 'BUSY', current_request_id = excluded.current_request_id, updated_at = excluded.updated_at
    `).run(req.user.id, alert.id, ts);
    res.json({ ok: true, modeEnabled: true, status: "BUSY", detailsComplete: true, details: getVolunteerDetails(req.user.id) });
  } catch (error) {
    next(error);
  }
});

// ─── Global Emergency Numbers Dataset ─────────────────────────────────────────

const UNIVERSAL_FALLBACK = {
  countryCode: "XX",
  countryName: "Unknown",
  numbers: [
    { name: "All-in-one Emergency", phone: "112", serviceType: "EMERGENCY_NUMBER", category: "Emergency" },
    { name: "Police", phone: "100", serviceType: "EMERGENCY_NUMBER", category: "Police" },
    { name: "Fire", phone: "101", serviceType: "EMERGENCY_NUMBER", category: "Fire" },
    { name: "Ambulance", phone: "108", serviceType: "EMERGENCY_NUMBER", category: "Ambulance" },
    { name: "Road Accident / Highway", phone: "1033", serviceType: "EMERGENCY_NUMBER", category: "Highway" },
    { name: "Disaster Management", phone: "1078", serviceType: "EMERGENCY_NUMBER", category: "Disaster" },
    { name: "Women Helpline", phone: "1091", serviceType: "EMERGENCY_NUMBER", category: "Women" },
    { name: "Women Domestic Abuse", phone: "181", serviceType: "EMERGENCY_NUMBER", category: "Women" },
    { name: "Child Helpline", phone: "1098", serviceType: "EMERGENCY_NUMBER", category: "Child" },
    { name: "Railway Enquiry", phone: "139", serviceType: "EMERGENCY_NUMBER", category: "Railway" },
    { name: "Railway Accident Emergency", phone: "1072", serviceType: "EMERGENCY_NUMBER", category: "Railway" },
    { name: "Senior Citizen Helpline", phone: "14567", serviceType: "EMERGENCY_NUMBER", category: "Senior Citizen" }
  ]
};

const GLOBAL_EMERGENCY_NUMBERS = {
  IN: { countryCode: "IN", countryName: "India", numbers: [
    { name: "All-in-one Emergency", phone: "112", serviceType: "EMERGENCY_NUMBER", category: "Emergency" },
    { name: "Police", phone: "100", serviceType: "EMERGENCY_NUMBER", category: "Police" },
    { name: "Fire", phone: "101", serviceType: "EMERGENCY_NUMBER", category: "Fire" },
    { name: "Ambulance", phone: "108", serviceType: "EMERGENCY_NUMBER", category: "Ambulance" },
    { name: "Road Accident / Highway", phone: "1033", serviceType: "EMERGENCY_NUMBER", category: "Highway" },
    { name: "Disaster Management", phone: "1078", serviceType: "EMERGENCY_NUMBER", category: "Disaster" },
    { name: "Women Helpline", phone: "1091", serviceType: "EMERGENCY_NUMBER", category: "Women" },
    { name: "Women Domestic Abuse", phone: "181", serviceType: "EMERGENCY_NUMBER", category: "Women" },
    { name: "Child Helpline", phone: "1098", serviceType: "EMERGENCY_NUMBER", category: "Child" },
    { name: "Railway Enquiry", phone: "139", serviceType: "EMERGENCY_NUMBER", category: "Railway" },
    { name: "Railway Accident Emergency", phone: "1072", serviceType: "EMERGENCY_NUMBER", category: "Railway" },
    { name: "Senior Citizen Helpline", phone: "14567", serviceType: "EMERGENCY_NUMBER", category: "Senior Citizen" }
  ]},
  US: { countryCode: "US", countryName: "United States", numbers: [
    { name: "Emergency", phone: "911", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Poison Control", phone: "1-800-222-1222", serviceType: "HOSPITAL", category: "Hospital" },
    { name: "Roadside Assistance (AAA)", phone: "1-800-222-4357", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  GB: { countryCode: "GB", countryName: "United Kingdom", numbers: [
    { name: "Emergency", phone: "999", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Non-Emergency Police", phone: "101", serviceType: "POLICE", category: "Police Station" },
    { name: "NHS Helpline", phone: "111", serviceType: "HOSPITAL", category: "Hospital" }
  ]},
  AU: { countryCode: "AU", countryName: "Australia", numbers: [
    { name: "Emergency", phone: "000", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police Assistance", phone: "131444", serviceType: "POLICE", category: "Police Station" },
    { name: "Roadside Assistance (NRMA)", phone: "131111", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  CA: { countryCode: "CA", countryName: "Canada", numbers: [
    { name: "Emergency", phone: "911", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Poison Control", phone: "1-844-764-7669", serviceType: "HOSPITAL", category: "Hospital" }
  ]},
  DE: { countryCode: "DE", countryName: "Germany", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "110", serviceType: "POLICE", category: "Police Station" },
    { name: "ADAC Roadside", phone: "222222", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  FR: { countryCode: "FR", countryName: "France", numbers: [
    { name: "SAMU (Medical)", phone: "15", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Police", phone: "17", serviceType: "POLICE", category: "Police Station" },
    { name: "Fire", phone: "18", serviceType: "FIRE_STATION", category: "Fire Station" },
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" }
  ]},
  JP: { countryCode: "JP", countryName: "Japan", numbers: [
    { name: "Police", phone: "110", serviceType: "POLICE", category: "Police Station" },
    { name: "Fire / Ambulance", phone: "119", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "JAF Roadside", phone: "#8139", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  BR: { countryCode: "BR", countryName: "Brazil", numbers: [
    { name: "Police", phone: "190", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance (SAMU)", phone: "192", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "193", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  ZA: { countryCode: "ZA", countryName: "South Africa", numbers: [
    { name: "Emergency", phone: "10111", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Ambulance", phone: "10177", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "AA Roadside", phone: "0861000234", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  AE: { countryCode: "AE", countryName: "United Arab Emirates", numbers: [
    { name: "Police", phone: "999", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "998", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "997", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  SG: { countryCode: "SG", countryName: "Singapore", numbers: [
    { name: "Police", phone: "999", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance / Fire", phone: "995", serviceType: "AMBULANCE", category: "Ambulance" }
  ]},
  MY: { countryCode: "MY", countryName: "Malaysia", numbers: [
    { name: "Emergency", phone: "999", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "112", serviceType: "POLICE", category: "Police Station" },
    { name: "Fire / Ambulance", phone: "994", serviceType: "AMBULANCE", category: "Ambulance" }
  ]},
  PH: { countryCode: "PH", countryName: "Philippines", numbers: [
    { name: "Emergency", phone: "911", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Red Cross", phone: "143", serviceType: "AMBULANCE", category: "Ambulance" }
  ]},
  TH: { countryCode: "TH", countryName: "Thailand", numbers: [
    { name: "Police", phone: "191", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "1669", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "199", serviceType: "FIRE_STATION", category: "Fire Station" },
    { name: "Tourist Police", phone: "1155", serviceType: "POLICE", category: "Police Station" }
  ]},
  ID: { countryCode: "ID", countryName: "Indonesia", numbers: [
    { name: "Police", phone: "110", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "118", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "113", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  NZ: { countryCode: "NZ", countryName: "New Zealand", numbers: [
    { name: "Emergency", phone: "111", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "AA Roadside", phone: "0800500222", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  KR: { countryCode: "KR", countryName: "South Korea", numbers: [
    { name: "Police", phone: "112", serviceType: "POLICE", category: "Police Station" },
    { name: "Fire / Ambulance", phone: "119", serviceType: "AMBULANCE", category: "Ambulance" }
  ]},
  CN: { countryCode: "CN", countryName: "China", numbers: [
    { name: "Police", phone: "110", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "120", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "119", serviceType: "FIRE_STATION", category: "Fire Station" },
    { name: "Traffic Accident", phone: "122", serviceType: "POLICE", category: "Police Station" }
  ]},
  RU: { countryCode: "RU", countryName: "Russia", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "102", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "103", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "101", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  MX: { countryCode: "MX", countryName: "Mexico", numbers: [
    { name: "Emergency", phone: "911", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Red Cross", phone: "065", serviceType: "AMBULANCE", category: "Ambulance" }
  ]},
  IT: { countryCode: "IT", countryName: "Italy", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "113", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "118", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "115", serviceType: "FIRE_STATION", category: "Fire Station" },
    { name: "ACI Roadside", phone: "803116", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  ES: { countryCode: "ES", countryName: "Spain", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "091", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "061", serviceType: "AMBULANCE", category: "Ambulance" }
  ]},
  NL: { countryCode: "NL", countryName: "Netherlands", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "ANWB Roadside", phone: "088-2692888", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  SE: { countryCode: "SE", countryName: "Sweden", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Assistancekåren Roadside", phone: "020-912912", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  NO: { countryCode: "NO", countryName: "Norway", numbers: [
    { name: "Police", phone: "112", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "113", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "110", serviceType: "FIRE_STATION", category: "Fire Station" },
    { name: "NAF Roadside", phone: "23218500", serviceType: "TOW_SERVICE", category: "Tow Service" }
  ]},
  PL: { countryCode: "PL", countryName: "Poland", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "997", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "999", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "998", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  TR: { countryCode: "TR", countryName: "Turkey", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "155", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "112", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "110", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  SA: { countryCode: "SA", countryName: "Saudi Arabia", numbers: [
    { name: "Emergency", phone: "911", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "999", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "997", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "998", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  EG: { countryCode: "EG", countryName: "Egypt", numbers: [
    { name: "Police", phone: "122", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "123", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "180", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  KE: { countryCode: "KE", countryName: "Kenya", numbers: [
    { name: "Emergency", phone: "999", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Ambulance (St John)", phone: "0800723253", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Police", phone: "112", serviceType: "POLICE", category: "Police Station" }
  ]},
  NG: { countryCode: "NG", countryName: "Nigeria", numbers: [
    { name: "Emergency", phone: "112", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "199", serviceType: "POLICE", category: "Police Station" },
    { name: "Fire", phone: "190", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  BD: { countryCode: "BD", countryName: "Bangladesh", numbers: [
    { name: "Emergency", phone: "999", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Fire", phone: "199", serviceType: "FIRE_STATION", category: "Fire Station" },
    { name: "Ambulance", phone: "199", serviceType: "AMBULANCE", category: "Ambulance" }
  ]},
  PK: { countryCode: "PK", countryName: "Pakistan", numbers: [
    { name: "Emergency (Rescue)", phone: "1122", serviceType: "EMERGENCY", category: "Emergency" },
    { name: "Police", phone: "15", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance (Edhi)", phone: "115", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "16", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]},
  LK: { countryCode: "LK", countryName: "Sri Lanka", numbers: [
    { name: "Police", phone: "119", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "1990", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "110", serviceType: "FIRE_STATION", category: "Fire Station" },
    { name: "Accident Service", phone: "011-2691111", serviceType: "HOSPITAL", category: "Hospital" }
  ]},
  NP: { countryCode: "NP", countryName: "Nepal", numbers: [
    { name: "Police", phone: "100", serviceType: "POLICE", category: "Police Station" },
    { name: "Ambulance", phone: "102", serviceType: "AMBULANCE", category: "Ambulance" },
    { name: "Fire", phone: "101", serviceType: "FIRE_STATION", category: "Fire Station" }
  ]}
};

// ─── GPS → Country Resolver ───────────────────────────────────────────────────

const countryCache = new Map();

async function resolveCountryFromGps(lat, lng) {
  const key = `${Number(lat).toFixed(1)},${Number(lng).toFixed(1)}`;
  if (countryCache.has(key)) return countryCache.get(key);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3&addressdetails=1`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "RoadSOS-Backend/1.0" }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const code = data.address?.country_code?.toUpperCase() || null;
    if (code) {
      const result = { countryCode: code, countryName: data.address?.country || code };
      countryCache.set(key, result);
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Nearby Emergency Cache & Endpoint ────────────────────────────────────────

const nearbyCache = new Map();
const CACHE_FRESH_MS = 15 * 60 * 1000;
const CACHE_STALE_MS = 60 * 60 * 1000;
const pendingRefreshes = new Set();

function getCacheKey(lat, lng) {
  return `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
}

function makeNearbyResponse(overrides = {}) {
  return {
    success: true,
    source: "fallback",
    countryCode: "",
    countryName: "",
    services: [],
    emergencyNumbers: UNIVERSAL_FALLBACK.numbers,
    cached: false,
    stale: false,
    message: "",
    ...overrides
  };
}

function groupTopPerCategory(results, perCategory = 5) {
  const grouped = {};
  for (const item of results) {
    const key = item.serviceType || item.category;
    if (!grouped[key]) grouped[key] = [];
    if (grouped[key].length < perCategory) grouped[key].push(item);
  }
  return Object.values(grouped).flat();
}

function withVolunteerServices(services, lat, lng, requestedType = "", excludeUserId = "") {
  if (requestedType && requestedType !== "VOLUNTEER") return services;
  const volunteers = findNearbyActiveVolunteers(lat, lng, 8, excludeUserId)
    .map((row) => publicVolunteerService(row, lat, lng));
  return [...services, ...volunteers];
}

function normalizeServiceType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const allowed = new Set([
    "HOSPITAL", "TRAUMA_CENTER", "POLICE", "FIRE_STATION", "AMBULANCE",
    "TOW_SERVICE", "PUNCTURE_SHOP", "SHOWROOM", "PETROL_PUMP",
    "MOBILE_REPAIR", "VOLUNTEER"
  ]);
  return allowed.has(normalized) ? normalized : "";
}

function filterByServiceType(items, serviceType) {
  if (!serviceType) return items;
  return items.filter((item) => normalizeServiceType(item.serviceType) === serviceType);
}

function pageServices(items, offset, limit) {
  return items.slice(offset, offset + limit);
}

app.get("/api/nearby-emergency", async (req, res) => {
  try {
    const { lat, lng } = parseBody(z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      serviceType: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(8).optional(),
      offset: z.coerce.number().int().min(0).max(50).optional()
    }), req.query);
    const radiusMeters = Math.min(Number(req.query.radiusMeters || 8000), 15000);
    const requestedType = normalizeServiceType(req.query.serviceType || "");
    const limit = Number(req.query.limit || (requestedType ? 5 : 25));
    const offset = Number(req.query.offset || 0);
    const cacheKey = `${getCacheKey(lat, lng)}:${requestedType || "ALL"}`;
    const cached = nearbyCache.get(cacheKey);
    const nowMs = Date.now();

    const countryInfo = await resolveCountryFromGps(lat, lng);
    const countryCode = countryInfo?.countryCode || "";
    const countryName = countryInfo?.countryName || "";
    const emergencyEntry = GLOBAL_EMERGENCY_NUMBERS[countryCode] || UNIVERSAL_FALLBACK;
    const emergencyNumbers = emergencyEntry.numbers;

    const base = { countryCode, countryName, emergencyNumbers };

    if (cached && (nowMs - cached.timestamp < CACHE_FRESH_MS)) {
      fireBackgroundRefresh(lat, lng, radiusMeters, cacheKey);
      return res.json(makeNearbyResponse({
        ...base,
        source: cached.source,
        services: withVolunteerServices(pageServices(groupTopPerCategory(filterByServiceType(cached.data, requestedType)), offset, limit), lat, lng, requestedType),
        cached: true,
        stale: false,
        message: "Fresh cache hit"
      }));
    }

    if (cached && (nowMs - cached.timestamp < CACHE_STALE_MS)) {
      fireBackgroundRefresh(lat, lng, radiusMeters, cacheKey);
      return res.json(makeNearbyResponse({
        ...base,
        source: cached.source,
        services: withVolunteerServices(pageServices(groupTopPerCategory(filterByServiceType(cached.data, requestedType)), offset, limit), lat, lng, requestedType),
        cached: true,
        stale: true,
        message: "Stale cache returned, background refresh started"
      }));
    }

    const liveResult = await fetchLiveWithTimeout(lat, lng, radiusMeters, 6000, requestedType);
    if (liveResult && liveResult.data.length > 0) {
      nearbyCache.set(cacheKey, { timestamp: Date.now(), data: liveResult.data, source: liveResult.source });
      const limited = pageServices(groupTopPerCategory(filterByServiceType(liveResult.data, requestedType)), offset, limit);
      return res.json(makeNearbyResponse({
        ...base,
        source: liveResult.source,
        services: withVolunteerServices(limited, lat, lng, requestedType),
        cached: false,
        stale: false,
        message: `Live data from ${liveResult.source}`
      }));
    }

    const dbResults = filterByServiceType(searchStoredEmergencyServices(lat, lng, radiusMeters), requestedType);
    if (dbResults.length > 0) {
      nearbyCache.set(cacheKey, { timestamp: Date.now(), data: dbResults, source: "seeded" });
      return res.json(makeNearbyResponse({
        ...base,
        source: "seeded",
        services: withVolunteerServices(pageServices(groupTopPerCategory(dbResults), offset, limit), lat, lng, requestedType),
        cached: false,
        stale: false,
        message: "Returned stored directory results"
      }));
    }

    return res.json(makeNearbyResponse({
      ...base,
      source: "fallback",
      services: withVolunteerServices([], lat, lng, requestedType),
      cached: false,
      stale: false,
      message: "No nearby services found. Emergency numbers provided."
    }));
  } catch (error) {
    console.error("Nearby endpoint error:", error.message);
    const emergencyNumbers = UNIVERSAL_FALLBACK.numbers;
    return res.json(makeNearbyResponse({
      success: true,
      source: "fallback",
      services: [],
      emergencyNumbers,
      message: "Lookup failed, emergency numbers provided"
    }));
  }
});

async function fetchLiveWithTimeout(lat, lng, radiusMeters, timeoutMs, serviceType = "") {
  try {
    const result = await Promise.race([
      fetchLiveEmergencyData(lat, lng, radiusMeters, serviceType),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))
    ]);
    return result;
  } catch {
    return null;
  }
}

async function fetchLiveEmergencyData(lat, lng, radiusMeters, serviceType = "") {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const results = await searchGoogleEmergencyPlaces(lat, lng, radiusMeters, serviceType);
      if (results.length > 0) return { source: "google", data: results };
    } catch (e) {
      console.error("Google Places failed:", e.message);
    }
  }

  try {
    const results = await searchOverpassEmergencyPlaces(lat, lng, radiusMeters, serviceType);
    if (results.length > 0) return { source: "osm", data: results };
  } catch (e) {
    console.error("Overpass failed:", e.message);
  }

  return { source: "fallback", data: [] };
}

function fireBackgroundRefresh(lat, lng, radiusMeters, cacheKey) {
  if (pendingRefreshes.has(cacheKey)) return;
  pendingRefreshes.add(cacheKey);
  fetchLiveEmergencyData(lat, lng, radiusMeters, "")
    .then((result) => {
      if (result && result.data.length > 0) {
        nearbyCache.set(cacheKey, { timestamp: Date.now(), data: result.data, source: result.source });
      }
    })
    .catch((err) => console.error("Background refresh failed:", err.message))
    .finally(() => pendingRefreshes.delete(cacheKey));
}

// ─── User Data & Error Handler ────────────────────────────────────────────────

for (const key of ["documents", "medical", "contacts", "sessions", "settings"]) {
  app.get(`/api/me/${key}`, requireAuth, (req, res) => {
    res.json(getData(req.user.id, key, key === "contacts" || key === "sessions" ? [] : {}));
  });

  app.put(`/api/me/${key}`, requireAuth, (req, res) => {
    putData(req.user.id, key, req.body);
    res.json({ ok: true });
  });
}

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  res.status(status).json({ error: error.message || "Server error" });
});

// ─── Emergency Lookup Helpers ─────────────────────────────────────────────────

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (n) => n * Math.PI / 180;
  const earth = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const CATEGORY_SERVICE_TYPE = {
  "Hospital": "HOSPITAL",
  "Trauma Center": "TRAUMA_CENTER",
  "Police Station": "POLICE",
  "Fire Station": "FIRE_STATION",
  "Ambulance": "AMBULANCE",
  "Tow Service": "TOW_SERVICE",
  "Vehicle Rescue": "TOW_SERVICE",
  "Mechanic": "TOW_SERVICE",
  "Puncture Shop": "PUNCTURE_SHOP",
  "Showroom": "SHOWROOM",
  "Petrol Pump": "PETROL_PUMP",
  "Mobile Store / Repair": "MOBILE_REPAIR",
  "Pharmacy": "OTHER"
};

function addServiceType(items) {
  return items.map((item) => ({
    ...item,
    serviceType: CATEGORY_SERVICE_TYPE[item.category] || "OTHER"
  }));
}

async function searchGoogleEmergencyPlaces(lat, lng, radiusMeters, serviceType = "") {
  const queries = [
    ["Hospital", "hospital near me", "HOSPITAL"],
    ["Trauma Center", "trauma center emergency hospital", "TRAUMA_CENTER"],
    ["Police Station", "police station", "POLICE"],
    ["Fire Station", "fire station", "FIRE_STATION"],
    ["Ambulance", "ambulance station", "AMBULANCE"],
    ["Tow Service", "vehicle rescue towing service roadside assistance", "TOW_SERVICE"],
    ["Puncture Shop", "tyre repair puncture shop", "PUNCTURE_SHOP"],
    ["Showroom", "car dealership showroom", "SHOWROOM"],
    ["Petrol Pump", "petrol pump fuel station", "PETROL_PUMP"],
    ["Mobile Store / Repair", "mobile phone repair store", "MOBILE_REPAIR"]
  ].filter(([, , type]) => !serviceType || type === serviceType);
  const all = [];
  for (const [category, textQuery] of queries) {
    try {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.nationalPhoneNumber"
        },
        body: JSON.stringify({
          textQuery,
          maxResultCount: 5,
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: radiusMeters
            }
          }
        })
      });
      if (!response.ok) continue;
      const json = await response.json();
      for (const place of json.places || []) {
        const pLat = place.location?.latitude;
        const pLng = place.location?.longitude;
        if (typeof pLat !== "number" || typeof pLng !== "number") continue;
        all.push({
          id: place.id,
          name: place.displayName?.text || "Emergency service",
          category,
          distanceKm: Number(distanceKm(lat, lng, pLat, pLng).toFixed(2)),
          phone: place.internationalPhoneNumber || place.nationalPhoneNumber || "",
          address: place.formattedAddress || "",
          lat: pLat,
          lng: pLng,
          source: "google_places"
        });
      }
    } catch (queryError) {
      console.error(`Google Places query failed for ${category}:`, queryError.message);
    }
  }
  return addServiceType(uniqueByNameAndDistance(all).sort((a, b) => a.distanceKm - b.distanceKm));
}

async function searchOverpassEmergencyPlaces(lat, lng, radiusMeters, serviceType = "") {
  const emergencyRadius = Math.min(radiusMeters, 5000);
  const autoRadius = Math.min(radiusMeters, 8000);

  const emergencyQuery = `
    [out:json][timeout:5];
    (
      node(around:${emergencyRadius},${lat},${lng})["amenity"~"hospital|police|fire_station"];
      way(around:${emergencyRadius},${lat},${lng})["amenity"~"hospital|police|fire_station"];
      node(around:${emergencyRadius},${lat},${lng})["emergency"~"ambulance_station|yes"];
    );
    out center tags;
  `;

  const healthcareQuery = `
    [out:json][timeout:5];
    (
      node(around:${emergencyRadius},${lat},${lng})["amenity"="clinic"];
      way(around:${emergencyRadius},${lat},${lng})["amenity"="clinic"];
      node(around:${emergencyRadius},${lat},${lng})["healthcare"~"hospital|emergency"];
      way(around:${emergencyRadius},${lat},${lng})["healthcare"~"hospital|emergency"];
    );
    out center tags;
  `;

  const autoQuery = `
    [out:json][timeout:5];
    (
      node(around:${autoRadius},${lat},${lng})["shop"~"car_repair|tyres"];
      way(around:${autoRadius},${lat},${lng})["shop"~"car_repair|tyres"];
      node(around:${autoRadius},${lat},${lng})["craft"~"tyre|puncture|mechanic"];
      node(around:${autoRadius},${lat},${lng})["service"~"towing|roadside_assistance"];
      node(around:${autoRadius},${lat},${lng})["shop"~"car|motorcycle"];
      way(around:${autoRadius},${lat},${lng})["shop"~"car|motorcycle"];
    );
    out center tags;
  `;

  const petrolQuery = `
    [out:json][timeout:5];
    (
      node(around:${autoRadius},${lat},${lng})["amenity"="fuel"];
      way(around:${autoRadius},${lat},${lng})["amenity"="fuel"];
    );
    out center tags;
  `;

  const mobileQuery = `
    [out:json][timeout:5];
    (
      node(around:${autoRadius},${lat},${lng})["shop"~"mobile_phone|electronics"];
      way(around:${autoRadius},${lat},${lng})["shop"~"mobile_phone|electronics"];
      node(around:${autoRadius},${lat},${lng})["craft"~"electronics_repair|phone_repair"];
    );
    out center tags;
  `;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];

  async function runQueryWithFailover(query) {
    for (const endpoint of endpoints) {
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(5000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }).toString()
        });
        if (resp.ok) {
          const json = await resp.json().catch(() => ({}));
          return json.elements || [];
        }
      } catch (e) {
        console.error(`Overpass query failed on ${endpoint}:`, e.message);
      }
    }
    return [];
  }

  const queryJobs = [];
  if (!serviceType || ["HOSPITAL", "TRAUMA_CENTER", "POLICE", "FIRE_STATION", "AMBULANCE"].includes(serviceType)) queryJobs.push(runQueryWithFailover(emergencyQuery), runQueryWithFailover(healthcareQuery));
  if (!serviceType || ["TOW_SERVICE", "PUNCTURE_SHOP", "SHOWROOM"].includes(serviceType)) queryJobs.push(runQueryWithFailover(autoQuery));
  if (!serviceType || serviceType === "PETROL_PUMP") queryJobs.push(runQueryWithFailover(petrolQuery));
  if (!serviceType || serviceType === "MOBILE_REPAIR") queryJobs.push(runQueryWithFailover(mobileQuery));

  const results = await Promise.allSettled(queryJobs);

  const allElements = [];
  for (const r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      allElements.push(...r.value);
    }
  }

  if (allElements.length === 0) return [];

  const seenIds = new Set();
  const places = [];
  for (const item of allElements) {
    const id = String(item.id);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const tags = item.tags || {};
    const pLat = item.lat || item.center?.lat;
    const pLng = item.lon || item.center?.lon;
    if (!pLat || !pLng) continue;
    places.push({
      id,
      name: tags.name || tags.operator || "Emergency service",
      category: categoryFromOsm(tags),
      distanceKm: Number(distanceKm(lat, lng, pLat, pLng).toFixed(2)),
      phone: tags.phone || tags["contact:phone"] || "",
      address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean).join(", "),
      lat: pLat,
      lng: pLng,
      source: "openstreetmap"
    });
  }

  return filterByServiceType(addServiceType(uniqueByNameAndDistance(places).sort((a, b) => a.distanceKm - b.distanceKm)), serviceType);
}

function categoryFromOsm(tags) {
  if (tags.amenity === "police") return "Police Station";
  if (tags.amenity === "fire_station") return "Fire Station";
  if (tags.emergency === "ambulance_station") return "Ambulance";
  if (tags.healthcare === "emergency" || /trauma/i.test(tags.name || "")) return "Trauma Center";
  if (tags.amenity === "clinic" && /emergency/i.test(tags.healthcare || tags["emergency"] || "")) return "Trauma Center";
  if (tags.shop === "tyres" || tags.craft === "tyre" || /puncture|tyre.*repair/i.test(tags.name || "")) return "Puncture Shop";
  if (tags.craft === "mechanic") return "Mechanic";
  if (/towing|roadside/i.test(tags.service || "")) return "Tow Service";
  if (tags.shop === "car_repair") return "Tow Service";
  if (tags.shop === "car" || tags.shop === "motorcycle" || /dealer|showroom/i.test(tags.name || "")) return "Showroom";
  if (tags.amenity === "fuel") return "Petrol Pump";
  if (/mobile_phone|electronics/i.test(tags.shop || "") || /phone|mobile/i.test(tags.name || "")) return "Mobile Store / Repair";
  if (tags.amenity === "hospital" || tags.healthcare === "hospital") return "Hospital";
  if (tags.amenity === "clinic") return "Hospital";
  return "Hospital";
}

function uniqueByNameAndDistance(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.name.toLowerCase()}-${Math.round(item.distanceKm * 10)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function searchStoredEmergencyServices(lat, lng, radiusMeters) {
  const maxKm = radiusMeters / 1000;
  const items = db.prepare("SELECT * FROM emergency_services").all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      category: row.type,
      distanceKm: Number(distanceKm(lat, lng, row.latitude, row.longitude).toFixed(2)),
      phone: row.phone,
      address: row.address,
      lat: row.latitude,
      lng: row.longitude,
      source: "stored_directory",
      operatingArea: row.operating_area,
      lastUpdated: row.last_updated
    }))
    .filter((item) => item.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  return addServiceType(items);
}

function importEmergencyDirectory() {
  try {
    const path = new URL("./emergency-services.json", import.meta.url);
    const items = JSON.parse(fs.readFileSync(path, "utf8"));
    const stmt = db.prepare(`
      INSERT INTO emergency_services (id, name, type, latitude, longitude, phone, address, operating_area, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, type = excluded.type,
        latitude = excluded.latitude, longitude = excluded.longitude,
        phone = excluded.phone, address = excluded.address,
        operating_area = excluded.operating_area, last_updated = excluded.last_updated
    `);
    for (const item of items) {
      stmt.run(item.id, item.name, item.type, item.latitude, item.longitude,
        item.phone || "", item.address || "", item.operatingArea || "", item.lastUpdated || Date.now());
    }
    console.log(`Loaded ${items.length} stored emergency services`);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Emergency directory import failed", error.message);
  }
}

app.listen(PORT, () => {
  console.log(`Road SoS backend running on http://localhost:${PORT}`);
});
