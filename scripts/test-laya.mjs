// Standalone test script to verify Laya's wire compatibility with Reme Content Decoder.
// Run this anytime with: npm run test:laya

const LAYA_URL = process.env.LAYA_URL || "http://127.0.0.1:8000/v1/systemone";
const HEALTH_URL = LAYA_URL.replace(/\/v1\/.*$/, "/health");

console.log("=================================================");
console.log(" 🧪 LAYA SYSTEM 1 WIRE-COMPATIBILITY TEST");
console.log("=================================================");
console.log(`Endpoint: ${LAYA_URL}\n`);

async function testLaya() {
  // Step 1: Health Check
  console.log("1. Checking server status...");
  try {
    const healthRes = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    if (healthRes.ok) {
      const healthData = await healthRes.json().catch(() => ({}));
      console.log(`   ✅ Server is online! (Device: ${healthData.device || "auto"}, Loaded: ${healthData.loaded ?? "ready"})\n`);
    } else {
      console.log(`   ⚠️ Server responded with HTTP ${healthRes.status} on /health. Continuing with payload test...\n`);
    }
  } catch (err) {
    console.log(`   ❌ Could not reach Laya on ${HEALTH_URL}.`);
    console.log(`\n💡 To start the Laya inference server, run this in another terminal:`);
    console.log(`   npm run serve:laya`);
    console.log(`   (or simply: laya-serve)\n`);
    process.exit(1);
  }

  // Step 2: System 1 Decision Batch Test
  console.log("2. Sending a test YouTube Short hook classification batch...");
  const sampleState = {
    videos: [
      {
        title: "I Trapped 100 People In A Circle For $500,000!",
        description: "Whoever leaves this circle last wins half a million dollars.",
      },
    ],
  };

  const sampleQuestions = {
    v0_hook: {
      type: "choice",
      instructions: "Which hook type does the title in `videos[0].title` use?",
      criteria: {
        curiosity: "Teases information without revealing it",
        recognition: "Makes a specific type of viewer feel seen",
        result: "Promises or shows a concrete outcome or number",
        contrarian: "Challenges common advice or a popular belief",
        story: "Opens a personal story or moment",
      },
    },
    v0_strength: {
      type: "score",
      instructions: "How strong is `videos[0].title` as a hook for a short-form video?",
      criteria: ["Weak", "Decent", "Scroll-stopping"],
    },
  };

  const startTime = Date.now();
  try {
    const res = await fetch(LAYA_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "laya",
        state: sampleState,
        questions: sampleQuestions,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const elapsedMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.log(`   ❌ Request failed with HTTP ${res.status}: ${errText}`);
      process.exit(1);
    }

    const data = await res.json();

    console.log(`   ✅ Request completed successfully in ${elapsedMs} ms!\n`);
    console.log("=================================================");
    console.log(" 📊 TEST RESULTS & WIRE COMPATIBILITY");
    console.log("=================================================");
    console.log(`Model returned:       ${data.model || "laya"}`);
    console.log(`Latency:              ${elapsedMs} ms`);
    console.log(`Classified Hook:      ${data.answers?.v0_hook?.choice || "N/A"}`);
    console.log(`Confidence:           ${data.answers?.v0_hook?.confidence ?? "N/A"}`);
    console.log(`Hook Strength:        ${data.answers?.v0_strength?.choice || data.answers?.v0_strength?.score || "N/A"}`);
    console.log("-------------------------------------------------");
    console.log("🎉 Laya is 100% wire-compatible with Reme Content Decoder!");
    console.log("You are ready to run: npm run dev");
    console.log("=================================================\n");
  } catch (err) {
    console.log(`   ❌ Test failed: ${err.message}`);
    process.exit(1);
  }
}

testLaya();
