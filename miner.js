require("dotenv").config();

const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const os = require("os");
const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc";

const ABI = [
  "function getChallenge(address miner) view returns (bytes32)",
  "function miningState() view returns (uint256 era,uint256 reward,uint256 difficulty,uint256 minted,uint256 remaining,uint256 epoch,uint256 epochBlocksLeft_)",
  "function mine(uint256 nonce)"
];

function requireEnv() {
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Isi RPC_URL dan PRIVATE_KEY di file .env dulu.");
    process.exit(1);
  }

  if (!PRIVATE_KEY.startsWith("0x") || PRIVATE_KEY.length !== 66) {
    console.error("PRIVATE_KEY tidak valid. Harus format 0x + 64 karakter hex.");
    process.exit(1);
  }
}

function randomNonce() {
  const bytes = ethers.randomBytes(8);
  return BigInt(ethers.hexlify(bytes));
}

function formatBigInt(value) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function shortHex(hex, start = 10, end = 8) {
  if (!hex) return "-";
  return `${hex.slice(0, start)}...${hex.slice(-end)}`;
}

function formatSeconds(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

if (!isMainThread) {
  const {
    workerId,
    workerCount,
    challenge,
    difficulty,
    startNonce
  } = workerData;

  let nonce = BigInt(startNonce) + BigInt(workerId);
  const step = BigInt(workerCount);
  const target = BigInt(difficulty);

  let attempts = 0n;
  let lastHash = "";
  let bestHash = "";
  let bestHashNum = null;
  let lastReport = Date.now();

  while (true) {
    const hash = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256"],
      [challenge, nonce]
    );

    const hashNum = BigInt(hash);

    attempts++;
    lastHash = hash;

    if (bestHashNum === null || hashNum < bestHashNum) {
      bestHashNum = hashNum;
      bestHash = hash;
    }

    if (hashNum < target) {
      parentPort.postMessage({
        type: "found",
        workerId,
        nonce: nonce.toString(),
        hash,
        attempts: attempts.toString()
      });
      break;
    }

    nonce += step;

    const now = Date.now();

    if (now - lastReport >= 1000) {
      parentPort.postMessage({
        type: "status",
        workerId,
        attempts: attempts.toString(),
        nonce: nonce.toString(),
        lastHash,
        bestHash
      });

      lastReport = now;
    }
  }

  process.exit(0);
}

async function main() {
  requireEnv();

  const workerCount = Number(process.env.WORKERS || os.cpus().length);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  console.log("Wallet:", wallet.address);
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("Workers:", workerCount);
  console.log("RPC:", RPC_URL);

  while (true) {
    let workers = [];
    let found = false;

    try {
      const state = await contract.miningState();
      const difficulty = BigInt(state.difficulty.toString());
      const challenge = await contract.getChallenge(wallet.address);

      const epoch = state.epoch.toString();
      const reward = ethers.formatUnits(state.reward, 18);
      const startNonce = randomNonce();

      console.log("");
      console.log("📡 New mining round");
      console.log("Era:", state.era.toString());
      console.log("Reward:", reward, "HASH");
      console.log("Difficulty:", difficulty.toString());
      console.log("Minted:", state.minted.toString());
      console.log("Remaining:", state.remaining.toString());
      console.log("Epoch:", epoch);
      console.log("Epoch blocks left:", state.epochBlocksLeft_.toString());
      console.log("Challenge:", challenge);
      console.log("");

      const stats = {};
      const startTime = Date.now();

      function renderStatus() {
        let totalAttempts = 0n;
        let bestHash = "";
        let bestHashNum = null;
        let sampleNonce = "-";
        let sampleLastHash = "-";

        for (const id of Object.keys(stats)) {
          const s = stats[id];

          totalAttempts += BigInt(s.attempts || "0");

          sampleNonce = s.nonce || sampleNonce;
          sampleLastHash = s.lastHash || sampleLastHash;

          if (s.bestHash) {
            const n = BigInt(s.bestHash);
            if (bestHashNum === null || n < bestHashNum) {
              bestHashNum = n;
              bestHash = s.bestHash;
            }
          }
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = elapsed > 0 ? Number(totalAttempts) / elapsed : 0;

        process.stdout.write("\x1Bc");
        console.log("⛏️  HASH Miner Parallel CPU");
        console.log("Wallet     :", wallet.address);
        console.log("Workers    :", workerCount);
        console.log("Epoch      :", epoch);
        console.log("Reward     :", reward, "HASH");
        console.log("Difficulty :", difficulty.toString());
        console.log("Challenge  :", shortHex(challenge));
        console.log("Attempts   :", formatBigInt(totalAttempts));
        console.log("Hash rate  :", rate.toFixed(2), "H/s");
        console.log("Sample nonce:", sampleNonce);
        console.log("Last hash  :", shortHex(sampleLastHash));
        console.log("Best hash  :", shortHex(bestHash));
        console.log("Elapsed    :", formatSeconds(elapsed));
      }

      for (let i = 0; i < workerCount; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            workerId: i,
            workerCount,
            challenge,
            difficulty: difficulty.toString(),
            startNonce: startNonce.toString()
          }
        });

        workers.push(worker);

        worker.on("message", async (msg) => {
          if (msg.type === "status") {
            stats[msg.workerId] = msg;
          }

          if (msg.type === "found" && !found) {
            found = true;

            console.log("");
            console.log("🎉 FOUND!");
            console.log("Worker:", msg.workerId);
            console.log("Nonce:", msg.nonce);
            console.log("Hash:", msg.hash);
            console.log("Worker attempts:", msg.attempts);

            for (const w of workers) {
              w.terminate().catch(() => {});
            }

            try {
              const nonce = BigInt(msg.nonce);

              const gas = await contract.mine.estimateGas(nonce);
              console.log("Estimated gas:", gas.toString());

              const tx = await contract.mine(nonce, {
                gasLimit: gas + 50000n
              });

              console.log("TX sent:", tx.hash);

              const receipt = await tx.wait();

              if (receipt.status === 1) {
                console.log("✅ Success block:", receipt.blockNumber);
              } else {
                console.log("❌ TX reverted.");
              }
            } catch (err) {
              console.error("TX failed:", err.shortMessage || err.message);
            }
          }
        });

        worker.on("error", (err) => {
          console.error("Worker error:", err.message);
        });
      }

      const renderInterval = setInterval(() => {
        if (!found) renderStatus();
      }, 1000);

      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (found) {
            clearInterval(check);
            clearInterval(renderInterval);
            resolve();
          }
        }, 500);
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      console.error("");
      console.error("Mining loop error:", err.shortMessage || err.message || err);

      for (const w of workers) {
        w.terminate().catch(() => {});
      }

      console.error("Retry dalam 5 detik...");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
