require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGO_URI;

if (!uri) {
    console.error("❌ MONGO_URI não encontrado no .env");
    process.exit(1);
}

// Definição do Schema (Cópia do baileysMongoAuth.js para garantir acesso correto)
const AuthSchema = new mongoose.Schema({
    _id: String,
    data: Object
});
// Nota: O Mongoose pluraliza automaticamente 'BaileysAuth' para 'baileysauths', 
// mas se o baileysMongoAuth.js definiu explicitamente ou via mongoose.models, vamos tentar capturar
// Para garantir, vamos usar o mesmo nome de model.
const AuthModel = mongoose.models.WhatsAppSession || mongoose.model('WhatsAppSession', AuthSchema);

async function clearSession() {
    try {
        console.log("⏳ Conectando ao MongoDB para limpar sessão...");
        await mongoose.connect(uri);
        
        console.log("🗑️ Apagando credenciais antigas...");
        const result = await AuthModel.deleteMany({});
        
        console.log(`✅ ${result.deletedCount} itens de sessão deletados.`);
        console.log("🚀 Agora você pode rodar o bot e escanear o QR Code novamente!");

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error("❌ Erro ao limpar sessão:", error);
        process.exit(1);
    }
}

clearSession();
