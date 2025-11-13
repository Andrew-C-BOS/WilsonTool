const ngrok = require("ngrok");
require("dotenv").config({ path: ".env.local" });

(async function startNgrok() {
  try {
    // --- hard reset the local agent/tunnels ---
    try { await ngrok.disconnect(); } catch {}
    try { await ngrok.kill(); } catch {}

    const url = await ngrok.connect({
      addr: 3000,
      proto: "http",
      authtoken: process.env.NGROK_AUTHTOKEN,          // same account that owns the domain
      hostname: process.env.NGROK_DOMAIN || "milo-homes.ngrok-free.app", // your fixed domain
    });

    console.log("✅ ngrok tunnel established:", url);
    console.log("➡️  Webhook URL:", `${url}/api/stripe/webhook`);
  } catch (err) {
    // special-case the one you’re seeing and retry once
    const msg = String(err?.body?.details?.err || err?.message || "");
    if (msg.includes("already exists")) {
      console.warn("⚠️  Existing tunnel reported — killing and retrying once…");
      try { await ngrok.kill(); } catch {}
      const url = await ngrok.connect({
        addr: 3000,
        proto: "http",
        authtoken: process.env.NGROK_AUTHTOKEN,
        hostname: process.env.NGROK_DOMAIN || "milo-homes.ngrok-free.app",
      });
      console.log("✅ ngrok tunnel re-established:", url);
      console.log("➡️  Webhook URL:", `${url}/api/stripe/webhook`);
      return;
    }
    console.error("❌ Failed to start ngrok:", err);
    process.exit(1);
  }
})();
