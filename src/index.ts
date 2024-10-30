import { ethers } from "ethers";
import * as dotenv from "dotenv";
import axios from "axios";
import { google } from 'googleapis';
import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import { Reclaim } from "@reclaimprotocol/js-sdk";

import { ThirdwebStorage } from "@thirdweb-dev/storage";

const fs = require('fs');
const path = require('path');
dotenv.config();

// Check if the process.env object is empty
if (!Object.keys(process.env).length) {
    throw new Error("process.env object is empty");
}

// Setup env variables
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
/// TODO: Hack
let chainId = 17000;

const avsDeploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../contracts/deployments/creator-hub/${chainId}.json`), 'utf8'));
// Load core deployment data
const coreDeploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../contracts/deployments/core/${chainId}.json`), 'utf8'));


const delegationManagerAddress = coreDeploymentData.addresses.delegation; // todo: reminder to fix the naming of this contract in the deployment file, change to delegationManager
const avsDirectoryAddress = coreDeploymentData.addresses.avsDirectory;
const creatorHubServiceManagerAddress = avsDeploymentData.addresses.creatorHubServiceManager;
const ecdsaStakeRegistryAddress = avsDeploymentData.addresses.stakeRegistry;


// Load ABIs
const delegationManagerABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/IDelegationManager.json'), 'utf8'));
const ecdsaRegistryABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/ECDSAStakeRegistry.json'), 'utf8'));
const creatorHubServiceManagerABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/CreatorHubServiceManager.json'), 'utf8'));
const avsDirectoryABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/IAVSDirectory.json'), 'utf8'));


// Initialize contract objects from ABIs
const delegationManager = new ethers.Contract(delegationManagerAddress, delegationManagerABI, wallet);
const creatorHubServiceManager = new ethers.Contract(creatorHubServiceManagerAddress, creatorHubServiceManagerABI, wallet);
const ecdsaRegistryContract = new ethers.Contract(ecdsaStakeRegistryAddress, ecdsaRegistryABI, wallet);
const avsDirectory = new ethers.Contract(avsDirectoryAddress, avsDirectoryABI, wallet);

const secretKey = process.env.THIRDWEB_API_KEY;
const storage = new ThirdwebStorage({
    secretKey: secretKey,
});

const reclaimClient = new ReclaimClient(
    process.env.APP_ID!,
    process.env.APP_SECRET!
  );

const keyFilePath = path.join(__dirname, 'account.json');
const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl'];

async function getTierYoutube(subscriberCount: number) {
    const tiers = [
        { min: 10_000_000, name: 'Platinum', image: 'platinum.jpg' },
        { min: 1_000_000, name: 'Gold', image: 'gold.jpg' },
        { min: 10_000, name: 'Silver', image: 'silver.jpg' },
        { min: 0, name: 'Rookie', image: 'rookie.jpg' },
    ];

    const { name: tier, image } = tiers.find(({ min }) => subscriberCount >= min) || tiers[tiers.length - 1];
    const imageURL = `${process.env.PUBLIC_IMAGE_NFT}/${image}`;

    return { tier, imageURL };
}

const getZkFetchProof = async (channelId: string) => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: keyFilePath,
            scopes: scopes,
        });

        const authClient = await auth.getClient();
        const accessToken = await authClient.getAccessToken();
        
        const proof =  await reclaimClient.zkFetch(
          `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`,
          {
            method: "GET",
          },
          {
            headers: { Authorization: `Bearer ${accessToken?.token}` },
            responseMatches: [
              {
                type: "regex",
                value:
                  '"id":\\s*"(?<channelId>[^"]+)"[\\s\\S]*?"title":\\s*"(?<title>[^"]+)"',
              },
            ],
          }
        );
        // Handle proof generation failure
        if (!proof) {
          console.error("Failed to generate proof.");
          throw new Error("Failed to generate proof.");
        }
        // Verify proof
        const isValid = await Reclaim.verifySignedProof(proof);
        if (!isValid) {
          console.error("Proof is invalid.");
          throw new Error("Proof is invalid.");
        }

        // Transform proof for on-chain purposes
        const proofData = await Reclaim.transformForOnchain(proof);
    
        const context = JSON.parse(proofData.claimInfo.context);
        const channelIdProof = context.extractedParameters.channelId;
        const proofIdentifier = proofData.signedClaim.claim.identifier;
        
        const youtubeResponse = await axios.get(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}`,
            {
              headers: { Authorization: `Bearer ${accessToken?.token}` },
            }
        );
        const channel = youtubeResponse.data.items[0];
        
        const channelSubscriber = channel.statistics.subscriberCount;
        const tierData = await getTierYoutube(channelSubscriber);
        const { tier, imageURL } = tierData;

        const metadata = {
            name: `Creator Ownership NFT`,
            description: `Proof of Owner for YouTube account by CreatorHub`,
            image: imageURL,
            attributes: [
            { trait_type: "Proof", value: proofIdentifier },
            { trait_type: "Tier", value: tier },
            ],
        };
        
        const tokenURI = await storage.upload(metadata);

        return {proofData: proofData, channelIdProof: channelIdProof, tokenURI: tokenURI};

    } catch (error) {
        console.error('Error generating access token:', error);
        throw error;
    }
};const signAndRespondToTask = async (taskIndex: number, taskCreatedBlock: number, taskChannelID: string, taskaccountAddress: string, taskChannelIDProof: object, taskTokenURI: string) => {
    const message = `Hello, ${taskChannelID}`;
    const messageHash = ethers.solidityPackedKeccak256(["string"], [message]);
    const messageBytes = ethers.getBytes(messageHash);
    const signature = await wallet.signMessage(messageBytes);

    console.log(`Signing and responding to task ${taskIndex}`);

    const operators = [await wallet.getAddress()];
    const signatures = [signature];
    const signedTask = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "bytes[]", "uint32"],
        [operators, signatures, ethers.toBigInt(await provider.getBlockNumber()-1)]
    );
    
    const tx = await creatorHubServiceManager.respondToCreateMintAccountTask(
        { accountAddress: taskaccountAddress, channelID: taskChannelID, taskCreatedBlock: taskCreatedBlock },
        taskIndex,
        signedTask,
        taskChannelIDProof,
        taskTokenURI
    );
    await tx.wait();
    console.log(`Successfuly validate and Minting NFT`);
    console.log(`Transaction Hash : `, tx.hash!);
};

const registerOperator = async () => {
    
    // Registers as an Operator in EigenLayer.
    try {
        const tx1 = await delegationManager.registerAsOperator({
            __deprecated_earningsReceiver: await wallet.address,
            delegationApprover: "0x0000000000000000000000000000000000000000",
            stakerOptOutWindowBlocks: 0
        }, "");
        await tx1.wait();
        console.log("Operator registered to Core EigenLayer contracts");
    } catch (error) {
        console.error("Error in registering as operator:", error);
    }
    
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const expiry = Math.floor(Date.now() / 1000) + 3600; // Example expiry, 1 hour from now

    // Define the output structure
    let operatorSignatureWithSaltAndExpiry = {
        signature: "",
        salt: salt,
        expiry: expiry
    };

    // Calculate the digest hash, which is a unique value representing the operator, avs, unique value (salt) and expiration date.
    const operatorDigestHash = await avsDirectory.calculateOperatorAVSRegistrationDigestHash(
        wallet.address, 
        await creatorHubServiceManager.getAddress(), 
        salt, 
        expiry
    );
    console.log(operatorDigestHash);
    
    // Sign the digest hash with the operator's private key
    console.log("Signing digest hash with operator's private key");
    const operatorSigningKey = new ethers.SigningKey(process.env.PRIVATE_KEY!);
    const operatorSignedDigestHash = operatorSigningKey.sign(operatorDigestHash);

    // Encode the signature in the required format
    operatorSignatureWithSaltAndExpiry.signature = ethers.Signature.from(operatorSignedDigestHash).serialized;

    console.log("Registering Operator to AVS Registry contract");

    
    // Register Operator to AVS
    const tx2 = await ecdsaRegistryContract.registerOperatorWithSignature(
        operatorSignatureWithSaltAndExpiry,
        wallet.address
    );
    await tx2.wait();
    console.log("Operator registered on AVS successfully");
};

const monitorNewTasks = async () => {

    creatorHubServiceManager.on("NewCreatorTaskCreated", async (taskIndex: number, task: any) => {
        try {
            console.log(`New task detected: Channel ID : ${task.channelID}`);

            // zkFetch
            const channelProof = await getZkFetchProof(task.channelID);
            const { proofData, channelIdProof, tokenURI } = channelProof;
            
            let channelIDHash: string;
            if (channelIdProof == task.channelID) {
                channelIDHash = task.channelID;
            } else {
                channelIDHash = '0000000000';
            }
            console.log('channelIDHash : ', channelIDHash)
            console.log('proofData : ', proofData)
            
            await signAndRespondToTask(taskIndex, task.taskCreatedBlock, channelIDHash, task.accountAddress, proofData, tokenURI);
        }catch (error) {
            console.error(`Error processing task ${taskIndex}:`, error);
    }
    });

    console.log("Monitoring for new tasks...");
};
const main = async () => {
    while (true) {
      try {
        await registerOperator();
        await monitorNewTasks();
        
        // Keep the process alive
        await new Promise(() => {});
      } catch (error) {
        console.error("Error in main loop:", error);
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log("Restarting main process...");
      }
    }
  };
  
process.on('uncaughtException', (error) => {
console.error('Uncaught exception:', error);
// Keep running
});

process.on('unhandledRejection', (error) => {
console.error('Unhandled rejection:', error);
// Keep running
});

main().catch((error) => {
console.error("Critical error in main function:", error);
process.exit(1);
});