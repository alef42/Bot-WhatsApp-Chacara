const { initializeApp } = require("firebase/app");
const { getFirestore } = require("firebase/firestore");

// Credenciais (copiadas do frontend)
const firebaseConfig = {
  apiKey: "AIzaSyAMVmaejX6BGstNbklsVPMtMibeRZidnd0",
  authDomain: "site-chacara-da-paz-6d1bd.firebaseapp.com",
  projectId: "site-chacara-da-paz-6d1bd",
  storageBucket: "site-chacara-da-paz-6d1bd.firebasestorage.app",
  messagingSenderId: "266195180665",
  appId: "1:266195180665:web:c6c9d3eac31210e65d48a8",
  measurementId: "G-4R2KWQFBC2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

module.exports = { db };
