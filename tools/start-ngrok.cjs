const ngrok = require("ngrok");
require("dotenv").config({ path: ".env.local" });

(async function startNgrok() {
  try {
    const url = await ngrok.connect({
      addr: 3000,
      proto: "http",
      authtoken: process.env.NGROK_AUTHTOKEN,
      hostname: process.env.NGROK_DOMAIN || "milo-homes.ngrok-free.app",
    });

    console.log("✅ ngrok tunnel established:", url);
    console.log("➡️  Webhook URL:", `${url}/api/stripe/webhook`);
  } catch (err) {
    console.error("❌ Failed to start ngrok:", err);
  }
})();
