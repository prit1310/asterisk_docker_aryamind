const express = require("express");
const cors = require("cors");
const Ari = require("ari-client");
const { CallLog, connectWithRetry } = require("./db");
const callRoutes = require("./routes/calls");
const moment = require("moment");
const fs = require("fs");

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.use("/recordings", express.static("/var/spool/asterisk/monitor"));
app.use("/api/calls", callRoutes);

app.listen(3002, () => console.log("✅ Dashboard API running on port 3002"));

let ariClient;

(async () => {
  await connectWithRetry();
  ariClient = await connectARI();
  if (ariClient) waitForEndpointAndCall(ariClient, "msuser");
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
          updatedAt: startTime,
        });

        await channel.answer();

        const greetingFilename = "greeting_good_morning";
        const filePath = `/var/spool/asterisk/monitor/${greetingFilename}.wav`;

        // Check file exists
        if (fs.existsSync(filePath)) {
          console.log("✅ Greeting file found:", filePath);
          await new Promise((res) => setTimeout(res, 1000)); // Ensure file is fully accessible
          await channel.play({ media: `sound:${greetingFilename}` });
          console.log(`🔊 Played: ${greetingFilename}.wav`);
        } else {
          console.warn("⚠️ Greeting file not found:", filePath);
        }

        // 🎙️ Start recording
        const recordingFile = `${channel.id}.wav`;
        channel.record(
          {
            name: recordingFile.replace(".wav", ""),
            format: "wav",
            maxDurationSeconds: 3600,
            beep: false,
            ifExists: "overwrite",
          },
          (err) => {
            if (err) console.error("❌ Recording error:", err.message);
            else console.log(`🔴 Recording started: ${recordingFile}`);
          }
        );

        channel.on("StasisEnd", async () => {
          const endTime = new Date();
          const duration = moment(endTime).diff(startTime, "seconds");

          await call.update({
            endTime,
            duration,
            recordingFile,
            updatedAt: endTime,
          });

          console.log(`📴 Call ended: ${caller} → ${callee} (${duration}s)`);
        });
      });

      client.start("hello-world");
      return client;
    } catch (err) {
      console.error(`❌ ARI connect failed (attempt ${i}):`, err.message);
      if (i === retries) return null;
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
}

async function waitForEndpointAndCall(client, sipUser) {
  const endpointId = `SIP/${sipUser}`;
  let hasCalled = false;

  const poll = async () => {
    try {
      const endpoint = await client.endpoints.get({ tech: "SIP", resource: sipUser });
      if (endpoint.state === "online" && !hasCalled) {
        console.log(`✅ ${endpointId} is online. Proceeding to call.`);

        client.channels.originate(
          {
            endpoint: endpointId,
            app: "hello-world",
            appArgs: "1001",
            callerId: "1000",
          },
          (err) => {
            if (err) console.error("❌ Auto-dial failed:", err.message);
            else console.log(`📤 Auto-dial triggered: ${endpointId} → Stasis`);
          }
        );

        hasCalled = true;
      } else {
        console.log(`⏳ Waiting for ${endpointId} to come online... (${endpoint.state})`);
      }
    } catch (err) {
      console.warn(`⚠️ Could not query ${endpointId}: ${err.message}`);
    }

    if (!hasCalled) setTimeout(poll, 5000);
  };

  poll();
}

app.post("/api/dial", async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Missing 'to' number" });

  try {
    const channel = ariClient.Channel();
    await channel.originate({
      endpoint: `SIP/${to}`,
      app: "hello-world",
      appArgs: to,
      callerId: "1000",
    });

    console.log(`📤 Manual outbound call to SIP/${to}`);
    res.json({ success: true, message: `Calling ${to}` });
  } catch (err) {
    console.error("❌ Manual call failed:", err.message);
    res.status(500).json({ error: "Failed to make outbound call" });
  }
});
