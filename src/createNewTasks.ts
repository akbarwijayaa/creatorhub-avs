import { ethers } from "ethers";
import * as dotenv from "dotenv";
const fs = require('fs');
const path = require('path');
dotenv.config();

// Setup env variables
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
/// TODO: Hack
let chainId = 17000;

const avsDeploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../contracts/deployments/creator-hub/${chainId}.json`), 'utf8'));
const creatorHubServiceManagerAddress = avsDeploymentData.addresses.creatorHubServiceManager;
const creatorHubServiceManagerABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/CreatorHubServiceManager.json'), 'utf8'));
// Initialize contract objects from ABIs
const creatorHubServiceManager = new ethers.Contract(creatorHubServiceManagerAddress, creatorHubServiceManagerABI, wallet);


async function createNewTask(taskName: string) {
  try {
    // Send a transaction to the createNewTask function
    const tx = await creatorHubServiceManager.createTaskMintAccount(taskName);
    
    // Wait for the transaction to be mined
    const receipt = await tx.wait();
    
    console.log(`Transaction successful with hash: ${receipt.hash}`);

    
  } catch (error) {
    console.error('Error sending transaction:', error);
  }
}

// Function to create a new task with a random name every 15 seconds
function startCreatingTasks() {
  setInterval(() => {
    const channelID = 'UCyNwHRGW_rgH5-PJ_mIbKTQ';
    console.log(`Creating new task with channelID: ${channelID}`);
    createNewTask(channelID);
  }, 24000);
}

// Start the process
startCreatingTasks();