// hello-world.js

const express = require("express");
const cors = require("cors");
const Ari = require("ari-client");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const moment = require("moment");
const { execSync, spawnSync } = require("child_process");
require("dotenv").config();

const elevenApiKey = process.env.ELEVEN_API_KEY;
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

async function waitForRasa(retries = 50, interval = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get("http://rasa:5005/status");
      if (res.status === 200) {
        console.log("✅ Rasa server is ready");
        return;
      }
    } catch {
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
      "-H", `xi-api-key: ${elevenApiKey}`,
      "-H", "Content-Type: application/json",
      "--data-binary", `@${payloadPath}`,
      "-o", rawPath
    ], { encoding: "utf-8" });

    if (curlResult.status !== 0) throw new Error(curlResult.stderr || "Unknown curl error");

    const stat = fs.statSync(rawPath);
    if (stat.size < 1000) throw new Error(`TTS returned very short file`);

    execSync(`ffmpeg -y -i "${rawPath}" -ar 8000 -ac 1 -f wav -acodec pcm_s16le "${filepath}"`);
    fs.chmodSync(filepath, 0o644);

    const durationResult = spawnSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filepath
    ], { encoding: "utf8" });

    const duration = parseFloat(durationResult.stdout.trim());
    if (isNaN(duration) || duration < 0.5) throw new Error(`WAV duration too short or unreadable`);

    console.log(`✅ Synthesized and converted: ${filepath} (${duration.toFixed(2)}s)`);
    fs.unlinkSync(rawPath);
  } catch (err) {
    console.error("❌ synthesizeToFile error:", err.message);
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

async function connectARI(retries = 30) {
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
        const call = await CallLog.create({ caller, callee, startTime });

        // ✅ Always register StasisEnd listener
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

        try {
          await channel.answer();
          console.log("✅ Channel answered");

          const greetingFile = "greeting_good_morning";
          const greetingPath = path.join(RECORDINGS_DIR, `${greetingFile}.wav`);
          if (!fs.existsSync(greetingPath)) {
            await synthesizeToFile("Good morning! Let's start your session.", greetingPath);
          }

          const testPlayback = client.Playback();
          testPlayback.on('PlaybackStarted', () => console.log(`🎵 Test playback started: sound:tt-weasels`));
          await channel.playWithId({ media: "sound:tt-weasels", playbackId: testPlayback.id });
          await new Promise(res => testPlayback.once('PlaybackFinished', res));
          console.log("✅ Test playback finished");

          const playback1 = client.Playback();
          playback1.on('PlaybackStarted', () => console.log(`🎵 Playback started: recording:${greetingFile}`));
          await new Promise(res => setTimeout(res, 1000));
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

          const playAudioAndWait = async (filename) => {
            const filepath = path.join(RECORDINGS_DIR, `${filename}.wav`);
            for (let attempt = 1; attempt <= 5; attempt++) {
              try {
                if (!fs.existsSync(filepath)) throw new Error("File not ready");
                const stat = fs.statSync(filepath);
                if (stat.size < 2000) throw new Error("File too small");

                const playback = client.Playback();
                await channel.playWithId({ media: `sound:${filename}`, playbackId: playback.id });

                return await new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => reject(new Error("PlaybackTimeout")), 10000);
                  playback.once("PlaybackFinished", () => {
                    clearTimeout(timeout);
                    console.log(`✅ Playback finished: sound:${filename}`);
                    resolve();
                  });
                  playback.once("PlaybackError", (err) => {
                    clearTimeout(timeout);
                    reject(new Error(err.message));
                  });
                });
              } catch (err) {
                console.warn(`⚠️ Playback attempt ${attempt} failed for ${filename}: ${err.message}`);
                if (attempt === 5) throw err;
                await new Promise(r => setTimeout(r, 1000));
              }
            }
          };

          const nextPrompt = async () => {
            if (idx >= scripts.length) {
              await channel.hangup();
              return;
            }

            const userInput = scripts[idx++];
            console.log(`🗣️ User: ${userInput}`);
            let reply = "Sorry, I didn't understand that.";

            try {
              const res = await axios.post("http://rasa:5005/webhooks/rest/webhook", {
                sender: callSid,
                message: userInput
              }, { timeout: 7000 });

              if (res.data?.[0]?.text) {
                reply = res.data[0].text;
                console.log(`🤖 Bot: ${reply}`);
              } else {
                console.warn("⚠️ Rasa returned no text");
              }
            } catch (err) {
              console.error("❌ Rasa error:", err.message);
            }

            const replyName = `reply_${idx}`;
            const replyPath = path.join(RECORDINGS_DIR, `${replyName}.wav`);
            await synthesizeToFile(reply, replyPath);

            await playAudioAndWait(replyName);
            await new Promise(r => setTimeout(r, 250));
            await nextPrompt();
          };

          await nextPrompt();
        } catch (err) {
          console.error("❌ Call handling error:", err.message);
        }
      });

      client.start("hello-world");
      return client;
    } catch (err) {
      console.error(`❌ ARI connect failed (attempt ${i}):`, err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function waitForEndpointAndCall(client, sipUser) {
  let called = false;

  setInterval(async () => {
    try {
      const endpoint = await client.endpoints.get({ tech: "SIP", resource: sipUser });
      if (endpoint.state === "online" && !called) {
        console.log(`✅ SIP/${sipUser} is online. Calling now.`);
        await client.channels.originate({
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
  }, 5000);
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
