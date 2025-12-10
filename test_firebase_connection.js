try {
    const { db } = require('./api/firebase');
    console.log("Firebase initialized successfully.");
    db.listCollections().then(collections => {
        console.log("Connected! Collections:", collections.map(c => c.id));
    }).catch(e => {
        console.error("Connection error:", e);
    });
} catch (e) {
    console.error("Initialization error:", e);
}
