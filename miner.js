require("dotenv").config();

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

async function main() {
  requireEnv();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  console.log("Wallet:", wallet.address);
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("RPC:", RPC_URL);

  while (true) {
    try {
      const state = await contract.miningState();
      const difficulty = BigInt(state.difficulty.toString());
      const challenge = await contract.getChallenge(wallet.address);

      console.log("");
      console.log("Era:", state.era.toString());
      console.log("Reward:", ethers.formatUnits(state.reward, 18), "HASH");
      console.log("Difficulty:", difficulty.toString());
      console.log("Minted:", state.minted.toString());
      console.log("Remaining:", state.remaining.toString());
      console.log("Epoch:", state.epoch.toString());
      console.log("Epoch blocks left:", state.epochBlocksLeft_.toString());
      console.log("Challenge:", challenge);

      let nonce = randomNonce();
      let attempts = 0n;
      const start = Date.now();

      while (true) {
        const hash = ethers.solidityPackedKeccak256(
          ["bytes32", "uint256"],
          [challenge, nonce]
        );

        const hashNum = BigInt(hash);
        attempts++;

        if (hashNum < difficulty) {
          console.log("");
          console.log("FOUND nonce:", nonce.toString());
          console.log("Hash:", hash);
          console.log("Attempts:", attempts.toString());

          try {
            const gas = await contract.mine.estimateGas(nonce);
            console.log("Estimated gas:", gas.toString());

            const tx = await contract.mine(nonce, {
              gasLimit: gas + 50000n
            });

            console.log("TX sent:", tx.hash);

            const receipt = await tx.wait();

            if (receipt.status === 1) {
              console.log("Success block:", receipt.blockNumber);
            } else {
              console.log("TX reverted.");
            }
          } catch (err) {
            console.error("TX failed:", err.shortMessage || err.message);
          }

          break;
        }

        nonce++;

        if (attempts % 100000n === 0n) {
          const elapsed = (Date.now() - start) / 1000;
          const rate = Number(attempts) / elapsed;

          process.stdout.write(
            `\rAttempts: ${attempts.toString()} | Rate: ${rate.toFixed(2)} H/s`
          );
        }
      }
    } catch (err) {
      console.error("");
      console.error("Mining loop error:", err.shortMessage || err.message || err);
      console.error("Retry dalam 5 detik...");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
