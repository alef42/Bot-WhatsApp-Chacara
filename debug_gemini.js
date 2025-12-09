const axios = require('axios');
const fs = require('fs');

const API_KEY = 'AIzaSyC72sq2nwuy5FgqCIwuFusnY0Ynz_AAlyU';

function log(message) {
  console.log(message);
  fs.appendFileSync('debug_output.txt', message + '\n');
}

async function listModels() {
  log('\n--- Listing Available Models ---');
  try {
    const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    const models = response.data.models;
    models.forEach(m => {
      log(`- ${m.name} (${m.supportedGenerationMethods.join(', ')})`);
    });
  } catch (error) {
    log(`FAILED TO LIST MODELS:`);
    log(error.message);
    if (error.response) {
      log(JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function runTests() {
  fs.writeFileSync('debug_output.txt', '');
  await listModels();
}

runTests();
