import { ethers } from "ethers";
import * as dotenv from "dotenv";
import axios from "axios";
import { google } from 'googleapis';
import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import { Reclaim } from "@reclaimprotocol/js-sdk";

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
let chainId = 31337;

const avsDeploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../contracts/deployments/hello-world/${chainId}.json`), 'utf8'));
// Load core deployment data
const coreDeploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../contracts/deployments/core/${chainId}.json`), 'utf8'));


const delegationManagerAddress = coreDeploymentData.addresses.delegation; // todo: reminder to fix the naming of this contract in the deployment file, change to delegationManager
const avsDirectoryAddress = coreDeploymentData.addresses.avsDirectory;
const helloWorldServiceManagerAddress = avsDeploymentData.addresses.creatorHubServiceManager;
const ecdsaStakeRegistryAddress = avsDeploymentData.addresses.stakeRegistry;



// Load ABIs
const delegationManagerABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/IDelegationManager.json'), 'utf8'));
const ecdsaRegistryABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/ECDSAStakeRegistry.json'), 'utf8'));
const helloWorldServiceManagerABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/CreatorHubServiceManager.json'), 'utf8'));
const avsDirectoryABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/IAVSDirectory.json'), 'utf8'));

// Initialize contract objects from ABIs
const delegationManager = new ethers.Contract(delegationManagerAddress, delegationManagerABI, wallet);
const helloWorldServiceManager = new ethers.Contract(helloWorldServiceManagerAddress, helloWorldServiceManagerABI, wallet);
const ecdsaRegistryContract = new ethers.Contract(ecdsaStakeRegistryAddress, ecdsaRegistryABI, wallet);
const avsDirectory = new ethers.Contract(avsDirectoryAddress, avsDirectoryABI, wallet);

const reclaimClient = new ReclaimClient(
    process.env.APP_ID!,
    process.env.APP_SECRET!
  );

const keyFilePath = path.join(__dirname, 'account.json');
const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl'];

async function fetchYouTubeData(access_token: string) {
    const youtubeResponse = await axios.get(
      "https://www.googleapis.com/youtube/v3/channels",
      {
        params: { part: "snippet,contentDetails,statistics", mine: true },
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );
    return youtubeResponse.data;
}

const getZkFetchProof = async () => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: keyFilePath,
            scopes: scopes,
        });

        const authClient = await auth.getClient();
        const accessToken = await authClient.getAccessToken();
        
        const channelId = 'UCyNwHRGW_rgH5-PJ_mIbKTQ';
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
            // console.log('Access Token:', accessToken?.token);
        const context = JSON.parse(proofData.claimInfo.context);
        const channelIdProof = context.extractedParameters.channelId;
        return {proofData: proofData, channelIdProof: channelIdProof};
    } catch (error) {
        console.error('Error generating access token:', error);
        throw error;
    }
};


// Run the function
// getAccessToken()
//     .then((channelIdProof) => console.log('Token generated successfully:', channelIdProof))
//     .catch((error) => console.error('Error:', error));

const signAndRespondToTask = async (taskIndex: number, taskCreatedBlock: number, taskChannelID: string, taskChannelIDProof: object, taskTokenURI: string) => {
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
    console.log('Test================================');
    const tx = await helloWorldServiceManager.respondToCreateMintAccountTask(
        { channelID: taskChannelID, taskCreatedBlock: taskCreatedBlock },
        taskIndex,
        signedTask,
        taskChannelIDProof,
        taskTokenURI
    );
    await tx.wait();
    console.log(`Responded to task.`);
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
        await helloWorldServiceManager.getAddress(), 
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
    // Per release here: https://github.com/Layr-Labs/eigenlayer-middleware/blob/v0.2.1-mainnet-rewards/src/unaudited/ECDSAStakeRegistry.sol#L49
    const tx2 = await ecdsaRegistryContract.registerOperatorWithSignature(
        operatorSignatureWithSaltAndExpiry,
        wallet.address
    );
    await tx2.wait();
    console.log("Operator registered on AVS successfully");
};

const monitorNewTasks = async () => {
    //console.log(`Creating new task "EigenWorld"`);
    //await helloWorldServiceManager.createNewTask("EigenWorld");

    helloWorldServiceManager.on("NewCreatorTaskCreated", async (taskIndex: number, task: any) => {
        console.log(`New task detected: Hello, ${task.channelID}`);
        const tokenURI = 'http://localhost:3000/api/dummy-uri';
        // zkFetch
        // write code here
        // const channelIdProof = getZkFetchProof()
        const channelProof = await getZkFetchProof();
        const { proofData, channelIdProof } = channelProof;
        
        let channelIDHash: string;
        if (channelIdProof == task.channelID) {
            channelIDHash = task.channelID;
        } else {
            channelIDHash = '0000000000';
        }
        console.log('channelIDHash : ', channelIDHash)
        console.log('proofData : ', proofData)
        
        await signAndRespondToTask(taskIndex, task.taskCreatedBlock, channelIDHash, proofData, tokenURI);
    });

    console.log("Monitoring for new tasks...");
};

const main = async () => {
    await registerOperator();
    monitorNewTasks().catch((error) => {
        console.error("Error monitoring tasks:", error);
    });
};

main().catch((error) => {
    console.error("Error in main function:", error);
});