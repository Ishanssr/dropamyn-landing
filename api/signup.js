const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = "waitlist_signups";

function json(status, payload) {
  return {
    status,
    payload,
  };
}

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
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}?select=id`, {
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
    const result = json(405, { error: "Method not allowed" });
    return res.status(result.status).json(result.payload);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const result = json(500, { error: "Supabase env vars are missing" });
    return res.status(result.status).json(result.payload);
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const email = normalizeEmail(body.email);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const result = json(400, { error: "Enter a valid email address." });
      return res.status(result.status).json(result.payload);
    }

    const existingRows = await supabaseFetch(
      `/rest/v1/${TABLE_NAME}?select=id,email,priority_tier&email=eq.${encodeURIComponent(email)}&limit=1`
    );

    if (existingRows?.length) {
      const result = json(200, {
        ok: true,
        duplicate: true,
        priorityTier: existingRows[0].priority_tier,
        message: "You are already prioritized. We will reach out when your wave opens.",
      });
      return res.status(result.status).json(result.payload);
    }

    const totalSignups = await getSignupCount();
    const priorityTier = getPriorityTier(totalSignups);

    const inserted = await supabaseFetch(`/rest/v1/${TABLE_NAME}`, {
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

    const result = json(200, {
      ok: true,
      duplicate: false,
      priorityTier: inserted?.[0]?.priority_tier || priorityTier,
      message:
        priorityTier === "founding"
          ? "You are in the founding wave. We will prioritize you for the earliest drops."
          : priorityTier === "priority"
            ? "You are in the priority wave. We will keep you ahead of the general list."
            : "You are on the waitlist. We will notify you as soon as new spots open.",
    });
    return res.status(result.status).json(result.payload);
  } catch (error) {
    const result = json(500, {
      error: "Could not save your signup right now.",
      details: error.message,
    });
    return res.status(result.status).json(result.payload);
  }
}
