const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI('AIzaSyC72sq2nwuy5FgqCIwuFusnY0Ynz_AAlyU');

async function listModels() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log("Testing gemini-1.5-flash...");
    const result = await model.generateContent("Hello");
    console.log("Success with gemini-1.5-flash:", result.response.text());
  } catch (error) {
    console.error("Error with gemini-1.5-flash:", error.message);
  }

  try {
    const model2 = genAI.getGenerativeModel({ model: "gemini-pro" });
    console.log("Testing gemini-pro...");
    const result2 = await model2.generateContent("Hello");
    console.log("Success with gemini-pro:", result2.response.text());
  } catch (error) {
    console.error("Error with gemini-pro:", error.message);
  }
}

listModels();
