const admin = require("firebase-admin");
const path = require("path");

// Carrega a chave de conta de serviço
const serviceAccount = require("./site-chacara-da-paz-6d1bd-firebase-adminsdk-fbsvc-8dade94cb7.json");

// Inicializa o Admin SDK (Privilégio Total)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

module.exports = { db };
