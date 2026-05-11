require('dotenv').config();

const { ethers } = require('ethers');

// HASH Token Contract Configuration
const HASH_CONTRACT_ADDRESS = '0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc';
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CHAIN_ID = 1; // Ethereum Mainnet

if (!RPC_URL) {
    console.error('❌ RPC_URL belum diatur di file .env');
    process.exit(1);
}

if (!PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY belum diatur di file .env');
    process.exit(1);
}

// ABI for HASH contract (minimal functions needed)
const HASH_ABI = [
    'function currentDifficulty() view returns (uint256)',
    'function currentEpoch() view returns (uint256)',
    'function mint(bytes32 challenge, uint256 nonce) external',
    'function hashTotalSupply() view returns (uint256)',
    'function totalMints() view returns (uint256)'
];

class HashMiner {
    constructor(privateKey, rpcUrl) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.contract = new ethers.Contract(HASH_CONTRACT_ADDRESS, HASH_ABI, this.wallet);

        this.minerAddress = this.wallet.address;
        this.isRunning = false;
        this.stats = {
            attempts: 0,
            successCount: 0,
            startTime: null,
            lastSuccessTime: null,
            currentDifficulty: 0,
            currentEpoch: 0
        };

        console.log(`🔨 HASH Miner initialized`);
        console.log(`📍 Miner Address: ${this.minerAddress}`);
        console.log(`⛽ RPC URL: ${rpcUrl}`);
    }

    async getChallenge() {
        const epoch = await this.contract.currentEpoch();

        const challenge = ethers.solidityPackedKeccak256(
            ['uint256', 'address', 'address', 'uint256'],
            [CHAIN_ID, HASH_CONTRACT_ADDRESS, this.minerAddress, epoch]
        );

        this.stats.currentEpoch = Number(epoch);
        return { challenge, epoch: Number(epoch) };
    }

    async getCurrentDifficulty() {
        const difficulty = await this.contract.currentDifficulty();
        this.stats.currentDifficulty = difficulty.toString();
        return difficulty;
    }

    async checkProof(challenge, nonce, targetDifficulty) {
        const hash = ethers.solidityPackedKeccak256(
            ['bytes32', 'uint256'],
            [challenge, nonce]
        );

        return BigInt(hash) < BigInt(targetDifficulty);
    }

    async mine() {
        console.log('\n🚀 Starting mining process...');
        this.isRunning = true;
        this.stats.startTime = Date.now();

        while (this.isRunning) {
            try {
                const { challenge, epoch } = await this.getChallenge();
                const difficulty = await this.getCurrentDifficulty();

                console.log(`\n📊 Current Status:`);
                console.log(`   Epoch: ${epoch}`);
                console.log(`   Difficulty: ${difficulty.toString()}`);
                console.log(`   Challenge: ${challenge.slice(0, 20)}...`);

                let nonce = 0n;
                let found = false;

                console.log(`⛏️  Mining for epoch ${epoch}...`);

                while (!found && this.isRunning) {
                    const currentEpoch = await this.contract.currentEpoch();

                    if (Number(currentEpoch) !== epoch) {
                        console.log(`🔄 Epoch changed from ${epoch} to ${currentEpoch}, restarting...`);
                        break;
                    }

                    const isValid = await this.checkProof(challenge, nonce, difficulty);
                    this.stats.attempts++;

                    if (isValid) {
                        found = true;
                        console.log(`🎉 FOUND VALID NONCE: ${nonce.toString()}`);

                        await this.submitSolution(challenge, nonce);
                        break;
                    }

                    nonce++;

                    if (this.stats.attempts % 10000 === 0) {
                        const elapsed = (Date.now() - this.stats.startTime) / 1000;
                        const rate = (this.stats.attempts / elapsed).toFixed(2);

                        process.stdout.write(
                            `\r⚡ Hash rate: ${rate} H/s | Attempts: ${this.stats.attempts.toLocaleString()}`
                        );
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error('❌ Mining error:', error.message);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async submitSolution(challenge, nonce) {
        try {
            console.log(`\n📤 Submitting solution to contract...`);

            const tx = await this.contract.mint(challenge, nonce, {
                gasLimit: 300000
            });

            console.log(`📋 Transaction submitted: ${tx.hash}`);
            console.log(`⏳ Waiting for confirmation...`);

            const receipt = await tx.wait();

            if (receipt.status === 1) {
                console.log(`✅ SUCCESS! Transaction confirmed in block ${receipt.blockNumber}`);
                console.log(`🔗 Etherscan: https://etherscan.io/tx/${tx.hash}`);

                this.stats.successCount++;
                this.stats.lastSuccessTime = Date.now();

                const totalMints = await this.contract.totalMints();
                const era = Math.floor(Number(totalMints) / 100000);
                const reward = 100 / Math.pow(2, era);

                console.log(`🏆 Mined ${reward.toFixed(2)} HASH tokens!`);
                console.log(`📈 Total successful mints: ${this.stats.successCount}`);
            } else {
                console.log(`❌ Transaction failed`);
            }

        } catch (error) {
            console.error(`❌ Submission failed:`, error.message);
        }
    }

    stop() {
        this.isRunning = false;
        console.log('\n🛑 Mining stopped');

        const elapsed = (Date.now() - this.stats.startTime) / 1000;
        const rate = (this.stats.attempts / elapsed).toFixed(2);

        console.log('\n📊 Final Statistics:');
        console.log(`   Total Attempts: ${this.stats.attempts.toLocaleString()}`);
        console.log(`   Successful Mints: ${this.stats.successCount}`);
        console.log(`   Average Hash Rate: ${rate} H/s`);
        console.log(`   Mining Duration: ${elapsed.toFixed(2)} seconds`);
    }

    async displayContractInfo() {
        try {
            const totalSupply = await this.contract.hashTotalSupply();
            const totalMints = await this.contract.totalMints();
            const difficulty = await this.contract.currentDifficulty();
            const epoch = await this.contract.currentEpoch();

            console.log('\n📋 Contract Information:');
            console.log(`   Total Supply: ${ethers.formatUnits(totalSupply, 18)} HASH`);
            console.log(`   Total Mints: ${totalMints.toString()}`);
            console.log(`   Current Difficulty: ${difficulty.toString()}`);
            console.log(`   Current Epoch: ${epoch.toString()}`);

            const era = Math.floor(Number(totalMints) / 100000);
            const currentReward = 100 / Math.pow(2, era);

            console.log(`   Current Reward: ${currentReward.toFixed(2)} HASH per mint`);

        } catch (error) {
            console.error('❌ Failed to fetch contract info:', error.message);
        }
    }
}

async function main() {
    console.log('🔐 HASH Token CPU Miner');
    console.log('========================\n');

    if (!PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length !== 66) {
        console.error('❌ PRIVATE_KEY tidak valid. Format harus 0x + 64 karakter hex.');
        process.exit(1);
    }

    const miner = new HashMiner(PRIVATE_KEY, RPC_URL);

    await miner.displayContractInfo();

    process.on('SIGINT', () => {
        miner.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        miner.stop();
        process.exit(0);
    });

    await miner.mine();
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { HashMiner };
