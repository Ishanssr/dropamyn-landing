const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getPriorityTier(totalSignups) {
  if (totalSignups < 250) return "founding";
  if (totalSignups < 1000) return "priority";
  return "waitlist";
}

async function supabaseFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Supabase request failed");
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getSignupCount() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/waitlist_signups?select=id`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Could not count signups");
  }

  const contentRange = response.headers.get("content-range");
  if (!contentRange) return 0;

  const total = Number(contentRange.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase env vars are missing" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const email = normalizeEmail(body.email);
    const code = String(body.code || "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter the 6-digit verification code." });
    }

    // ── Verify the code ──
    const codeRows = await supabaseFetch(
      `/rest/v1/verification_codes?select=id,code,expires_at&email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1`
    );

    if (!codeRows?.length) {
      return res.status(400).json({ error: "No verification code found. Please request a new one." });
    }

    const latestCode = codeRows[0];

    if (latestCode.code !== code) {
      return res.status(400).json({ error: "Incorrect code. Please check and try again." });
    }

    if (new Date(latestCode.expires_at) < new Date()) {
      return res.status(400).json({ error: "Code has expired. Please request a new one." });
    }

    // ── Delete used codes for this email ──
    await fetch(
      `${SUPABASE_URL}/rest/v1/verification_codes?email=eq.${encodeURIComponent(email)}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    // ── Check for duplicate signups ──
    const existingRows = await supabaseFetch(
      `/rest/v1/waitlist_signups?select=id,email,priority_tier&email=eq.${encodeURIComponent(email)}&limit=1`
    );

    if (existingRows?.length) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        priorityTier: existingRows[0].priority_tier,
        message: "This email is already prioritized. We will reach out when your wave opens.",
      });
    }

    // ── Save the signup ──
    const totalSignups = await getSignupCount();
    const priorityTier = getPriorityTier(totalSignups);

    const inserted = await supabaseFetch("/rest/v1/waitlist_signups", {
      method: "POST",
      body: JSON.stringify([
        {
          email,
          priority_tier: priorityTier,
          signup_source: body.signupSource || "dropamyn-landing",
          joined_from: body.joinedFrom || "vercel",
          user_agent: req.headers["user-agent"] || null,
        },
      ]),
    });

    const message =
      priorityTier === "founding"
        ? "You're verified! You are in the founding wave — we'll prioritize you for the earliest drops."
        : priorityTier === "priority"
          ? "You're verified! You are in the priority wave — we'll keep you ahead of the general list."
          : "You're verified! You are on the waitlist — we'll notify you as soon as new spots open.";

    return res.status(200).json({
      ok: true,
      duplicate: false,
      priorityTier: inserted?.[0]?.priority_tier || priorityTier,
      message,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Could not complete your signup right now.",
      details: error.message,
    });
  }
}
