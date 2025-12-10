const admin = require("firebase-admin");
const path = require("path");

let serviceAccount;

// Tenta pegar do Ambiente (Produção/Render)
if (process.env.FIREBASE_CREDENTIALS) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    } catch (e) {
        console.error("Erro ao fazer parse do FIREBASE_CREDENTIALS:", e);
    }
} 
// Senão, tenta arquivo local (Desenvolvimento)
else {
    try {
        serviceAccount = require("./site-chacara-da-paz-6d1bd-firebase-adminsdk-fbsvc-8dade94cb7.json");
    } catch (e) {
        console.error("Arquivo de credenciais local não encontrado e env var não definida.");
    }
}

// Inicializa o Admin SDK (Privilégio Total)
if (!admin.apps.length && serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else if (!admin.apps.length) {
    console.error("CRÍTICO: Firebase Admin não pôde ser iniciado (sem credenciais).");
}

const db = admin.firestore();

module.exports = { db };
