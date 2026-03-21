const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
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

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmailViaResend(email, code) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Dropamyn <noreply@dropamyn.com>",
      to: [email],
      subject: `${code} is your Dropamyn verification code`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #060606; color: #f0ede8;">
          <div style="text-align: center; margin-bottom: 32px;">
            <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.03em;">Drop<span style="background: linear-gradient(90deg, #b8ccff, #9f8cff); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">amyn</span></span>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 32px 24px; text-align: center;">
            <p style="color: rgba(240,237,232,0.6); font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em; margin: 0 0 8px;">Verification Code</p>
            <div style="font-size: 36px; font-weight: 700; letter-spacing: 0.3em; color: #fff; margin: 16px 0; font-family: monospace;">${code}</div>
            <p style="color: rgba(240,237,232,0.5); font-size: 13px; margin: 16px 0 0;">This code expires in <strong style="color: rgba(240,237,232,0.8);">10 minutes</strong></p>
          </div>
          <p style="color: rgba(240,237,232,0.4); font-size: 12px; text-align: center; margin-top: 24px;">If you didn't request this code, you can safely ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Resend error: ${errorData}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return res.status(500).json({ error: "Server configuration incomplete." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const email = normalizeEmail(body.email);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    // Check if already on waitlist
    const existing = await supabaseFetch(
      `/rest/v1/waitlist_signups?select=id,priority_tier&email=eq.${encodeURIComponent(email)}&limit=1`
    );

    if (existing?.length) {
      return res.status(200).json({
        ok: true,
        alreadyVerified: true,
        message: "This email is already prioritized. We'll reach out when your wave opens.",
      });
    }

    // Rate limit: max 3 codes per email in last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recentCodes = await supabaseFetch(
      `/rest/v1/verification_codes?select=id&email=eq.${encodeURIComponent(email)}&created_at=gte.${tenMinutesAgo}`
    );

    if (recentCodes && recentCodes.length >= 3) {
      return res.status(429).json({
        error: "Too many code requests. Please wait a few minutes before trying again.",
      });
    }

    // Generate code and store it
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabaseFetch("/rest/v1/verification_codes", {
      method: "POST",
      body: JSON.stringify([{ email, code, expires_at: expiresAt }]),
    });

    // Send the email
    await sendEmailViaResend(email, code);

    return res.status(200).json({
      ok: true,
      message: "Verification code sent. Check your inbox.",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Could not send verification code right now.",
      details: error.message,
    });
  }
}
