// hello-world.js
const express = require("express");
const Ari = require("ari-client");
const { CallLog, connectWithRetry } = require("./db");
const callRoutes = require("./routes/calls");
const moment = require("moment");
const path = require("path");

const app = express();
app.use(express.json());
app.use("/api/calls", callRoutes);
app.use("/recordings", express.static(path.join(__dirname, "..", "recordings")));

app.listen(3002, () => console.log("✅ Dashboard API running on port 3002"));

let ariClient;

(async () => {
  await connectWithRetry();
  ariClient = await connectARI();
})();

async function connectARI(retries = 10) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await Ari.connect("http://asterisk:8088/ari", "asterisk", "asteriskpw");
      console.log("✅ Connected to Asterisk ARI");

      client.on("StasisStart", async (event, channel) => {
        const caller = channel.caller.number || "unknown";
        const callee = (event.args && event.args[0]) || channel.dialplan.exten || "unknown";
        const startTime = new Date();

        console.log(`📞 Call started: ${caller} → ${callee}`);
        const call = await CallLog.create({
          caller,
          callee,
          startTime,
          createdAt: startTime,
          updatedAt: startTime
        });

        channel.on("StasisEnd", async () => {
          const endTime = new Date();
          const duration = moment(endTime).diff(startTime, "seconds");
          await call.update({
            endTime,
            duration,
            recordingFile: `${channel.id}.wav`,
            updatedAt: endTime
          });
          console.log(`📴 Call ended: ${caller} → ${callee} (${duration}s)`);
        });

        await channel.answer();

        channel.record(
          {
            name: `monitor/${channel.id}`,
            format: "wav",
            beep: false,
            terminateOn: "#"
          },
          err => {
            if (err) console.error("❌ Recording error:", err.message);
            else console.log(`🔴 Recording started: ${channel.id}.wav`);
          }
        );
      });

      client.start("hello-world");

      // Wait for SIPp REGISTER to complete
      console.log("⏳ Waiting 10s for SIP/msuser to register...");
      await new Promise(res => setTimeout(res, 10000));

      // Check if SIP/msuser is online
      const endpointId = "SIP/msuser";
      for (let attempt = 1; attempt <= 10; attempt++) {
        try {
          const endpoint = await client.endpoints.get({ tech: "SIP", resource: "msuser" });
          if (endpoint.state === "online") {
            console.log("✅ SIP/msuser is online. Proceeding to call.");
            client.channels.originate(
              {
                endpoint: endpointId,
                app: "hello-world",
                appArgs: "1001",
                callerId: "1000"
              },
              err => {
                if (err) {
                  console.error("❌ Auto-dial failed:", err.message);
                } else {
                  console.log("📤 Auto-dial triggered: SIP/msuser → Stasis");
                }
              }
            );
            break;
          } else {
            console.warn(`⚠️ SIP/msuser is ${endpoint.state}, retrying... (${attempt}/10)`);
          }
        } catch (err) {
          console.warn(`⚠️ Could not query SIP/msuser: ${err.message}`);
        }
        await new Promise(res => setTimeout(res, 2000));
        if (attempt === 10) {
          console.warn("⏭️ SIP/msuser still unavailable, skipping auto-dial.");
        }
      }

      return client;
    } catch (err) {
      console.error(`❌ ARI connect/dial failed (attempt ${i}):`, err.message);
      if (i === retries) return null;
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

// Manual trigger
app.post("/api/dial", async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Missing 'to' number" });

  try {
    const channel = ariClient.Channel();
    await channel.originate({
      endpoint: `SIP/${to}`,
      app: "hello-world",
      appArgs: to,
      callerId: "1000"
    });
    console.log(`📤 Manual outbound call to SIP/${to}`);
    res.json({ success: true, message: `Calling ${to}` });
  } catch (err) {
    console.error("❌ Manual call failed:", err.message);
    res.status(500).json({ error: "Failed to make outbound call" });
  }
});
