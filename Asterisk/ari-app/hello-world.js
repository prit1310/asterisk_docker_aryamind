const express = require("express");
const cors = require("cors");
const Ari = require("ari-client");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const moment = require("moment");
const { execSync, spawnSync } = require("child_process");

const { CallLog, connectWithRetry } = require("./db");
const callRoutes = require("./routes/calls");

const RECORDINGS_DIR = "/var/lib/asterisk/sounds";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());
app.use("/recordings", express.static(RECORDINGS_DIR));
app.use("/api/calls", callRoutes);

app.listen(3002, () => console.log("✅ Dashboard API running on port 3002"));

let ariClient;

async function waitForRasa(retries = 20, interval = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get("http://rasa:5005/status");
      if (res.status === 200) {
        console.log("✅ Rasa server is ready");
        return;
      }
    } catch (e) {
      console.log(`⏳ Waiting for Rasa... (${i + 1}/${retries})`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error("❌ Rasa server did not become ready in time");
}

async function synthesizeToFile(text, filepath) {
  const payload = {
    text,
    model_id: "eleven_monolingual_v1",
    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
  };

  const payloadPath = path.join(RECORDINGS_DIR, `payload_${Date.now()}.json`);
  const rawPath = filepath.replace(".wav", "_raw.mp3");

  fs.writeFileSync(payloadPath, JSON.stringify(payload));

  try {
    const curlResult = spawnSync("curl", [
      "-s", "-X", "POST",
      "https://api.elevenlabs.io/v1/text-to-speech/8DzKSPdgEQPaK5vKG0Rs/stream",
      "-H", "xi-api-key: sk_bf4938643112c008fe480ad4e6233ee07ad4c1447dd73eb2",
      "-H", "Content-Type: application/json",
      "--data-binary", `@${payloadPath}`,
      "-o", rawPath
    ], { encoding: "utf-8" });

    if (curlResult.status !== 0) throw new Error(curlResult.stderr || "Unknown curl error");

    const stat = fs.statSync(rawPath);
    if (stat.size < 1000) {
      const rawContent = fs.readFileSync(rawPath, "utf8");
      throw new Error(`Invalid TTS audio: ${rawContent}`);
    }

    // Convert to Asterisk-compatible WAV format
    execSync(`ffmpeg -y -i "${rawPath}" -ar 8000 -ac 1 -f wav -acodec pcm_s16le -filter:a "volume=2.0" "${filepath}"`);

    // Set permissions for Asterisk to read the file
    fs.chmodSync(filepath, 0o644);

    // Flush to disk
    const fd = fs.openSync(filepath, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    // Verify file existence, size, and readability
    if (!fs.existsSync(filepath)) {
      throw new Error(`File does not exist: ${filepath}`);
    }
    if (fs.statSync(filepath).size < 1000) {
      throw new Error(`File is too small: ${filepath}`);
    }
    try {
      fs.accessSync(filepath, fs.constants.R_OK);
    } catch (err) {
      throw new Error(`File is not readable: ${filepath}`);
    }

    fs.unlinkSync(rawPath);
    console.log(`✅ Synthesized and converted: ${filepath}`);
  } catch (err) {
    console.error("❌ TTS synthesis failed:", err.message);
    throw err;
  } finally {
    if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
  }
}

(async () => {
  await connectWithRetry();
  await waitForRasa();
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
        const callee = event.args?.[0] || channel.dialplan.exten || "unknown";
        const startTime = new Date();
        const recordingFile = path.join(RECORDINGS_DIR, `${channel.id}.wav`);

        console.log(`📞 Call started: ${caller} → ${callee}, Channel ID: ${channel.id}`);
        const call = await CallLog.create({ caller, callee, startTime, createdAt: startTime, updatedAt: startTime });

        try {
          console.log(`🔍 Channel state: ${channel.state}`);
          await channel.answer();
          console.log("✅ Channel answered");

          const greetingFile = "greeting_good_morning";
          const greetingPath = path.join(RECORDINGS_DIR, `${greetingFile}.wav`);
          if (!fs.existsSync(greetingPath)) {
            await synthesizeToFile("Good morning! Let's start your session.", greetingPath);
          }

          // Test with built-in Asterisk sound to verify playback
          const testPlayback = client.Playback();
          testPlayback.on('PlaybackStarted', () => console.log(`🎵 Test playback started: sound:tt-weasels`));
          testPlayback.on('PlaybackError', (err) => console.error(`❌ Test playback error: ${err.message}`));
          await channel.playWithId({ media: "sound:tt-weasels", playbackId: testPlayback.id });
          await new Promise(res => testPlayback.once('PlaybackFinished', res));
          console.log("✅ Test playback finished");

          const playback1 = client.Playback();
          playback1.on('PlaybackStarted', () => console.log(`🎵 Playback started: recording:${greetingFile}`));
          playback1.on('PlaybackError', (err) => console.error(`❌ Playback error: ${err.message}`));
          await new Promise(resolve => setTimeout(resolve, 1000)); // Ensure file readiness
          await channel.playWithId({ media: `recording:${greetingFile}`, playbackId: playback1.id });
          await new Promise(res => playback1.once('PlaybackFinished', res));
          console.log("✅ Greeting finished");

          channel.record({
            name: path.basename(recordingFile, ".wav"),
            format: "wav",
            maxDurationSeconds: 3600,
            beep: false,
            ifExists: "overwrite"
          }, err => {
            if (err) console.error("❌ Recording error:", err.message);
            else console.log(`🔴 Recording started: ${recordingFile}`);
          });

          const scripts = [
            "Hello!",
            "Can you tell me my balance?",
            "Yes, that's right.",
            "No, that's wrong.",
            "Goodbye!"
          ];
          let idx = 0;
          const callSid = `call_${channel.id}`;

          async function nextPrompt() {
            if (idx >= scripts.length) {
              console.log("✅ All scripts processed, hanging up");
              await channel.hangup();
              return;
            }
            const userInput = scripts[idx++];
            console.log(`🗣️ User: ${userInput}`);

            try {
              const { data } = await axios.post("http://rasa:5005/webhooks/rest/webhook", {
                sender: callSid,
                message: userInput
              });

              const reply = data?.[0]?.text || "Sorry, I didn't understand that.";
              console.log(`🤖 Bot: ${reply}`);

              const replyName = `reply_${idx}`;
              const replyPath = path.join(RECORDINGS_DIR, `${replyName}.wav`);
              await synthesizeToFile(reply, replyPath);

              if (!fs.existsSync(replyPath)) {
                console.error(`❌ Reply file missing: ${replyPath}`);
                return;
              }

              await new Promise(resolve => setTimeout(resolve, 1000)); // Ensure file readiness
              const playback = client.Playback();
              playback.on('PlaybackStarted', () => console.log(`🎵 Playback started: recording:${replyName}`));
              playback.on('PlaybackError', (err) => console.error(`❌ Playback error: ${err.message}`));
              console.log(`🔊 Playing media: recording:${replyName}`);
              await channel.playWithId({ media: `recording:${replyName}`, playbackId: playback.id });
              await new Promise(res => playback.once('PlaybackFinished', res));
              console.log(`✅ Reply #${idx} playback done`);

              setTimeout(nextPrompt, 2500); // Increased delay
            } catch (e) {
              console.error("❌ Rasa interaction failed:", e.message);
              setTimeout(nextPrompt, 2500);
            }
          }

          await nextPrompt();
        } catch (err) {
          console.error("❌ Call handling error:", err.message);
        }

        channel.on("StasisEnd", async () => {
          const endTime = new Date();
          try {
            await call.update({
              endTime,
              duration: moment(endTime).diff(startTime, "seconds"),
              recordingFile,
              updatedAt: endTime
            });
            console.log(`📴 Call ended: ${caller} → ${callee}`);
          } catch (err) {
            console.error("❌ Call log update failed:", err.message);
          }
        });
      });

      client.start("hello-world");
      return client;
    } catch (err) {
      console.error(`❌ ARI connect failed (attempt ${i}):`, err.message);
      if (i === retries) return null;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function waitForEndpointAndCall(client, sipUser) {
  let called = false;
  const poll = async () => {
    try {
      const endpoint = await client.endpoints.get({ tech: "SIP", resource: sipUser });
      if (endpoint.state === "online" && !called) {
        console.log(`✅ SIP/${sipUser} is online. Calling now.`);
        client.channels.originate({
          endpoint: `SIP/${sipUser}`,
          app: "hello-world",
          appArgs: "1001",
          callerId: "1000"
        });
        called = true;
      }
    } catch (e) {
      console.warn("⚠️ Endpoint check failed:", e.message);
    }
    if (!called) setTimeout(poll, 5000);
  };
  poll();
}

app.post("/api/dial", async (req, res) => {
  const to = req.body.to;
  if (!to) return res.status(400).json({ error: "Missing 'to' number" });

  try {
    const chan = ariClient.Channel();
    await chan.originate({
      endpoint: `SIP/${to}`,
      app: "hello-world",
      appArgs: to,
      callerId: "1000"
    });
    console.log(`📤 Manual outbound call to SIP/${to}`);
    res.json({ success: true, message: `Calling ${to}` });
  } catch (e) {
    console.error("❌ Manual call failed:", e.message);
    res.status(500).json({ error: "Failed to make call" });
  }
});